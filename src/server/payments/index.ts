import "server-only";
import type { Payment, PaymentMethod, Prisma, RefundMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings, type SiteSettings } from "@/lib/settings";
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
import { creditTopupPayment, isTopupMethod, topupEnabled, topupRefundable } from "../wallet-topup";
import { lockUser } from "../capacity";
import { applySwapDifference } from "../subscriptions";
import { expireOpenAttempts, lockPayment } from "./attempts";
import { assertWithinStaffLimits, lockStaffMoney, paymentRefundTotal, staffMoneyUsed24h } from "../money-limits";
import { acceptInvoicePayment, assertInvoicePaymentStartable, invoiceIdOfPayment, settleInvoicePayment } from "../invoice-payments";
import { lockInvoice } from "../invoices";

type Tx = Prisma.TransactionClient;

export class PaymentError extends Error {}

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

// ───────────── provider event log (dedupe) ─────────────

/** Record a provider event once. Returns its id, or null when this exact event was already processed. */
async function recordEvent(provider: string, eventKey: string, paymentId: string | null, payload: unknown, verified: boolean, outcome: string): Promise<string | null> {
  try {
    const e = await db.paymentProviderEvent.create({ data: { provider, eventKey, paymentId, payload: json(payload), verified, outcome }, select: { id: true } });
    return e.id;
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) return null;
    throw e;
  }
}

// ───────────── marking paid (idempotent) ─────────────

type PayingPayment = Prisma.PaymentGetPayload<{ include: { orders: true } }>;
type PaidOpts = { amount?: number | null; attemptId?: string | null; actorId?: string | null; note?: string | null };
/** `refused` (with mismatch) = verified money we will not accept automatically: underpayment, or a cancelled top-up. */
export type PaidResult = {
  already: boolean;
  payment: PayingPayment;
  credited: number;
  mismatch: boolean;
  refused?: "UNDERPAID" | "TOPUP_AMOUNT" | "TOPUP_CANCELLED" | "INVOICE_CANCELLED" | "INVOICE_CHANGED" | "INVOICE_OVERPAID";
  /** INVOICE payments: the receipt written for it. */
  invoiceReceipt?: { id: string; invoiceId: string; number: string } | null;
};

/**
 * Mark a payment paid exactly once and fulfil what it pays for. Safe to call repeatedly / concurrently: it runs under
 * the payment lock (lockPayment — the same lock cancels, swaps and method switches take) and the status flip is a
 * guarded update on (status, version), so only one caller fulfils.
 *
 * This is THE single place money is accepted. What happens next depends on `purpose` (see `fulfil`).
 * Refused (nothing flips, payment stays unpaid, GATEWAY_MISMATCH alert raised for a manual refund / follow-up):
 *   - a verified amount below the payment's CURRENT amount, for every purpose (a stale gateway session for a payment
 *     that has grown since — swap DUE_LATER — or a forged/partial amount);
 *   - a top-up whose verified amount differs at all (credit is sold at face value);
 *   - a top-up the customer cancelled (cancelling expired its sessions; crediting it now would bypass the daily limit
 *     and balance cap — finance refunds it at the gateway instead, see docs/SECURITY.md M2);
 *   - a company-invoice payment that was cancelled (the invoice changed: credit note / void / manual receipt), whose
 *     invoice is no longer open or no longer owes exactly the payment amount, or whose verified amount differs at all
 *     (no partial or surplus receipts — there is no company wallet to hold a surplus).
 */
export async function markPaymentPaid(paymentId: string, opts: PaidOpts = {}): Promise<PaidResult> {
  const settings = await getSettings();
  const result = await db.$transaction((tx) => markPaymentPaidTx(tx, paymentId, opts, settings));
  await afterPaid(result, opts);
  return result;
}

/** markPaymentPaid inside a caller's transaction (the caller runs afterPaid once it has committed). */
async function markPaymentPaidTx(tx: Tx, paymentId: string, opts: PaidOpts, settings: SiteSettings): Promise<PaidResult> {
  // Company-invoice payments: lock order invoice → payment (purpose and idempotency key never change, so this peek is safe).
  const head = await tx.payment.findUnique({ where: { id: paymentId }, select: { purpose: true, idempotencyKey: true } });
  const invoiceId = head ? invoiceIdOfPayment(head) : null;
  if (head?.purpose === "INVOICE" && invoiceId) await lockInvoice(tx, invoiceId);
  await lockPayment(tx, paymentId);
  const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { orders: true } });
  if (!p) throw new PaymentError("Payment not found");
  if (p.status === "PAID" || p.status === "PARTIALLY_REFUNDED" || p.status === "REFUNDED") return { already: true, payment: p, credited: 0, mismatch: false };
  const refuse = async (refused: NonNullable<PaidResult["refused"]>): Promise<PaidResult> => {
    if (opts.attemptId) await tx.paymentAttempt.updateMany({ where: { id: opts.attemptId, status: { in: ["STARTED", "EXPIRED"] } }, data: { status: "MISMATCH" } });
    return { already: false, payment: p, credited: 0, mismatch: true, refused };
  };
  if (p.purpose === "WALLET_TOPUP") {
    // Store credit is sold at face value: a verified amount that differs from the top-up is never credited.
    if (opts.amount != null && opts.amount !== p.amount) return refuse("TOPUP_AMOUNT");
    if (p.status === "CANCELLED") return refuse("TOPUP_CANCELLED");
  }
  if (p.purpose === "INVOICE") {
    const ok = await acceptInvoicePayment(tx, p, opts.amount);
    if (!ok.ok) return refuse(ok.reason);
  }
  // Underpayment is never accepted, whatever the purpose: the orders would be released / marked PAID for less.
  if (opts.amount != null && opts.amount < p.amount) return refuse("UNDERPAID");
  const paid = opts.amount ?? p.amount;
  const plan = p.purpose === "WALLET_TOPUP" || p.purpose === "SWAP_DIFFERENCE" || p.purpose === "INVOICE" ? null : await planOrderFulfilment(tx, p, settings);
  // Belt and braces: never release orders for less than they still owe (payment.amount should always cover them).
  if (plan && paid < plan.owed) return refuse("UNDERPAID");
  // WP-09: estimated gateway fee from the configured rate for the method; the statement import fills feeActual.
  const gatewayFee = await estimateGatewayFee(p.method, paid, tx);
  const flipped = await tx.payment.updateMany({
    where: { id: p.id, status: p.status, version: p.version },
    // Payment.amount = money actually received (a stale session for a payment that shrank pays more; the surplus is
    // credited below and recorded in refundedAmount, so "cash collected" stays the real gateway amount).
    data: { status: "PAID", paidAt: new Date(), amount: paid, verifiedById: opts.actorId ?? null, note: opts.note ?? p.note, gatewayFee, version: { increment: 1 } },
  });
  if (!flipped.count) return { already: true, payment: p, credited: 0, mismatch: false };
  if (opts.attemptId) await tx.paymentAttempt.update({ where: { id: opts.attemptId }, data: { status: "SUCCESS" } });
  if (p.purpose === "INVOICE") {
    const r = await settleInvoicePayment(tx, p, paid, opts);
    return { already: false, payment: p, credited: 0, mismatch: false, invoiceReceipt: r ? { id: r.receipt.id, invoiceId: r.invoiceId, number: r.number } : null };
  }
  const credited = await fulfil(tx, p, paid, plan, opts);
  return { already: false, payment: p, credited, mismatch: false };
}

