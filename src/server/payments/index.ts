import "server-only";
import type { PaymentMethod, Prisma, RefundMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateOnly, isoDate, ktmNow } from "@/lib/dates";
import { rs } from "@/lib/money";
import { log } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { addCredit, spendCredit, walletBalance } from "../ledger";
import { notify } from "../notify";
import { bumpPaymentRefund } from "../orders";
import { estimateGatewayFee } from "../finance/common";
import { availableMethods } from "./methods";
import { decodeEsewa, esewaFormFields, esewaSignatureValid, esewaStatus, toPaisa } from "./esewa";
import { khaltiInitiate, khaltiLookup } from "./khalti";

type Tx = Prisma.TransactionClient;

export class PaymentError extends Error {}

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

// ───────────── provider event log (dedupe) ─────────────

/** Record a provider event once. Returns false when this exact event was already processed. */
async function recordEvent(provider: string, eventKey: string, paymentId: string | null, payload: unknown, verified: boolean, outcome: string) {
  try {
    await db.paymentProviderEvent.create({ data: { provider, eventKey, paymentId, payload: json(payload), verified, outcome } });
    return true;
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) return false;
    throw e;
  }
}

// ───────────── marking paid (idempotent) ─────────────

/**
 * Mark a payment paid exactly once and release its orders. Safe to call repeatedly / concurrently:
 * the status flip is a guarded update on (status, version), so only one caller fulfils.
 * Late money (orders already cancelled, or the day already closed) becomes wallet credit.
 */
export async function markPaymentPaid(paymentId: string, opts: { amount?: number | null; attemptId?: string | null; actorId?: string | null; note?: string | null } = {}) {
  const settings = await getSettings();
  const result = await db.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { orders: true } });
    if (!p) throw new PaymentError("Payment not found");
    if (p.status === "PAID" || p.status === "PARTIALLY_REFUNDED" || p.status === "REFUNDED") return { already: true, payment: p, credited: 0 };
    // WP-09: estimated gateway fee from the configured rate for the method; the statement import fills feeActual.
    const gatewayFee = await estimateGatewayFee(p.method, opts.amount ?? p.amount, tx);
    const flipped = await tx.payment.updateMany({
      where: { id: p.id, status: p.status, version: p.version },
      data: { status: "PAID", paidAt: new Date(), verifiedById: opts.actorId ?? null, note: opts.note ?? p.note, gatewayFee, version: { increment: 1 } },
    });
    if (!flipped.count) return { already: true, payment: p, credited: 0 };
    if (opts.attemptId) await tx.paymentAttempt.update({ where: { id: opts.attemptId }, data: { status: "SUCCESS" } });

    const now = ktmNow();
    let credited = 0;
    for (const o of p.orders) {
      const date = isoDate(o.deliveryDate);
      if (o.status === "PENDING_PAYMENT") {
        const lock = await tx.dayLock.findUnique({ where: { kitchenId_date: { kitchenId: o.kitchenId, date: o.deliveryDate } } });
        const late = date < now.date || (date === now.date && (now.time >= settings.orderCutoff || Boolean(lock)));
        if (late) {
          await tx.order.update({ where: { id: o.id }, data: { status: "CANCELLED", cancelledAt: new Date(), paymentStatus: "REFUNDED", refundedAmount: o.customerShare, version: { increment: 1 } } });
          await tx.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: "PENDING_PAYMENT", toStatus: "CANCELLED", note: "Payment arrived after the cut-off — credited", actorId: opts.actorId ?? null } });
          if (o.customerShare > 0) {
            await addCredit(tx, { userId: p.userId, amount: o.customerShare, reason: "REFUND", orderId: o.id, paymentId: p.id, note: "Payment arrived after the day closed" });
            credited += o.customerShare;
          }
        } else {
          await tx.order.update({ where: { id: o.id }, data: { status: "SCHEDULED", paymentStatus: "PAID", version: { increment: 1 } } });
          await tx.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: "PENDING_PAYMENT", toStatus: "SCHEDULED", note: "Payment received", actorId: opts.actorId ?? null } });
        }
      } else if (o.status === "CANCELLED" && o.paymentStatus !== "REFUNDED" && o.customerShare > 0) {
        // Order expired before the money arrived.
        await tx.order.update({ where: { id: o.id }, data: { paymentStatus: "REFUNDED", refundedAmount: o.customerShare } });
        await addCredit(tx, { userId: p.userId, amount: o.customerShare, reason: "REFUND", orderId: o.id, paymentId: p.id, note: "Paid after the order had expired" });
        credited += o.customerShare;
      } else if (o.paymentStatus === "UNPAID" || o.paymentStatus === "PENDING") {
        await tx.order.update({ where: { id: o.id }, data: { paymentStatus: "PAID" } });
      }
    }
    // Overpayment (amount changed after the gateway session started).
    if (opts.amount != null && opts.amount > p.amount) {
      await addCredit(tx, { userId: p.userId, amount: opts.amount - p.amount, reason: "REFUND", paymentId: p.id, note: "Paid more than the order total" });
      credited += opts.amount - p.amount;
    }
    if (p.subscriptionId) {
      await tx.subscription.updateMany({ where: { id: p.subscriptionId, status: "PENDING_PAYMENT" }, data: { status: "ACTIVE" } });
    }
    if (credited > 0) {
      await tx.payment.update({ where: { id: p.id }, data: { refundedAmount: { increment: credited }, status: credited >= p.amount ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    }
    return { already: false, payment: p, credited };
  });
  if (!result.already) {
    void notify("payment.received", { userId: result.payment.userId }, { amount: rs(opts.amount ?? result.payment.amount), reference: result.payment.reference }, { dedupeKey: `paid:${paymentId}` });
    if (opts.actorId) await audit({ actorId: opts.actorId, action: "payment.mark_paid", entity: "Payment", entityId: paymentId, summary: `${result.payment.reference} marked paid`, reason: opts.note });
  }
  return result;
}

