"use server";
import type { RefundMethod } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseRupees, rs } from "@/lib/money";
import { storeUpload } from "@/lib/upload";
import { fail, done, type ActionResult } from "@/lib/action";
import { approveRefund, processRefund, rejectRefund, requestRefund } from "@/server/payments";
import { adjustCredit } from "@/server/ledger";

const METHODS: RefundMethod[] = ["ORIGINAL", "BANK", "CASH", "WALLET_CREDIT"];
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export async function requestRefundAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("refunds.create");
  const amount = parseRupees(String(fd.get("amount") ?? ""));
  const method = String(fd.get("method")) as RefundMethod;
  if (amount == null || amount <= 0) return fail("Enter the refund amount in rupees");
  if (!METHODS.includes(method)) return fail("Pick how the money goes back");
  try {
    await requestRefund({ paymentId: String(fd.get("paymentId")), orderId: String(fd.get("orderId") || "") || null, amount, reason: String(fd.get("reason") ?? ""), method, actorId: user.id });
    return done(`Refund of ${rs(amount)} requested — finance approves it next`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function approveRefundAction(id: string) {
  const user = await requirePermission("refunds.approve");
  try {
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
  try {
    await adjustCredit({ userId, amount, reason: "ADJUSTMENT", actorId: user.id, note });
    await audit({ actorId: user.id, action: "credit.adjust", entity: "User", entityId: userId, summary: `${amount > 0 ? "+" : ""}${rs(amount)}`, reason: note, after: { amount } });
    return done("Ledger updated");
  } catch (e) {
    return fail(msg(e));
  }
}
