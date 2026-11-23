import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Serialise every change to one payment's amount, method or status — and its verification (markPaymentPaid), refund
 * processing and requests. A transaction-scoped advisory lock: take it first thing in the transaction that reads and
 * then changes the payment, so a concurrent cancel / swap / method switch / gateway return can't work on a stale read.
 */
export async function lockPayment(tx: Tx, paymentId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pay:${paymentId}`}))`;
}

/**
 * A gateway session (eSewa form / Khalti pidx) is started for the payment's amount and method at that moment. When
 * either changes (an order or plan meal cancelled, a DUE_LATER swap, a method switch, a top-up cancelled), the open
 * sessions are marked EXPIRED: the customer gets a fresh session for the new amount (startPayment always creates one),
 * and if an old one is still paid at the gateway (return handler, or the reconcile cron, which keeps polling recent
 * EXPIRED sessions so real money is never silently lost) `markPaymentPaid` re-checks the verified amount against the
 * current payment: less → refused + GATEWAY_MISMATCH alert, payment stays unpaid; more → the surplus over what the
 * still-live orders owe becomes wallet credit, once. A cancelled top-up is never credited (refused + alert).
 */
export async function expireOpenAttempts(tx: Tx, paymentId: string) {
  const r = await tx.paymentAttempt.updateMany({ where: { paymentId, status: "STARTED" }, data: { status: "EXPIRED" } });
  return r.count;
}
