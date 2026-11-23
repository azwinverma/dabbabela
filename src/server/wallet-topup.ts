import "server-only";
import { Prisma, type Payment, type PaymentMethod, type PaymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, ktmNow } from "@/lib/dates";
import { rs } from "@/lib/money";
import { log } from "@/lib/logger";
import { getSettings, type SiteSettings } from "@/lib/settings";
import { addCredit, walletBalance } from "./ledger";
import { lockUser } from "./capacity";
import { paymentRef } from "./orders";
import { availableMethods } from "./payments/methods";
import { expireOpenAttempts, lockPayment } from "./payments/attempts";

/**
 * Wallet top-up (Phase 2A): customers buy Dabba Bela credit online. Closed-loop store credit — spendable only on
 * Dabba Bela meals, never cash, no interest. Flow:
 *   startTopup → a Payment { purpose: WALLET_TOPUP, no orders } → the normal gateway start/verify code (eSewa / Khalti)
 *   or a bank-transfer proof that finance verifies → markPaymentPaid → creditTopupPayment (exactly one CreditLedger
 *   row, reason TOPUP, paymentId = the payment).
 * Money is credited ONLY after server-side verification (gateway status API / staff bank check), never from the browser.
 */

type Tx = Prisma.TransactionClient;

export class TopupError extends Error {}

export const TOPUP_METHODS = ["ESEWA", "KHALTI", "BANK_TRANSFER"] as const satisfies readonly PaymentMethod[];
export type TopupMethod = (typeof TOPUP_METHODS)[number];
export const isTopupMethod = (m: string): m is TopupMethod => (TOPUP_METHODS as readonly string[]).includes(m);