/** Side effects after a markPaymentPaid transaction committed (alert on mismatch; receipt, audit, referral on success). */
async function afterPaid(result: PaidResult, opts: PaidOpts) {
  const paymentId = result.payment.id;
  if (result.mismatch) {
    const source =
      result.refused === "TOPUP_CANCELLED" ? "cancelled-topup" : result.refused === "UNDERPAID" ? "underpaid" : result.refused === "INVOICE_CANCELLED" ? "cancelled-invoice-payment" : result.refused === "INVOICE_CHANGED" || result.refused === "INVOICE_OVERPAID" ? "invoice-changed" : "verify";
    await amountMismatch(result.payment, opts.amount ?? result.payment.amount, source);
    return;
  }
  if (result.already) return;
  if (result.payment.purpose === "INVOICE") {
    const r = result.invoiceReceipt;
    void notify("payment.received", { userId: result.payment.userId }, { amount: rs(opts.amount ?? result.payment.amount), reference: r ? `invoice ${r.number}` : result.payment.reference }, { dedupeKey: `paid:${paymentId}`, link: r ? `/team/invoices/${r.invoiceId}` : undefined });
    await audit({
      actorId: opts.actorId ?? result.payment.userId,
      action: "invoice.payment_online",
      entity: "Invoice",
      entityId: r?.invoiceId ?? null,
      summary: `${rs(opts.amount ?? result.payment.amount)} paid online (${result.payment.method}, ${result.payment.reference})${r ? ` · ${r.number}` : ""}`,
      after: { paymentId, receiptId: r?.id ?? null, method: result.payment.method },
    });
    return;
  }
  const topup = result.payment.purpose === "WALLET_TOPUP";
  void notify("payment.received", { userId: result.payment.userId }, { amount: rs(opts.amount ?? result.payment.amount), reference: result.payment.reference }, { dedupeKey: `paid:${paymentId}`, link: topup ? `/account/wallet/topup/${paymentId}` : `/thank-you/${paymentId}` });
  if (opts.actorId)
    await audit({
      actorId: opts.actorId,
      action: topup ? "wallet.topup_verify" : "payment.mark_paid",
      entity: "Payment",
      entityId: paymentId,
      summary: topup ? `Wallet top-up ${result.payment.reference} verified · ${rs(result.payment.amount)} credited` : `${result.payment.reference} marked paid`,
      reason: opts.note,
    });
  // WP-15: payment may be the last condition for a referral reward (idempotent; never blocks payment).
  if (!topup) void import("../marketing").then((m) => m.settleReferralFor(result.payment.userId)).catch((error) => log.error("referral.settle_failed", { paymentId, error }));
}

/**
 * Dispatch a freshly-paid payment by purpose. Runs inside markPaymentPaid's transaction, after the guarded flip.
 * Returns wallet credit given back as REFUND (late / over-payment) — not top-up credit, which is the purchase itself.
 */
async function fulfil(tx: Tx, p: PayingPayment, paid: number, plan: OrderPlan | null, opts: PaidOpts): Promise<number> {
  switch (p.purpose) {
    case "WALLET_TOPUP":
      await creditTopupPayment(tx, p, opts.actorId);
      return 0;
    case "SWAP_DIFFERENCE":
      return fulfilSwapDifference(tx, p, paid, opts);
    case "INVOICE":
      // Settled in markPaymentPaidTx (settleInvoicePayment) — it needs the receipt back. Never reaches the order code.
      throw new PaymentError("Invoice payments are settled by settleInvoicePayment");
    case "ORDER":
    case "SUBSCRIPTION":
    default:
      return fulfilOrders(tx, p, paid, plan!, opts);
  }
}

/**
 * Phase 2C: apply the pending plan swap a SWAP_DIFFERENCE payment was for (subscriptions.applySwapDifference). If it
 * can't be applied any more (meal changed, cut-off passed, sold out, price moved) the whole verified amount becomes
 * wallet credit; when it is applied, only a surplus over the difference does. Never both.
 */