async function markAttemptFailed(attemptId: string, paymentId: string, response: unknown) {
  await db.paymentAttempt.updateMany({ where: { id: attemptId, status: "STARTED" }, data: { status: "FAILED", response: json(response) } });
  await db.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "FAILED" } });
}

// ───────────── starting a gateway payment ─────────────

export type StartResult =
  | { kind: "esewa"; action: string; fields: Record<string, string> }
  | { kind: "khalti"; url: string }
  | { kind: "manual" }
  | { kind: "done" };

export async function startPayment(paymentId: string, userId: string, origin: string): Promise<StartResult> {
  const p = await db.payment.findFirst({ where: { id: paymentId, userId }, include: { user: true, attempts: true } });
  if (!p) throw new PaymentError("Payment not found");
  if (p.status === "PAID") return { kind: "done" };
  if (p.status === "CANCELLED") throw new PaymentError("This order expired — please order again");
  if (p.amount <= 0) throw new PaymentError("Nothing to pay");
  const n = p.attempts.length + 1;
  const providerRef = `${p.reference}-${n}`;
  if (p.method === "ESEWA") {
    await db.paymentAttempt.create({ data: { paymentId: p.id, method: "ESEWA", providerRef, amount: p.amount } });
    await db.payment.update({ where: { id: p.id }, data: { status: "PENDING" } });
    return {
      kind: "esewa",
      ...esewaFormFields({
        transactionUuid: providerRef,
        amount: p.amount,
        successUrl: `${origin}/api/payments/esewa/return/${p.id}`,
        failureUrl: `${origin}/api/payments/esewa/return/${p.id}?failed=1`,
      }),
    };
  }
  if (p.method === "KHALTI") {
    const init = await khaltiInitiate({
      purchaseOrderId: providerRef,
      amount: p.amount,
      name: `Dabba Bela ${p.reference}`,
      returnUrl: `${origin}/api/payments/khalti/return/${p.id}`,
      websiteUrl: origin,
      customer: { name: p.user.name, email: p.user.email, phone: p.user.phoneNumber },
    });
    await db.paymentAttempt.create({ data: { paymentId: p.id, method: "KHALTI", providerRef: init.pidx, amount: p.amount, request: json({ purchaseOrderId: providerRef }), response: json(init.raw) } });
    await db.payment.update({ where: { id: p.id }, data: { status: "PENDING" } });
    return { kind: "khalti", url: init.paymentUrl };
  }
  return { kind: "manual" };
}