/** Statuses that count against the daily limit (money received or still on its way). Cancelled / failed don't. */
export const TOPUP_COUNTED: PaymentStatus[] = ["PENDING", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"];
const PAID_LIKE: PaymentStatus[] = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"];

/** More top-ups than this by one customer in one Kathmandu day raises a velocity alert. */
export const TOPUP_VELOCITY_LIMIT = 5;

/** Top-up needs both the top-up flag and the wallet itself (credit you can't spend is no use). */
export const topupEnabled = (s: Pick<SiteSettings, "flags">) => Boolean(s.flags.walletTopup && s.flags.wallet);

/** [00:00, 24:00) of a Kathmandu day as UTC instants. */
export function ktmDayRange(date: string) {
  return { gte: new Date(`${date}T00:00:00+05:45`), lt: new Date(`${addDays(date, 1)}T00:00:00+05:45`) };
}

/** Methods a customer can top up with right now: enabled + configured (same rule as checkout) ∩ eSewa/Khalti/bank. */
export async function topupMethods(settings?: SiteSettings): Promise<TopupMethod[]> {
  const s = settings ?? (await getSettings());
  if (!topupEnabled(s)) return [];
  const all = await availableMethods(s, { hasCompany: false, customerShare: 1 });
  return all.filter(isTopupMethod);
}

export type TopupLimits = {
  enabled: boolean;
  min: number;
  max: number;
  daily: number;
  cap: number;
  balance: number;
  /** Σ PAID + PENDING top-ups created today (Kathmandu). */
  usedToday: number;
  /** Σ top-ups still payable (PENDING, or FAILED with an open gateway session), any day — they'll be credited if paid. */
  pendingToday: number;
  /** Largest amount allowed right now (0 = none). */
  maxNow: number;
};

/**
 * A top-up that may still turn into credit: PENDING, or FAILED with a gateway session still open (a failed status
 * check doesn't stop the customer finishing another session). Counted toward the cap whatever day it was started
 * (M2: a pending top-up from yesterday used to drop out of the cap at midnight). Cancelled top-ups don't count:
 * cancelling expires their sessions and markPaymentPaid refuses to credit a cancelled top-up.
 */
const stillPayable = (userId: string): Prisma.PaymentWhereInput => ({
  userId,
  purpose: "WALLET_TOPUP",
  OR: [{ status: "PENDING" }, { status: "FAILED", attempts: { some: { status: "STARTED" } } }],
});

async function usage(client: Tx | typeof db, userId: string, now = new Date()) {
  const where = { userId, purpose: "WALLET_TOPUP" as const, createdAt: ktmDayRange(ktmNow(now).date) };
  const [used, pending, balance] = await Promise.all([
    client.payment.aggregate({ where: { ...where, OR: [{ status: { in: TOPUP_COUNTED } }, { status: "FAILED", attempts: { some: { status: "STARTED" } } }] }, _sum: { amount: true } }),
    client.payment.aggregate({ where: stillPayable(userId), _sum: { amount: true } }),
    walletBalance(userId, client),
  ]);
  return { usedToday: used._sum.amount ?? 0, pendingToday: pending._sum.amount ?? 0, balance };
}

/**
 * The limits as they apply to this customer now. Daily = Σ PAID + PENDING top-ups created in the Kathmandu day.
 * Cap = balance + today's still-pending top-ups + the new amount must stay ≤ walletBalanceCap (pending ones count,
 * so opening several sessions can't overshoot the cap once they're all paid).
 */
export async function topupLimits(userId: string, settings?: SiteSettings, client: Tx | typeof db = db): Promise<TopupLimits> {
  const s = settings ?? (await getSettings());
  const u = await usage(client, userId);
  const roomDaily = s.walletTopupDaily - u.usedToday;
  const roomCap = s.walletBalanceCap - u.balance - u.pendingToday;
  const maxNow = Math.max(0, Math.min(s.walletTopupMax, roomDaily, roomCap));
  return { enabled: topupEnabled(s), min: s.walletTopupMin, max: s.walletTopupMax, daily: s.walletTopupDaily, cap: s.walletBalanceCap, ...u, maxNow: maxNow >= s.walletTopupMin ? maxNow : 0 };
}

/** Pure limit check (unit-tested): returns a customer-facing reason, or null when the amount is allowed. */
export function topupLimitProblem(amount: number, l: Pick<TopupLimits, "min" | "max" | "daily" | "cap" | "balance" | "usedToday" | "pendingToday">): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return "Enter an amount";
  if (amount < l.min) return `The smallest top-up is ${rs(l.min)}`;
  if (amount > l.max) return `The largest single top-up is ${rs(l.max)}`;
  if (l.usedToday + amount > l.daily) {
    const left = Math.max(0, l.daily - l.usedToday);
    return left >= l.min ? `You can add up to ${rs(left)} more today (daily limit ${rs(l.daily)})` : `You've reached today's top-up limit of ${rs(l.daily)} — try again tomorrow`;
  }
  if (l.balance + l.pendingToday + amount > l.cap) {
    const room = Math.max(0, l.cap - l.balance - l.pendingToday);
    return room >= l.min ? `Your credit can't go above ${rs(l.cap)} — you can add up to ${rs(room)}` : `Your credit is at the ${rs(l.cap)} limit — spend some before adding more`;
  }
  return null;
}

/**
 * Start a top-up: validates the flag, method and limits, then creates the PENDING payment (no orders). The caller
 * then uses the normal payment start (`startPayment`) for eSewa/Khalti or `submitTransferProof` for bank transfer.
 * A retried submit with the same idempotency key returns the same payment — only to its owner.
 */
export async function startTopup(user: { id: string }, input: { amount: number; method: string; idempotencyKey: string }): Promise<{ payment: Payment; replayed: boolean }> {
  const settings = await getSettings();
  if (!topupEnabled(settings)) throw new TopupError("Adding credit isn't available right now");
  const key = String(input.idempotencyKey ?? "").trim();
  if (key.length < 8 || key.length > 80) throw new TopupError("Please reload the page and try again");
  const existing = await db.payment.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (existing.userId !== user.id || existing.purpose !== "WALLET_TOPUP") throw new TopupError("Please reload the page and try again");
    return { payment: existing, replayed: true };
  }
  if (!isTopupMethod(input.method) || !(await topupMethods(settings)).includes(input.method)) throw new TopupError("That payment method isn't available for top-ups");
  const amount = input.amount;
  try {
    const payment = await db.$transaction(async (tx) => {
      // One top-up start per customer at a time, so two tabs can't both squeeze under the daily limit / cap.
      await lockUser(tx, user.id);
      const l = await topupLimits(user.id, settings, tx);
      const problem = topupLimitProblem(amount, l);
      if (problem) throw new TopupError(problem);
      return tx.payment.create({
        data: { reference: paymentRef(), userId: user.id, method: input.method as TopupMethod, purpose: "WALLET_TOPUP", status: "PENDING", amount, idempotencyKey: key, note: "Wallet top-up" },
      });
    });
    log.info("wallet.topup_started", { paymentId: payment.id, method: payment.method, amount });
    return { payment, replayed: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.payment.findUnique({ where: { idempotencyKey: key } });
      if (again && again.userId === user.id && again.purpose === "WALLET_TOPUP") return { payment: again, replayed: true };
      throw new TopupError("Please reload the page and try again");
    }
    throw e;
  }
}