async function fulfilSwapDifference(tx: Tx, p: PayingPayment, paid: number, opts: PaidOpts): Promise<number> {
  const r = await applySwapDifference(tx, p, { amount: p.amount, actorId: opts.actorId });
  let credited = r.credited;
  if (r.applied && paid > p.amount) {
    await addCredit(tx, { userId: p.userId, amount: paid - p.amount, reason: "REFUND", paymentId: p.id, note: "Paid more than the swap difference" });
    credited += paid - p.amount;
  } else if (!r.applied && paid > r.credited) {
    await addCredit(tx, { userId: p.userId, amount: paid - r.credited, reason: "REFUND", paymentId: p.id, note: "Paid more than the swap difference" });
    credited = paid;
  }
  if (credited > 0) await tx.payment.update({ where: { id: p.id }, data: { refundedAmount: { increment: credited }, status: credited >= paid ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
  return credited;
}

type OrderRow = PayingPayment["orders"][number];
type OrderPlan = { release: OrderRow[]; late: OrderRow[]; owing: OrderRow[]; owed: number };

/**
 * What a payment for orders pays for right now (read under the payment lock, before the flip):
 *   release = PENDING_PAYMENT orders still before their cut-off → SCHEDULED + PAID;
 *   late    = PENDING_PAYMENT orders whose day has closed → cancelled, their share credited;
 *   owing   = live orders already released unpaid (cash switch) → PAID.
 * `owed` = Σ customerShare of release + owing — the money the still-live orders need (no orders: the amount).
 */
async function planOrderFulfilment(tx: Tx, p: PayingPayment, settings: SiteSettings): Promise<OrderPlan> {
  const now = ktmNow();
  const plan: OrderPlan = { release: [], late: [], owing: [], owed: 0 };
  for (const o of p.orders) {
    if (o.status === "PENDING_PAYMENT") {
      const date = isoDate(o.deliveryDate);
      const lock = date === now.date ? await tx.dayLock.findUnique({ where: { kitchenId_date: { kitchenId: o.kitchenId, date: o.deliveryDate } } }) : null;
      const late = date < now.date || (date === now.date && (now.time >= settings.orderCutoff || Boolean(lock)));
      (late ? plan.late : plan.release).push(o);
    } else if (o.status !== "CANCELLED" && o.status !== "SKIPPED" && (o.paymentStatus === "UNPAID" || o.paymentStatus === "PENDING")) plan.owing.push(o);
  }
  // A payment with no orders (e.g. a company invoice paid online) owes exactly its amount.
  plan.owed = p.orders.length ? [...plan.release, ...plan.owing].reduce((a, o) => a + o.customerShare, 0) : p.amount;
  return plan;
}

/**
 * Release the payment's orders (and plan). The credit is computed ONCE: surplus = verified amount − what the
 * still-live orders owe. It is attributed first to late orders (cancelled now), then to orders cancelled while the
 * payment was pending (their share was taken off payment.amount, but a stale gateway session may still have paid
 * it), and anything left is plain overpayment. Never "cancelled share" AND "overpayment" for the same money, and an
 * order is marked PAID only when the money covers it (the caller refuses paid < owed).
 */
async function fulfilOrders(tx: Tx, p: PayingPayment, paid: number, plan: OrderPlan, opts: PaidOpts): Promise<number> {
  const surplus = Math.max(0, paid - plan.owed);
  let left = surplus;
  const guarded = async (o: OrderRow, data: Prisma.OrderUpdateManyMutationInput) => {
    const u = await tx.order.updateMany({ where: { id: o.id, status: o.status, version: o.version }, data: { ...data, version: { increment: 1 } } });
    if (!u.count) throw new PaymentError(`Order ${o.number} changed while the payment was being confirmed — try again`);
  };
  for (const o of plan.release) {
    await guarded(o, { status: "SCHEDULED", paymentStatus: "PAID" });
    await tx.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: "PENDING_PAYMENT", toStatus: "SCHEDULED", note: "Payment received", actorId: opts.actorId ?? null } });
  }
  for (const o of plan.owing) await guarded(o, { paymentStatus: "PAID" });
  for (const o of plan.late) {
    const back = Math.min(o.customerShare, left);
    left -= back;
    await guarded(o, { status: "CANCELLED", cancelledAt: new Date(), paymentStatus: back >= o.customerShare ? "REFUNDED" : back > 0 ? "PARTIALLY_REFUNDED" : undefined, refundedAmount: back });
    await tx.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: "PENDING_PAYMENT", toStatus: "CANCELLED", note: "Payment arrived after the cut-off — credited", actorId: opts.actorId ?? null } });
    if (back > 0) await addCredit(tx, { userId: p.userId, amount: back, reason: "REFUND", orderId: o.id, paymentId: p.id, note: "Payment arrived after the day closed" });
  }
  for (const o of p.orders) {
    if (o.status !== "CANCELLED" || o.paymentStatus === "REFUNDED" || o.customerShare <= 0) continue;
    // Cancelled while the payment was pending. Covered only if the verified money actually included it.
    const back = Math.min(o.customerShare - o.refundedAmount, left);
    if (back <= 0) continue;
    left -= back;
    await guarded(o, { paymentStatus: back + o.refundedAmount >= o.customerShare ? "REFUNDED" : "PARTIALLY_REFUNDED", refundedAmount: { increment: back } });
    await addCredit(tx, { userId: p.userId, amount: back, reason: "REFUND", orderId: o.id, paymentId: p.id, note: "Paid after the order had been cancelled" });
  }
  // Skipped unpaid plan meals (moved to the end of the plan) carry no money of their own.
  for (const o of p.orders) if (o.status === "SKIPPED" && (o.paymentStatus === "UNPAID" || o.paymentStatus === "PENDING")) await guarded(o, { paymentStatus: "PAID" });
  if (left > 0) await addCredit(tx, { userId: p.userId, amount: left, reason: "REFUND", paymentId: p.id, note: "Paid more than the order total" });
  if (p.subscriptionId) {
    await tx.subscription.updateMany({ where: { id: p.subscriptionId, status: "PENDING_PAYMENT" }, data: { status: "ACTIVE" } });
  }
  if (surplus > 0) {
    await tx.payment.update({ where: { id: p.id }, data: { refundedAmount: { increment: surplus }, status: surplus >= paid ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
  }
  return surplus;
}

/**
 * A gateway (or verification) amount that doesn't match our payment: record a MISMATCH provider event (unless the
 * caller already did) and raise the GATEWAY_MISMATCH alert right away — same dedupe key the payment-mismatch
 * detector uses, so its sweep won't duplicate it. Never credits anything.
 */
async function amountMismatch(p: Pick<Payment, "id" | "method">, got: number, source: string, eventId?: string | null) {
  const provider = p.method.toLowerCase();
  const id = eventId ?? (await recordEvent(provider, `${provider}:${p.id}:amount:${got}:${source}`, p.id, { source, got }, false, "MISMATCH"));
  if (!id) return;
  try {
    const { raiseMismatchAlert } = await import("../alerts/raise");
    await raiseMismatchAlert(id);
  } catch (error) {
    log.error("payment.mismatch_alert_failed", { paymentId: p.id, error });
  }
}

async function markAttemptFailed(attemptId: string, paymentId: string, response: unknown, reason = "The gateway declined the payment") {
  const live = await db.paymentAttempt.updateMany({ where: { id: attemptId, status: "STARTED" }, data: { status: "FAILED", response: json(response) } });
  // A superseded (EXPIRED) session failing says nothing about the payment's current session.
  if (!live.count) return void (await db.paymentAttempt.updateMany({ where: { id: attemptId, status: "EXPIRED" }, data: { status: "FAILED", response: json(response) } }));
  const u = await db.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "FAILED" } });
  if (u.count) await notifyPaymentFailed(paymentId, reason, `failed:${attemptId}`);
}