// ───────────── gateway returns ─────────────

export type VerifyOutcome = { ok: boolean; reason?: string; pending?: boolean };

/**
 * eSewa redirect handler. Trust nothing from the browser: verify the HMAC, match the attempt
 * and amount, then require the server-to-server status API to say COMPLETE.
 */
export async function handleEsewaReturn(paymentId: string, dataB64: string): Promise<VerifyOutcome> {
  const payload = decodeEsewa(dataB64);
  if (!payload) return { ok: false, reason: "No payment data" };
  const eventKey = `esewa:${payload.transaction_uuid}:${payload.status}:${payload.transaction_code ?? ""}`;
  const attempt = await db.paymentAttempt.findUnique({ where: { providerRef: payload.transaction_uuid } });
  if (!attempt || attempt.paymentId !== paymentId) {
    await recordEvent("esewa", eventKey, null, payload, false, "MISMATCH");
    return { ok: false, reason: "Unknown transaction" };
  }
  if (!esewaSignatureValid(payload)) {
    await recordEvent("esewa", `${eventKey}:badsig:${Date.now()}`, paymentId, payload, false, "MISMATCH");
    return { ok: false, reason: "Signature mismatch" };
  }
  if (toPaisa(payload.total_amount) !== attempt.amount) {
    await recordEvent("esewa", `${eventKey}:amount`, paymentId, payload, false, "MISMATCH");
    return { ok: false, reason: "Amount mismatch" };
  }
  return confirmEsewa(attempt.id, paymentId, attempt.providerRef, attempt.amount, eventKey, payload);
}

async function confirmEsewa(attemptId: string, paymentId: string, uuid: string, amount: number, eventKey: string, payload: unknown): Promise<VerifyOutcome> {
  const s = await esewaStatus(uuid, amount);
  if (s.status === "COMPLETE") {
    const fresh = await recordEvent("esewa", `${eventKey}:status:COMPLETE`, paymentId, { callback: payload, status: s.raw }, true, "PAID");
    await db.paymentAttempt.update({ where: { id: attemptId }, data: { response: json({ callback: payload, status: s.raw }) } });
    if (fresh) await markPaymentPaid(paymentId, { amount, attemptId });
    return { ok: true };
  }
  if (s.status === null || s.status === "PENDING" || s.status === "AMBIGUOUS") {
    await recordEvent("esewa", `${eventKey}:status:${s.status ?? "unreachable"}:${Date.now()}`, paymentId, { callback: payload, status: s.raw }, false, "IGNORED");
    return { ok: false, pending: true, reason: "eSewa hasn't confirmed yet — we'll keep checking" };
  }
  await recordEvent("esewa", `${eventKey}:status:${s.status}`, paymentId, { callback: payload, status: s.raw }, true, "FAILED");
  await markAttemptFailed(attemptId, paymentId, s.raw);
  return { ok: false, reason: `eSewa status: ${s.status}` };
}

export async function handleKhaltiReturn(paymentId: string, pidx: string): Promise<VerifyOutcome> {
  const attempt = await db.paymentAttempt.findUnique({ where: { providerRef: pidx } });
  if (!attempt || attempt.paymentId !== paymentId) {
    await recordEvent("khalti", `khalti:${pidx}:unknown`, null, { pidx }, false, "MISMATCH");
    return { ok: false, reason: "Unknown transaction" };
  }
  return confirmKhalti(attempt.id, paymentId, pidx, attempt.amount);
}