/**
 * Customer withdraws a top-up they haven't paid. Only PENDING/FAILED without an uploaded bank proof. Its gateway
 * sessions are expired, and a cancelled top-up is never credited: if the gateway still confirms money for it later,
 * markPaymentPaid refuses it and raises a GATEWAY_MISMATCH alert so finance refunds it at the gateway (security
 * review M2 — otherwise cancel-and-restart would bypass the daily limit and the balance cap).
 */
export async function cancelTopup(userId: string, paymentId: string) {
  const ok = await db.$transaction(async (tx) => {
    await lockPayment(tx, paymentId);
    const r = await tx.payment.updateMany({ where: { id: paymentId, userId, purpose: "WALLET_TOPUP", status: { in: ["PENDING", "FAILED"] }, proofUrl: null }, data: { status: "CANCELLED", version: { increment: 1 } } });
    if (r.count) await expireOpenAttempts(tx, paymentId);
    return r.count > 0;
  });
  if (!ok) throw new TopupError("This top-up can't be cancelled (already paid, or your transfer proof is being checked)");
}

// ───────────── crediting (called only from markPaymentPaid) ─────────────

/**
 * Credit a verified top-up: exactly one TOPUP ledger row per payment. Runs inside markPaymentPaid's transaction after
 * the guarded status flip, and is itself idempotent (advisory lock on the payment + existence check), so gateway
 * callbacks, retries, the reconcile cron and a staff verification racing each other can never double-credit.
 * Returns the amount credited now (0 when it was already credited).
 */