/** In-app + push: the customer's payment failed (gateway declined / bank transfer rejected). */
async function notifyPaymentFailed(paymentId: string, reason: string, dedupeKey: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, select: { id: true, userId: true, reference: true, purpose: true, idempotencyKey: true } });
  if (!p) return;
  const invoiceId = p.purpose === "INVOICE" ? invoiceIdOfPayment(p) : null;
  const link = p.purpose === "WALLET_TOPUP" ? `/account/wallet/topup/${p.id}` : invoiceId ? `/team/invoices/${invoiceId}` : `/pay/${p.id}`;
  await notify("payment.failed", { userId: p.userId }, { reason: reason.slice(0, 140), reference: p.reference }, { link, dedupeKey });
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
  if (p.status === "CANCELLED") throw new PaymentError(p.purpose === "INVOICE" ? "The invoice changed since this payment was started — start again from the invoice" : "This order expired — please order again");
  if (p.amount <= 0) throw new PaymentError("Nothing to pay");
  if (p.purpose === "WALLET_TOPUP" && !topupEnabled(await getSettings())) throw new PaymentError("Adding credit isn't available right now");
  if (p.purpose === "INVOICE") {
    if (p.method !== "ESEWA" && p.method !== "KHALTI") throw new PaymentError("Pay invoices online with eSewa or Khalti");
    try {
      await assertInvoicePaymentStartable(p);
    } catch (e) {
      throw new PaymentError(e instanceof Error ? e.message : "This invoice can't be paid now");
    }
  }
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
    const ev = await recordEvent("esewa", `${eventKey}:amount`, paymentId, payload, false, "MISMATCH");
    if (ev) await amountMismatch({ id: paymentId, method: "ESEWA" }, toPaisa(payload.total_amount), "esewa-callback", ev);
    return { ok: false, reason: "Amount mismatch" };
  }
  return confirmEsewa(attempt.id, paymentId, attempt.providerRef, attempt.amount, eventKey, payload);
}

async function confirmEsewa(attemptId: string, paymentId: string, uuid: string, amount: number, eventKey: string, payload: unknown): Promise<VerifyOutcome> {
  const s = await esewaStatus(uuid, amount);
  if (s.status === "COMPLETE") {
    const fresh = await recordEvent("esewa", `${eventKey}:status:COMPLETE`, paymentId, { callback: payload, status: s.raw }, true, "PAID");
    await db.paymentAttempt.update({ where: { id: attemptId }, data: { response: json({ callback: payload, status: s.raw }) } });
    if (fresh && (await markPaymentPaid(paymentId, { amount, attemptId })).mismatch) return { ok: false, reason: "Amount mismatch — contact us" };
    return { ok: true };
  }
  if (s.status === null || s.status === "PENDING" || s.status === "AMBIGUOUS") {
    await recordEvent("esewa", `${eventKey}:status:${s.status ?? "unreachable"}:${Date.now()}`, paymentId, { callback: payload, status: s.raw }, false, "IGNORED");
    return { ok: false, pending: true, reason: "eSewa hasn't confirmed yet — we'll keep checking" };
  }
  await recordEvent("esewa", `${eventKey}:status:${s.status}`, paymentId, { callback: payload, status: s.raw }, true, "FAILED");
  await markAttemptFailed(attemptId, paymentId, s.raw, `eSewa reported the payment as ${String(s.status).toLowerCase()}`);
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
    if (fresh && (await markPaymentPaid(paymentId, { amount, attemptId })).mismatch) return { ok: false, reason: "Amount mismatch — contact us" };
    return { ok: true };
  }
  if (r.ok && r.status === "Completed") {
    const ev = await recordEvent("khalti", `khalti:${pidx}:amount`, paymentId, r, false, "MISMATCH");
    if (ev) await amountMismatch({ id: paymentId, method: "KHALTI" }, r.total_amount ?? 0, "khalti-lookup", ev);
    return { ok: false, reason: "Amount mismatch — contact us" };
  }
  if (!r.ok || r.status === "Pending" || r.status === "Initiated") return { ok: false, pending: true, reason: "Khalti hasn't confirmed yet" };
  await recordEvent("khalti", `khalti:${pidx}:${r.status}`, paymentId, r, true, "FAILED");
  await markAttemptFailed(attemptId, paymentId, r, `Khalti reported the payment as ${String(r.status).toLowerCase()}`);
  return { ok: false, reason: `Khalti status: ${r.status}` };
}