async function confirmKhalti(attemptId: string, paymentId: string, pidx: string, amount: number): Promise<VerifyOutcome> {
  const r = await khaltiLookup(pidx);
  if (r.ok && r.status === "Completed" && r.total_amount === amount) {
    const fresh = await recordEvent("khalti", `khalti:${pidx}:Completed`, paymentId, r, true, "PAID");
    await db.paymentAttempt.update({ where: { id: attemptId }, data: { response: json(r) } });
    if (fresh) await markPaymentPaid(paymentId, { amount, attemptId });
    return { ok: true };
  }
  if (r.ok && r.status === "Completed") {
    await recordEvent("khalti", `khalti:${pidx}:amount`, paymentId, r, false, "MISMATCH");
    return { ok: false, reason: "Amount mismatch — contact us" };
  }
  if (!r.ok || r.status === "Pending" || r.status === "Initiated") return { ok: false, pending: true, reason: "Khalti hasn't confirmed yet" };
  await recordEvent("khalti", `khalti:${pidx}:${r.status}`, paymentId, r, true, "FAILED");
  await markAttemptFailed(attemptId, paymentId, r);
  return { ok: false, reason: `Khalti status: ${r.status}` };
}

/** Cron: re-check gateway attempts that never came back (closed tab, network drop). */
export async function reconcileGatewayAttempts() {
  const since = new Date(Date.now() - 3 * 24 * 3600_000);
  const before = new Date(Date.now() - 5 * 60_000);
  const attempts = await db.paymentAttempt.findMany({
    where: { status: "STARTED", createdAt: { gte: since, lte: before }, payment: { status: { in: ["PENDING", "FAILED", "CANCELLED"] } } },
    take: 50,
  });
  let paid = 0;
  for (const a of attempts) {
    try {
      const r = a.method === "ESEWA" ? await confirmEsewa(a.id, a.paymentId, a.providerRef, a.amount, `esewa:${a.providerRef}:reconcile`, { reconcile: true }) : await confirmKhalti(a.id, a.paymentId, a.providerRef, a.amount);
      if (r.ok) paid++;
      else if (!r.pending) continue;
      else if (a.createdAt < new Date(Date.now() - 24 * 3600_000)) await db.paymentAttempt.update({ where: { id: a.id }, data: { status: "EXPIRED" } });
    } catch (e) {
      log.warn("reconcile.failed", { attemptId: a.id, error: e });
    }
  }
  return { checked: attempts.length, paid };
}

// ───────────── switching method / manual flows ─────────────

/** Change how an unpaid payment will be paid (e.g. Khalti failed → cash). */
export async function switchPaymentMethod(paymentId: string, userId: string, method: PaymentMethod) {
  const settings = await getSettings();
  const p = await db.payment.findFirst({ where: { id: paymentId, userId }, include: { orders: true } });
  if (!p || !["PENDING", "FAILED"].includes(p.status)) throw new PaymentError("Nothing to pay here");
  const methods = await availableMethods(settings, { hasCompany: Boolean(p.companyId), customerShare: p.amount });
  if (!methods.includes(method)) throw new PaymentError("That payment method isn't available");
  if (method === p.method && p.status === "PENDING") return p;
  if (method === "WALLET") {
    if ((await walletBalance(userId)) < p.amount) throw new PaymentError("Not enough credit");
    await db.$transaction(async (tx) => {
      await spendCredit(tx, { userId, amount: p.amount, paymentId: p.id, note: `Payment ${p.reference}` });
      await tx.payment.update({ where: { id: p.id }, data: { method: "WALLET", status: "PENDING" } });
    });
    await markPaymentPaid(p.id, { amount: p.amount });
    return p;
  }
  await db.payment.update({ where: { id: p.id }, data: { method, status: "PENDING", version: { increment: 1 } } });
  if (method === "CASH") {
    // Cash is collected at the door: release the orders now (still subject to the cut-off).
    const now = ktmNow();
    for (const o of p.orders.filter((x) => x.status === "PENDING_PAYMENT")) {
      const d = isoDate(o.deliveryDate);
      if (d < now.date || (d === now.date && now.time >= settings.orderCutoff)) continue;
      await db.order.update({ where: { id: o.id }, data: { status: "SCHEDULED", paymentStatus: "UNPAID" } });
      await db.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: "PENDING_PAYMENT", toStatus: "SCHEDULED", note: "Switched to cash on delivery", actorId: userId } });
    }
    if (p.subscriptionId) await db.subscription.updateMany({ where: { id: p.subscriptionId, status: "PENDING_PAYMENT" }, data: { status: "ACTIVE" } });
  }
  return p;
}