export async function creditTopupPayment(tx: Tx, p: Pick<Payment, "id" | "userId" | "amount" | "reference">, actorId?: string | null) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`topup:${p.id}`}))`;
  const already = await tx.creditLedger.findFirst({ where: { paymentId: p.id, reason: "TOPUP" }, select: { id: true } });
  if (already) return 0;
  await lockUser(tx, p.userId);
  await addCredit(tx, { userId: p.userId, amount: p.amount, reason: "TOPUP", paymentId: p.id, actorId: actorId ?? null, note: `Top-up ${p.reference}` });
  return p.amount;
}

// ───────────── refunds ─────────────

/**
 * How much of a top-up can still be refunded to its source: the unspent part. = min(this payment's net top-up
 * credit, wallet balance − other refunds already requested on the customer's top-ups). Never lets the wallet go negative.
 */
export async function topupRefundable(paymentId: string, client: Tx | typeof db = db, opts: { excludeRefundId?: string } = {}) {
  const p = await client.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { id: true, userId: true, purpose: true } });
  if (p.purpose !== "WALLET_TOPUP") return null;
  const [net, balance, pending] = await Promise.all([
    client.creditLedger.aggregate({ where: { paymentId, reason: { in: ["TOPUP", "TOPUP_REVERSAL"] } }, _sum: { amount: true } }),
    walletBalance(p.userId, client),
    client.refund.aggregate({ where: { status: { in: ["REQUESTED", "APPROVED"] }, payment: { userId: p.userId, purpose: "WALLET_TOPUP" }, ...(opts.excludeRefundId ? { id: { not: opts.excludeRefundId } } : {}) }, _sum: { amount: true } }),
  ]);
  return Math.max(0, Math.min(net._sum.amount ?? 0, balance - (pending._sum.amount ?? 0)));
}

// ───────────── finance: top-up liability ─────────────

/**
 * Top-up credit customers still hold at `asOf` (a liability — deferred customer credit, not revenue). Per customer:
 * min(net top-ups, wallet balance), floored at 0 — i.e. other credit (refunds, goodwill, skips) is treated as spent
 * first and top-up money last, which keeps the liability (and deferred revenue) on the conservative side. The
 * decrease in this figure not explained by top-ups / reversals is top-up credit spent on orders → sales.
 */
export async function topupLiability(asOf: Date = new Date(), client: Tx | typeof db = db): Promise<number> {
  const rows = await client.$queryRaw<{ v: bigint | null }[]>`
    SELECT SUM(GREATEST(0, LEAST(t.topups, t.bal)))::bigint AS v FROM (
      SELECT "userId", COALESCE(SUM(amount) FILTER (WHERE reason IN ('TOPUP', 'TOPUP_REVERSAL')), 0) AS topups, SUM(amount) AS bal
      FROM "CreditLedger" WHERE "createdAt" < (${asOf} AT TIME ZONE 'UTC') GROUP BY "userId"
    ) t WHERE t.topups > 0`;
  return Number(rows[0]?.v ?? 0);
}

/** Σ top-up ledger movement (TOPUP + TOPUP_REVERSAL) in [from, to). */
export async function topupLedgerNet(from: Date, to: Date, client: Tx | typeof db = db) {
  const r = await client.creditLedger.aggregate({ where: { reason: { in: ["TOPUP", "TOPUP_REVERSAL"] }, createdAt: { gte: from, lt: to } }, _sum: { amount: true } });
  return r._sum.amount ?? 0;
}

/** Top-up credit spent on orders in [from, to) = opening liability + net top-ups − closing liability. */
export async function topupCreditUsed(from: Date, to: Date, client: Tx | typeof db = db) {
  const [open, close, net] = await Promise.all([topupLiability(from, client), topupLiability(to, client), topupLedgerNet(from, to, client)]);
  return { opening: open, closing: close, net, used: open + net - close };
}

export const PAID_TOPUP_STATUSES = PAID_LIKE;

/**
 * Finance reconciliation for top-ups paid in [from, to): money received (Σ payment amounts) vs credit written
 * (Σ TOPUP ledger rows of those payments) — must be equal — plus reversals, and any paid top-up with no credit row.
 */
export async function topupReconciliation(from: Date, to: Date) {
  const where = { purpose: "WALLET_TOPUP" as const, status: { in: PAID_LIKE }, paidAt: { gte: from, lt: to } };
  const [paid, ledger, uncredited] = await Promise.all([
    db.payment.aggregate({ where, _sum: { amount: true, refundedAmount: true }, _count: true }),
    db.$queryRaw<{ reason: string; amount: bigint | null }[]>`
      SELECT l.reason, SUM(l.amount)::bigint AS amount FROM "CreditLedger" l JOIN "Payment" p ON p.id = l."paymentId"
      WHERE l.reason IN ('TOPUP', 'TOPUP_REVERSAL') AND p.purpose = 'WALLET_TOPUP' AND p.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
        AND p."paidAt" >= (${from} AT TIME ZONE 'UTC') AND p."paidAt" < (${to} AT TIME ZONE 'UTC')
      GROUP BY l.reason`,
    db.$queryRaw<{ id: string; reference: string; amount: number }[]>`
      SELECT p.id, p.reference, p.amount FROM "Payment" p
      WHERE p.purpose = 'WALLET_TOPUP' AND p.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
        AND p."paidAt" >= (${from} AT TIME ZONE 'UTC') AND p."paidAt" < (${to} AT TIME ZONE 'UTC')
        AND NOT EXISTS (SELECT 1 FROM "CreditLedger" l WHERE l."paymentId" = p.id AND l.reason = 'TOPUP')
      LIMIT 50`,
  ]);
  const sum = (reason: string) => Number(ledger.find((l) => l.reason === reason)?.amount ?? 0);
  const paidAmount = paid._sum.amount ?? 0;
  const credited = sum("TOPUP");
  return { paidCount: paid._count, paidAmount, credited, reversed: -sum("TOPUP_REVERSAL"), refunded: paid._sum.refundedAmount ?? 0, gap: paidAmount - credited, uncredited };
}