/** Cron: re-check gateway attempts that never came back (closed tab, network drop). */
export async function reconcileGatewayAttempts() {
  const since = new Date(Date.now() - 3 * 24 * 3600_000);
  const before = new Date(Date.now() - 5 * 60_000);
  const attempts = await db.paymentAttempt.findMany({
    // EXPIRED = superseded by an amount/method change (or given up after 24 h): still polled for 3 days so money paid
    // through a stale session is never silently lost — markPaymentPaid re-checks it against the current payment.
    where: { status: { in: ["STARTED", "EXPIRED"] }, createdAt: { gte: since, lte: before }, payment: { status: { in: ["PENDING", "FAILED", "CANCELLED"] } } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let paid = 0;
  for (const a of attempts) {
    try {
      const r = a.method === "ESEWA" ? await confirmEsewa(a.id, a.paymentId, a.providerRef, a.amount, `esewa:${a.providerRef}:reconcile`, { reconcile: true }) : await confirmKhalti(a.id, a.paymentId, a.providerRef, a.amount);
      if (r.ok) paid++;
      else if (!r.pending) continue;
      else if (a.status === "STARTED" && a.createdAt < new Date(Date.now() - 24 * 3600_000)) await db.paymentAttempt.update({ where: { id: a.id }, data: { status: "EXPIRED" } });
    } catch (e) {
      log.warn("reconcile.failed", { attemptId: a.id, error: e });
    }
  }
  return { checked: attempts.length, paid };
}

// ───────────── switching method / manual flows ─────────────

/**
 * Change how an unpaid payment will be paid (e.g. Khalti failed → cash). Runs under the payment lock with a guarded
 * write; open gateway sessions of the old method are expired (a later verification of one is re-checked against
 * the current amount in markPaymentPaid). Switching to WALLET debits and marks paid in ONE transaction, so two
 * concurrent switches can't both debit.
 */
export async function switchPaymentMethod(paymentId: string, userId: string, method: PaymentMethod) {
  const settings = await getSettings();
  const p0 = await db.payment.findFirst({ where: { id: paymentId, userId }, include: { orders: true } });
  if (!p0 || !["PENDING", "FAILED"].includes(p0.status)) throw new PaymentError("Nothing to pay here");
  const methods = await availableMethods(settings, { hasCompany: Boolean(p0.companyId), customerShare: p0.amount });
  if (!methods.includes(method)) throw new PaymentError("That payment method isn't available");
  if (p0.purpose === "SWAP_DIFFERENCE" && !["ESEWA", "KHALTI", "WALLET"].includes(method)) throw new PaymentError("Pay a swap difference with eSewa, Khalti or credit");
  // Company invoices: eSewa / Khalti only (bank transfers are recorded by finance as receipts; never personal credit).
  if (p0.purpose === "INVOICE" && method !== "ESEWA" && method !== "KHALTI") throw new PaymentError("Pay invoices online with eSewa or Khalti — or by bank transfer to the account shown");
  if (p0.purpose === "WALLET_TOPUP") {
    // Credit is bought with eSewa / Khalti / bank only (never with credit or cash at the door).
    if (!topupEnabled(settings)) throw new PaymentError("Adding credit isn't available right now");
    if (!isTopupMethod(method)) throw new PaymentError("Top-ups can be paid with eSewa, Khalti or bank transfer");
    if (p0.proofUrl) throw new PaymentError("Your transfer proof is being checked — wait for finance to confirm it");
  }
  if (method === p0.method && p0.status === "PENDING") return p0;
  if (method === "WALLET") {
    const res = await db.$transaction(async (tx) => {
      await lockPayment(tx, paymentId);
      const p = await tx.payment.findFirst({ where: { id: paymentId, userId } });
      if (!p || !["PENDING", "FAILED"].includes(p.status)) throw new PaymentError("Nothing to pay here");
      if ((await walletBalance(userId, tx)) < p.amount) throw new PaymentError("Not enough credit");
      await expireOpenAttempts(tx, p.id);
      await spendCredit(tx, { userId, amount: p.amount, paymentId: p.id, note: `Payment ${p.reference}` });
      await tx.payment.update({ where: { id: p.id }, data: { method: "WALLET", status: "PENDING", version: { increment: 1 } } });
      return markPaymentPaidTx(tx, p.id, { amount: p.amount }, settings);
    });
    await afterPaid(res, { amount: res.payment.amount });
    return p0;
  }
  await db.$transaction(async (tx) => {
    await lockPayment(tx, paymentId);
    const p = await tx.payment.findFirst({ where: { id: paymentId, userId }, include: { orders: true } });
    if (!p || !["PENDING", "FAILED"].includes(p.status)) throw new PaymentError("Nothing to pay here");
    if (p.proofUrl && p.purpose === "WALLET_TOPUP") throw new PaymentError("Your transfer proof is being checked — wait for finance to confirm it");
    if (method === p.method && p.status === "PENDING") return;
    await expireOpenAttempts(tx, p.id);
    const u = await tx.payment.updateMany({ where: { id: p.id, version: p.version }, data: { method, status: "PENDING", version: { increment: 1 } } });
    if (!u.count) throw new PaymentError("This payment just changed — reload and try again");
    if (method === "CASH" && p.purpose !== "WALLET_TOPUP") {
      // Cash is collected at the door: release the orders now (still subject to the cut-off).
      const now = ktmNow();
      for (const o of p.orders.filter((x) => x.status === "PENDING_PAYMENT")) {
        const d = isoDate(o.deliveryDate);
        if (d < now.date || (d === now.date && now.time >= settings.orderCutoff)) continue;
        const r = await tx.order.updateMany({ where: { id: o.id, status: "PENDING_PAYMENT" }, data: { status: "SCHEDULED", paymentStatus: "UNPAID", version: { increment: 1 } } });
        if (!r.count) continue;
        await tx.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: "PENDING_PAYMENT", toStatus: "SCHEDULED", note: "Switched to cash on delivery", actorId: userId } });
      }
      if (p.subscriptionId) await tx.subscription.updateMany({ where: { id: p.subscriptionId, status: "PENDING_PAYMENT" }, data: { status: "ACTIVE" } });
    }
  });
  return p0;
}