/** Customer uploads a bank-transfer / QR screenshot. Finance verifies it against the bank statement. */
export async function submitTransferProof(paymentId: string, userId: string, proofUrl: string, reference: string) {
  const p = await db.payment.findFirst({ where: { id: paymentId, userId, method: "BANK_TRANSFER" } });
  if (!p || p.status === "PAID") throw new PaymentError("Nothing to confirm");
  await db.payment.update({ where: { id: p.id }, data: { proofUrl, note: reference.slice(0, 120) || p.note, status: "PENDING" } });
  await db.paymentAttempt.create({ data: { paymentId: p.id, method: "BANK_TRANSFER", providerRef: `${p.reference}-proof-${Date.now()}`, amount: p.amount, request: json({ proofUrl, reference }) } });
}

/** Finance confirms a bank transfer after seeing it in the bank account. */
export async function verifyManualPayment(paymentId: string, actorId: string, bankReference: string) {
  if (!bankReference.trim()) throw new PaymentError("Enter the bank transaction reference");
  return markPaymentPaid(paymentId, { actorId, note: `Verified: ${bankReference.trim()}` });
}

export async function rejectManualPayment(paymentId: string, actorId: string, reason: string) {
  const p = await db.payment.update({ where: { id: paymentId }, data: { status: "FAILED", note: reason } });
  await audit({ actorId, action: "payment.reject", entity: "Payment", entityId: paymentId, summary: `${p.reference} rejected`, reason });
  return p;
}

/** Rider / dispatcher records cash taken at the door for one order. */
export async function recordCashCollected(orderId: string, actorId: string, amount: number, routeId?: string | null) {
  return db.$transaction(async (tx) => {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
    if (!o.payment || o.payment.method !== "CASH") throw new PaymentError("This order isn't cash on delivery");
    if (o.paymentStatus === "PAID") return { already: true };
    if (amount !== o.customerShare) throw new PaymentError(`Collect exactly ${rs(o.customerShare)}`);
    await tx.order.update({ where: { id: o.id }, data: { paymentStatus: "PAID" } });
    await tx.deliveryEvent.create({ data: { orderId: o.id, type: "CASH_COLLECTED", amount, actorId } });
    if (routeId) await tx.deliveryRoute.update({ where: { id: routeId }, data: { cashCollected: { increment: amount } } });
    const open = await tx.order.count({ where: { paymentId: o.paymentId, paymentStatus: { in: ["UNPAID", "PENDING"] }, status: { notIn: ["CANCELLED", "SKIPPED"] } } });
    if (!open) await tx.payment.updateMany({ where: { id: o.payment.id, status: "PENDING" }, data: { status: "PAID", paidAt: new Date(), verifiedById: actorId, gatewayFee: await estimateGatewayFee("CASH", o.payment.amount, tx) } });
    return { already: false };
  });
}

// ───────────── refunds ─────────────

async function refundable(tx: Tx, paymentId: string) {
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const pending = await tx.refund.aggregate({ _sum: { amount: true }, where: { paymentId, status: { in: ["REQUESTED", "APPROVED"] } } });
  return { p, available: p.amount - p.refundedAmount - (pending._sum.amount ?? 0) };
}

