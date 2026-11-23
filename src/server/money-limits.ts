import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { getSettings, type SiteSettings } from "@/lib/settings";

/**
 * Maker-checker limits for money one staff member moves ALONE (security review H3/H4). An action needs a second
 * person (an ApprovalRequest, src/server/approvals.ts) when it would reach:
 *   - `approvalThreshold` on its own (the original per-action rule), or
 *   - `approvalThreshold` together with the refunds already on the same payment (requested + approved + processed —
 *     no splitting one refund into many small ones), or
 *   - `staffDailyMoneyLimit` together with what this person moved in the last 24 h: refunds they requested (not
 *     rejected) + positive manual wallet credits (ADJUSTMENT without a payment / GOODWILL) they made, which includes
 *     credit-creating order adjustments. Credits executed from an approved request don't count (two people).
 * Direct paths re-check under a per-actor advisory lock inside their transaction (`assertWithinStaffLimits`), so two
 * parallel requests can't both squeeze under a limit.
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

/** Thrown by a direct money path when the action needs a second person; callers turn it into an approval request. */
export class NeedsApprovalError extends Error {}

const DAY_MS = 24 * 3600_000;
/** Ledger-note suffix of credits written by an approved maker-checker request (approvals.ts). */
export const APPROVED_SUFFIX = "(approved)";

/** Money this staff member moved on their own in the last 24 h (paisa). */
export async function staffMoneyUsed24h(actorId: string, client: Client = db, now = new Date()) {
  const since = new Date(now.getTime() - DAY_MS);
  const [refunds, credits] = await Promise.all([
    client.refund.aggregate({ where: { requestedById: actorId, createdAt: { gte: since }, status: { not: "REJECTED" } }, _sum: { amount: true } }),
    client.creditLedger.aggregate({
      where: {
        actorId,
        createdAt: { gte: since },
        amount: { gt: 0 },
        // Executions of approved requests (ledger note ends "(approved)") had a second person — not "alone".
        AND: [{ OR: [{ reason: "GOODWILL" }, { reason: "ADJUSTMENT", paymentId: null }] }, { OR: [{ note: null }, { NOT: { note: { endsWith: APPROVED_SUFFIX } } }] }],
      },
      _sum: { amount: true },
    }),
  ]);
  return (refunds._sum.amount ?? 0) + (credits._sum.amount ?? 0);
}

/** Σ refunds on a payment that are requested, approved or processed. */
export async function paymentRefundTotal(paymentId: string, client: Client = db) {
  const r = await client.refund.aggregate({ where: { paymentId, status: { in: ["REQUESTED", "APPROVED", "PROCESSED"] } }, _sum: { amount: true } });
  return r._sum.amount ?? 0;
}

export type MoneyAction = { actorId: string; amount: number; paymentId?: string | null };

/** Why this action needs a second person, or null when one person may do it. `amount` is the absolute amount. */
export async function approvalReason(a: MoneyAction, client: Client = db, settings?: SiteSettings): Promise<string | null> {
  const s = settings ?? (await getSettings());
  const amount = Math.abs(a.amount);
  const t = s.approvalThreshold;
  if (t > 0 && amount >= t) return `${rs(amount)} is at or above the ${rs(t)} approval threshold`;
  if (t > 0 && a.paymentId) {
    const before = await paymentRefundTotal(a.paymentId, client);
    if (before > 0 && before + amount >= t) return `refunds on this payment would reach ${rs(before + amount)} (approval from ${rs(t)})`;
  }
  const daily = s.staffDailyMoneyLimit;
  if (daily > 0) {
    const used = await staffMoneyUsed24h(a.actorId, client);
    if (used + amount >= daily) return `you'd reach ${rs(used + amount)} of refunds and credits in 24 h (limit ${rs(daily)} per person)`;
  }
  return null;
}

/** Per-actor lock: serialise one person's direct money actions so the limit check and the write are atomic. */
export async function lockStaffMoney(tx: Tx, actorId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`staff-money:${actorId}`}))`;
}

/** Inside the direct path's transaction: lock, re-check, and refuse with NeedsApprovalError when over a limit. */
export async function assertWithinStaffLimits(tx: Tx, a: MoneyAction) {
  await lockStaffMoney(tx, a.actorId);
  const why = await approvalReason(a, tx);
  if (why) throw new NeedsApprovalError(`This needs a second person: ${why}`);
}

/**
 * Who may receive a manual wallet credit/debit from this staff member: a real (not deleted) CUSTOMER account — never
 * a staff account — and, for a kitchen-scoped staff member, only a customer with an order in one of their kitchens.
 */
export async function assertCreditTarget(actor: { kitchenIds?: string[] | null }, userId: string, client: Client = db) {
  const u = await client.user.findUnique({ where: { id: userId }, select: { role: true, deletedAt: true } });
  if (!u || u.role !== "CUSTOMER") throw new Error("Customer not found — wallet credit can only go to customer accounts");
  if (u.deletedAt) throw new Error("This customer's personal data was deleted");
  if (actor.kitchenIds) {
    const n = await client.order.count({ where: { userId, kitchenId: { in: actor.kitchenIds } } });
    if (!n) throw new Error("This customer has no orders in your kitchens");
  }
}