/** Customer uploads a bank-transfer / QR screenshot. Finance verifies it against the bank statement. */
export async function submitTransferProof(paymentId: string, userId: string, proofUrl: string, reference: string) {
  const p = await db.payment.findFirst({ where: { id: paymentId, userId, method: "BANK_TRANSFER" } });
  if (!p || p.status === "PAID") throw new PaymentError("Nothing to confirm");
  if (p.purpose === "WALLET_TOPUP" && p.status === "CANCELLED") throw new PaymentError("This top-up was cancelled — start a new one");
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
  void notifyPaymentFailed(paymentId, reason ? `Your transfer couldn't be confirmed: ${reason}` : "Your transfer couldn't be confirmed", `rejected:${paymentId}:${p.version}`);
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

export type RefundInput = { paymentId: string; orderId?: string | null; amount: number; reason: string; method: RefundMethod; actorId: string };

/** What can still be refunded on a payment (and on one of its orders), counting open refund requests. */
export async function refundableNow(paymentId: string, orderId?: string | null, client: Tx | typeof db = db) {
  const p = await client.payment.findUnique({ where: { id: paymentId }, select: { id: true, userId: true, status: true, amount: true, refundedAmount: true, purpose: true } });
  if (!p) return null;
  const pending = await client.refund.aggregate({ _sum: { amount: true }, where: { paymentId, status: { in: ["REQUESTED", "APPROVED"] } } });
  const payment = p.amount - p.refundedAmount - (pending._sum.amount ?? 0);
  let order: number | null = null;
  if (orderId) {
    const o = await client.order.findUnique({ where: { id: orderId }, select: { paymentId: true, customerShare: true, refundedAmount: true } });
    if (o && o.paymentId === paymentId) {
      const open = await client.refund.aggregate({ _sum: { amount: true }, where: { orderId, status: { in: ["REQUESTED", "APPROVED"] } } });
      order = o.customerShare - o.refundedAmount - (open._sum.amount ?? 0);
    }
  }
  return { payment: p, available: Math.max(0, payment), orderAvailable: order === null ? null : Math.max(0, order) };
}

/**
 * Create a refund inside a caller's transaction. Re-validates everything under a per-payment lock: the payment is
 * paid, the amount fits what's left (payment-wide and, when an order is named, on that order), and the order really
 * belongs to the payment (no refunding order B against payment A). Works for any Payment purpose.
 * `approvedById` (maker-checker execution) creates the refund already APPROVED by that second person.
 */
export async function requestRefundTx(tx: Tx, input: RefundInput & { approvedById?: string | null }) {
  const p = await checkRefundTx(tx, input);
  return tx.refund.create({
    data: {
      paymentId: p.id,
      orderId: input.orderId ?? null,
      amount: input.amount,
      reason: input.reason,
      method: input.method,
      requestedById: input.actorId,
      ...(input.approvedById ? { status: "APPROVED" as const, approvedById: input.approvedById } : {}),
    },
  });
}

/** requestRefundTx's validation (takes the refund lock; throws PaymentError) without creating anything. */
async function checkRefundTx(tx: Tx, input: RefundInput) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new PaymentError("Enter an amount");
  if (!input.reason.trim()) throw new PaymentError("Give a reason");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refund:${input.paymentId}`}))`;
  const { p, available } = await refundable(tx, input.paymentId);
  if (!["PAID", "PARTIALLY_REFUNDED"].includes(p.status)) throw new PaymentError("Only paid payments can be refunded");
  if (input.amount > available) throw new PaymentError(`At most ${rs(available)} can be refunded`);
  // Closed-loop credit (security review L10): what was paid with wallet credit only ever goes back as credit, so
  // goodwill / skip / adjustment credit can't be turned into cash through a refund.
  if (p.method === "WALLET" && input.method !== "WALLET_CREDIT") throw new PaymentError("This was paid with Dabba Bela credit — it can only be refunded as credit");
  // A company-invoice payment settled the invoice (receipt + paidAmount); money back to a company goes through a credit
  // note and a bank payment recorded by finance, never a personal refund / wallet credit to the admin who paid.
  if (p.purpose === "INVOICE") throw new PaymentError("This paid a company invoice — issue a credit note on the invoice instead of a refund");
  if (p.purpose === "WALLET_TOPUP") {
    // A top-up goes back to its source, and only the part the customer hasn't spent (wallet never goes negative).
    // Enforced here, so a maker-checker execution (approvals.ts → requestRefundTx) gets the same cap.
    if (input.method === "WALLET_CREDIT") throw new PaymentError("A top-up is refunded to the customer's eSewa / Khalti / bank, not to credit");
    if (input.orderId) throw new PaymentError("A top-up has no orders — refund the whole payment");
    await lockUser(tx, p.userId);
    const unspent = (await topupRefundable(p.id, tx)) ?? 0;
    if (input.amount > unspent) throw new PaymentError(unspent > 0 ? `Only ${rs(unspent)} of this top-up is unspent — at most that can be refunded` : "The customer has already spent this credit — nothing left to refund");
  }
  if (input.orderId) {
    const o = await tx.order.findUnique({ where: { id: input.orderId }, select: { paymentId: true, customerShare: true, refundedAmount: true, number: true } });
    if (!o || o.paymentId !== p.id) throw new PaymentError("That order wasn't paid with this payment");
    const open = await tx.refund.aggregate({ _sum: { amount: true }, where: { orderId: input.orderId, status: { in: ["REQUESTED", "APPROVED"] } } });
    const left = o.customerShare - o.refundedAmount - (open._sum.amount ?? 0);
    if (input.amount > left) throw new PaymentError(`At most ${rs(Math.max(0, left))} can be refunded on order ${o.number}`);
  }
  return p;
}

