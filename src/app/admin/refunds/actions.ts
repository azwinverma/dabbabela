"use server";
import type { RefundMethod } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { parseRupees, rs } from "@/lib/money";
import { storeUpload } from "@/lib/upload";
import { fail, done, type ActionResult } from "@/lib/action";
import { approveRefund, processRefund, rejectRefund, requestRefund } from "@/server/payments";
import { adjustCreditTx } from "@/server/ledger";
import { assertCreditTarget, assertWithinStaffLimits, NeedsApprovalError } from "@/server/money-limits";
import { needsApproval, requestApproval } from "@/server/approvals";
import { assertPaymentInScope } from "@/components/admin/ops/scope";

const METHODS: RefundMethod[] = ["ORIGINAL", "BANK", "CASH", "WALLET_CREDIT"];
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Kitchen-scoped staff may only touch refunds on payments with an order in their kitchens. */
async function refundInScope(user: { kitchenIds?: string[] | null }, refundId: string) {
  const r = await db.refund.findUnique({ where: { id: refundId }, select: { paymentId: true } });
  if (!r) throw new Error("Refund not found");
  await assertPaymentInScope(user, r.paymentId);
}

export async function requestRefundAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("refunds.create");
  const amount = parseRupees(String(fd.get("amount") ?? ""));
  const method = String(fd.get("method")) as RefundMethod;
  if (amount == null || amount <= 0) return fail("Enter the refund amount in rupees");
  if (!METHODS.includes(method)) return fail("Pick how the money goes back");
  const paymentId = String(fd.get("paymentId") ?? "");
  const orderId = String(fd.get("orderId") || "") || null;
  const reason = String(fd.get("reason") ?? "");
  const idempotencyKey = String(fd.get("idempotencyKey") ?? "") || null;
  try {
    await assertPaymentInScope(user, paymentId);
    try {
      await requestRefund({ paymentId, orderId, amount, reason, method, actorId: user.id });
    } catch (e) {
      // Over a maker-checker limit (threshold, the payment's refunds summed, or this person's 24 h total) → second person.
      if (!(e instanceof NeedsApprovalError)) throw e;
      const { replayed } = await requestApproval(user, { kind: "REFUND", payload: { paymentId, orderId, amount, method, reason }, reason, idempotencyKey });
      return done(replayed ? "Already waiting for approval" : `Refund of ${rs(amount)} needs a second person — sent for approval (${e.message.replace(/^This needs a second person: /, "")})`);
    }
    return done(`Refund of ${rs(amount)} requested — finance approves it next`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function approveRefundAction(id: string) {
  const user = await requirePermission("refunds.approve");
  try {
    await refundInScope(user, id);
    await approveRefund(id, user.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function rejectRefundAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("refunds.approve");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) return fail("Give a reason");
  try {
    await refundInScope(user, String(fd.get("id")));
    await rejectRefund(String(fd.get("id")), user.id, reason);
    return done("Rejected");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function processRefundAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("refunds.approve");
  let proofUrl: string | undefined;
  const file = fd.get("proof");
  try {
    await refundInScope(user, String(fd.get("id")));
    if (file instanceof File && file.size > 0) proofUrl = (await storeUpload(file, { allowPdf: true, folder: "refund-proofs" })).url;
    await processRefund(String(fd.get("id")), user.id, { providerRef: String(fd.get("providerRef") ?? "").trim() || undefined, proofUrl, note: String(fd.get("note") ?? "").trim() || undefined });
    return done("Refund processed and the customer notified");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function adjustCreditAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("refunds.approve");
  const raw = String(fd.get("amount") ?? "").trim();
  const amount = parseRupees(raw);
  const note = String(fd.get("note") ?? "").trim();
  const userId = String(fd.get("userId") ?? "");
  if (amount == null || amount === 0) return fail("Enter an amount (negative to take credit back)");
  if (!note) return fail("A reason is required for every manual adjustment");
  const idempotencyKey = String(fd.get("idempotencyKey") ?? "") || null;
  try {
    await assertCreditTarget(user, userId);
    try {
      await db.$transaction(async (tx) => {
        // Credits count toward the threshold and the person's rolling-24h limit; debits only toward the threshold.
        if (amount > 0) await assertWithinStaffLimits(tx, { actorId: user.id, amount });
        else if (await needsApproval(amount)) throw new NeedsApprovalError("This needs a second person: at or above the approval threshold");
        await adjustCreditTx(tx, { userId, amount, reason: "ADJUSTMENT", actorId: user.id, note });
      });
    } catch (e) {
      if (!(e instanceof NeedsApprovalError)) throw e;
      const { replayed } = await requestApproval(user, { kind: "WALLET_ADJUSTMENT", payload: { userId, amount, note }, reason: note, idempotencyKey });
      return done(replayed ? "Already waiting for approval" : `Adjustment of ${rs(Math.abs(amount))} needs a second person — sent for approval`);
    }
    await audit({ actorId: user.id, action: "credit.adjust", entity: "User", entityId: userId, summary: `${amount > 0 ? "+" : ""}${rs(amount)}`, reason: note, after: { amount } });
    return done("Ledger updated");
  } catch (e) {
    return fail(msg(e));
  }
}