export async function requestRefund(input: { paymentId: string; orderId?: string | null; amount: number; reason: string; method: RefundMethod; actorId: string }) {
  if (input.amount <= 0) throw new PaymentError("Enter an amount");
  if (!input.reason.trim()) throw new PaymentError("Give a reason");
  const r = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refund:${input.paymentId}`}))`;
    const { p, available } = await refundable(tx, input.paymentId);
    if (!["PAID", "PARTIALLY_REFUNDED"].includes(p.status)) throw new PaymentError("Only paid payments can be refunded");
    if (input.amount > available) throw new PaymentError(`At most ${rs(available)} can be refunded`);
    return tx.refund.create({ data: { paymentId: p.id, orderId: input.orderId ?? null, amount: input.amount, reason: input.reason, method: input.method, requestedById: input.actorId } });
  });
  await audit({ actorId: input.actorId, action: "refund.request", entity: "Refund", entityId: r.id, summary: `${rs(r.amount)} via ${r.method}`, reason: input.reason });
  return r;
}

export async function approveRefund(refundId: string, actorId: string) {
  const r = await db.refund.updateMany({ where: { id: refundId, status: "REQUESTED" }, data: { status: "APPROVED", approvedById: actorId } });
  if (!r.count) throw new PaymentError("Refund isn't waiting for approval");
  await audit({ actorId, action: "refund.approve", entity: "Refund", entityId: refundId });
}

export async function rejectRefund(refundId: string, actorId: string, reason: string) {
  const r = await db.refund.updateMany({ where: { id: refundId, status: { in: ["REQUESTED", "APPROVED"] } }, data: { status: "REJECTED", note: reason, processedById: actorId } });
  if (!r.count) throw new PaymentError("Refund can't be rejected now");
  await audit({ actorId, action: "refund.reject", entity: "Refund", entityId: refundId, reason });
}

/**
 * Close a refund. Money back through a gateway/bank/cash needs proof (transaction id or receipt);
 * we never mark money as returned without it. Wallet credit is posted to the ledger here.
 */
export async function processRefund(refundId: string, actorId: string, proof: { providerRef?: string; proofUrl?: string; note?: string }) {
  const out = await db.$transaction(async (tx) => {
    const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
    if (r.status !== "APPROVED") throw new PaymentError("Approve the refund first");
    if (r.method !== "WALLET_CREDIT" && !proof.providerRef?.trim() && !proof.proofUrl) throw new PaymentError("Add the transaction reference or a receipt as proof");
    const u = await tx.refund.updateMany({
      where: { id: r.id, status: "APPROVED" },
      data: { status: "PROCESSED", processedById: actorId, processedAt: new Date(), providerRef: proof.providerRef?.trim() || null, proofUrl: proof.proofUrl || null, note: proof.note || r.note },
    });
    if (!u.count) throw new PaymentError("Refund changed — reload");
    if (r.method === "WALLET_CREDIT") await addCredit(tx, { userId: r.payment.userId, amount: r.amount, reason: "REFUND", paymentId: r.paymentId, refundId: r.id, orderId: r.orderId, actorId });
    await bumpPaymentRefund(tx, r.paymentId, r.amount);
    if (r.orderId) {
      const o = await tx.order.findUniqueOrThrow({ where: { id: r.orderId } });
      const refunded = o.refundedAmount + r.amount;
      await tx.order.update({ where: { id: o.id }, data: { refundedAmount: refunded, paymentStatus: refunded >= o.customerShare ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    }
    return r;
  });
  await audit({ actorId, action: "refund.process", entity: "Refund", entityId: refundId, summary: `${rs(out.amount)} via ${out.method}`, after: proof });
  void notify("refund.processed", { userId: out.payment.userId }, { amount: rs(out.amount), method: out.method === "WALLET_CREDIT" ? "added to your Dabba Bela credit" : out.method.toLowerCase() }, { dedupeKey: `refund:${refundId}` });
  return out;
}

export { dateOnly };