/**
 * A staff member's own refund request (no second person yet). Refused with NeedsApprovalError when it would reach the
 * approval threshold — alone, or with the refunds already on this payment — or the person's rolling-24h money limit
 * (money-limits.ts); the caller then files an ApprovalRequest instead.
 */
export async function requestRefund(input: RefundInput) {
  const r = await db.$transaction(async (tx) => {
    // Lock order: this person's money lock first, then the payment's refund lock (and the customer's ledger lock).
    await lockStaffMoney(tx, input.actorId);
    await checkRefundTx(tx, input); // a bad request is an error, not something to send for approval
    await assertWithinStaffLimits(tx, { actorId: input.actorId, amount: input.amount, paymentId: input.paymentId });
    return requestRefundTx(tx, input);
  });
  await audit({ actorId: input.actorId, action: "refund.request", entity: "Refund", entityId: r.id, summary: `${rs(r.amount)} via ${r.method}`, reason: input.reason });
  return r;
}

/**
 * Approve a requested refund. Maker-checker safety net (covers refunds created by any path, e.g. a cancellation
 * with a REFUND settlement): at or above the approval threshold the approver must be someone other than the requester.
 */
export async function approveRefund(refundId: string, actorId: string) {
  const ref = await db.refund.findUnique({ where: { id: refundId }, select: { amount: true, requestedById: true, status: true, paymentId: true } });
  if (!ref || ref.status !== "REQUESTED") throw new PaymentError("Refund isn't waiting for approval");
  if (ref.requestedById === actorId) {
    // Self-approval only below every maker-checker limit: the threshold (alone or summed over the payment's refunds)
    // and the approver's own rolling-24h limit (this refund already counts in it — it is theirs).
    const s = await getSettings();
    const total = await paymentRefundTotal(ref.paymentId);
    if (s.approvalThreshold > 0 && (ref.amount >= s.approvalThreshold || total >= s.approvalThreshold))
      throw new PaymentError(`Refunds of ${rs(s.approvalThreshold)} or more (also when refunds on one payment add up to it) need a second person — someone else has to approve a refund you requested`);
    if (s.staffDailyMoneyLimit > 0 && (await staffMoneyUsed24h(actorId)) >= s.staffDailyMoneyLimit)
      throw new PaymentError(`You've reached your ${rs(s.staffDailyMoneyLimit)} 24-hour limit — someone else has to approve a refund you requested`);
  }
  const r = await db.refund.updateMany({ where: { id: refundId, status: "REQUESTED" }, data: { status: "APPROVED", approvedById: actorId } });
  if (!r.count) throw new PaymentError("Refund isn't waiting for approval");
  await audit({ actorId, action: "refund.approve", entity: "Refund", entityId: refundId });
}

export async function rejectRefund(refundId: string, actorId: string, reason: string) {
  const rolledBack = await db.$transaction(async (tx) => {
    const r0 = await tx.refund.findUnique({ where: { id: refundId }, select: { paymentId: true } });
    if (!r0) throw new PaymentError("Refund can't be rejected now");
    // Lock order payment → refund requests (as everywhere), so a payout can't run while the meals are rolled back.
    await lockPayment(tx, r0.paymentId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refund:${r0.paymentId}`}))`;
    const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    const u = await tx.refund.updateMany({ where: { id: refundId, status: { in: ["REQUESTED", "APPROVED"] } }, data: { status: "REJECTED", note: reason, processedById: actorId } });
    if (!u.count) throw new PaymentError("Refund can't be rejected now");
    return rollbackPlanCancelRefund(tx, r);
  });
  await audit({ actorId, action: "refund.reject", entity: "Refund", entityId: refundId, reason, ...(rolledBack ? { after: { mealsRolledBack: rolledBack.orders, amount: rolledBack.amount } } : {}) });
}

/** `reason` written by cancelSubscription's REFUND settlement (one refund per payment for the plan's meals). */
const PLAN_CANCEL_REFUND = /^Plan (\S+) cancelled: /;

/**
 * The cancelled-meal rows a plan-cancel REFUND request covers: the plan's CANCELLED meals on that payment whose
 * customer share was marked refunded when the request was made but whose money hasn't gone back yet (paymentStatus
 * still PAID — a processed refund marks them REFUNDED). Empty for any other refund.
 */
async function planCancelRefundMeals(tx: Tx, r: { paymentId: string; orderId: string | null; reason: string }) {
  const m = r.orderId ? null : PLAN_CANCEL_REFUND.exec(r.reason);
  if (!m) return [];
  const sub = await tx.subscription.findUnique({ where: { reference: m[1] }, select: { id: true } });
  if (!sub) return [];
  return tx.order.findMany({ where: { subscriptionId: sub.id, paymentId: r.paymentId, status: "CANCELLED", paymentStatus: "PAID", refundedAmount: { gt: 0 } }, orderBy: { deliveryDate: "desc" } });
}

/**
 * A plan-cancel REFUND request was rejected: the meals' `refundedAmount` (set when the request was made) goes back
 * down by the refund's amount, so refunded figures aren't overstated and the meals stay refundable / creditable
 * later through the normal per-order paths (security note in docs/SECURITY.md).
 */
async function rollbackPlanCancelRefund(tx: Tx, r: { paymentId: string; orderId: string | null; reason: string; amount: number }) {
  const meals = await planCancelRefundMeals(tx, r);
  if (!meals.length) return null;
  let left = r.amount;
  const orders: string[] = [];
  for (const o of meals) {
    if (left <= 0) break;
    const back = Math.min(o.refundedAmount, left);
    const u = await tx.order.updateMany({ where: { id: o.id, refundedAmount: o.refundedAmount, paymentStatus: "PAID" }, data: { refundedAmount: { decrement: back }, version: { increment: 1 } } });
    if (!u.count) throw new PaymentError("A meal on this refund just changed — reload and try again");
    left -= back;
    orders.push(o.number);
  }
  return { orders, amount: r.amount - left };
}

/**
 * Close a refund. Money back through a gateway/bank/cash needs proof (transaction id or receipt);
 * we never mark money as returned without it. Wallet credit is posted to the ledger here.
 */
export async function processRefund(refundId: string, actorId: string, proof: { providerRef?: string; proofUrl?: string; note?: string }) {
  const out = await db.$transaction(async (tx) => {
    const r0 = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, select: { paymentId: true } });
    // Same lock order as everywhere: payment → refund requests.
    await lockPayment(tx, r0.paymentId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refund:${r0.paymentId}`}))`;
    const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
    if (r.status !== "APPROVED") throw new PaymentError("Approve the refund first");
    if (r.method !== "WALLET_CREDIT" && !proof.providerRef?.trim() && !proof.proofUrl) throw new PaymentError("Add the transaction reference or a receipt as proof");
    // Segregation of duties (H4): money leaving the business (gateway / bank / cash) is paid out by someone other than
    // the person who asked for it — super admins included.
    if (r.method !== "WALLET_CREDIT" && r.requestedById === actorId) throw new PaymentError("Someone else has to pay out a refund you requested");
    if (r.payment.method === "WALLET" && r.method !== "WALLET_CREDIT") throw new PaymentError("This was paid with Dabba Bela credit — it can only be refunded as credit");
    // Re-check the cap at payout (C1): this refund plus the other approved ones must fit what is left on the payment.
    const others = await tx.refund.aggregate({ where: { paymentId: r.paymentId, status: "APPROVED", id: { not: r.id } }, _sum: { amount: true } });
    const left = r.payment.amount - r.payment.refundedAmount;
    if (r.amount > left) throw new PaymentError(`Only ${rs(Math.max(0, left))} is left to refund on this payment — reject this refund`);
    if (r.amount + (others._sum.amount ?? 0) > left) throw new PaymentError(`Approved refunds on this payment add up to more than the ${rs(Math.max(0, left))} left — reject one of them first`);
    if (r.orderId) {
      const o = await tx.order.findUniqueOrThrow({ where: { id: r.orderId }, select: { customerShare: true, refundedAmount: true, number: true } });
      if (r.amount > o.customerShare - o.refundedAmount) throw new PaymentError(`Only ${rs(Math.max(0, o.customerShare - o.refundedAmount))} is left to refund on order ${o.number} — reject this refund`);
    }
    const u = await tx.refund.updateMany({
      where: { id: r.id, status: "APPROVED" },
      data: { status: "PROCESSED", processedById: actorId, processedAt: new Date(), providerRef: proof.providerRef?.trim() || null, proofUrl: proof.proofUrl || null, note: proof.note || r.note },
    });
    if (!u.count) throw new PaymentError("Refund changed — reload");
    if (r.payment.purpose === "WALLET_TOPUP") {
      // Take the refunded credit back out of the wallet (TOPUP_REVERSAL), re-checked under the user's ledger lock so a
      // spend since the request can't push the balance below zero.
      if (r.method === "WALLET_CREDIT") throw new PaymentError("A top-up is refunded to its source, not to credit");
      await lockUser(tx, r.payment.userId);
      const unspent = (await topupRefundable(r.paymentId, tx, { excludeRefundId: r.id })) ?? 0;
      if (r.amount > unspent) throw new PaymentError(unspent > 0 ? `The customer has spent part of this credit since the request — at most ${rs(unspent)} can be refunded now. Reject this refund and request a smaller one.` : "The customer has spent this credit since the request — reject this refund");
      await tx.creditLedger.create({ data: { userId: r.payment.userId, amount: -r.amount, reason: "TOPUP_REVERSAL", paymentId: r.paymentId, refundId: r.id, actorId, note: `Top-up ${r.payment.reference} refunded` } });
    }
    if (r.method === "WALLET_CREDIT") await addCredit(tx, { userId: r.payment.userId, amount: r.amount, reason: "REFUND", paymentId: r.paymentId, refundId: r.id, orderId: r.orderId, actorId });
    await bumpPaymentRefund(tx, r.paymentId, r.amount);
    if (!r.orderId) {
      // Plan-cancel REFUND: the money for the cancelled meals has now actually gone back.
      let left = r.amount;
      for (const o of await planCancelRefundMeals(tx, r)) {
        if (left <= 0) break;
        left -= o.refundedAmount;
        await tx.order.updateMany({ where: { id: o.id, paymentStatus: "PAID" }, data: { paymentStatus: o.refundedAmount >= o.customerShare ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
      }
    }
    if (r.orderId) {
      const o = await tx.order.findUniqueOrThrow({ where: { id: r.orderId } });
      const refunded = o.refundedAmount + r.amount;
      await tx.order.update({ where: { id: o.id }, data: { refundedAmount: refunded, paymentStatus: refunded >= o.customerShare ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    }
    return r;
  });
  await audit({ actorId, action: "refund.process", entity: "Refund", entityId: refundId, summary: `${rs(out.amount)} via ${out.method}${out.payment.purpose === "WALLET_TOPUP" ? ` · top-up ${out.payment.reference}: ${rs(out.amount)} taken out of the wallet` : ""}`, after: proof });
  void notify("refund.processed", { userId: out.payment.userId }, { amount: rs(out.amount), method: out.method === "WALLET_CREDIT" ? "added to your Dabba Bela credit" : out.method.toLowerCase() }, { dedupeKey: `refund:${refundId}` });
  return out;
}

export { dateOnly };
