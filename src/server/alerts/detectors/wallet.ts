import "server-only";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { ktmDayRange, TOPUP_VELOCITY_LIMIT } from "@/server/wallet-topup";
import type { Detector, Finding } from "../types";

const MIN = 60_000;
const DAY = 86_400_000;
const rs = (p: number) => `Rs ${(p / 100).toFixed(2)}`;

/**
 * Wallet top-up states (Phase 2A):
 * - TOPUP_STUCK: a top-up the customer started paying (gateway session or bank proof) that is still pending —
 *   gateway > 60 min (the reconciler couldn't confirm it), bank proof waiting > 24 h for finance.
 * - TOPUP_UNCREDITED: a paid top-up without its TOPUP ledger row (should be impossible — credit is written in the
 *   same transaction as the PAID flip; this is the reconciliation tripwire).
 * - WALLET_OVER_CAP: a customer who has topped up holds more credit than the balance cap (refund credit can push a
 *   balance over it; worth a look, nothing is blocked).
 */
export const walletTopups: Detector = {
  name: "wallet-topups",
  label: "Wallet top-ups",
  mode: "condition",
  async run({ now }) {
    const out: Finding[] = [];
    const week = new Date(now.getTime() - 7 * DAY);
    const stuck = await db.payment.findMany({
      where: {
        purpose: "WALLET_TOPUP",
        status: "PENDING",
        createdAt: { gte: week },
        OR: [
          { method: { in: ["ESEWA", "KHALTI"] }, attempts: { some: { createdAt: { lt: new Date(now.getTime() - 60 * MIN) } } } },
          { method: "BANK_TRANSFER", proofUrl: { not: null }, updatedAt: { lt: new Date(now.getTime() - DAY) } },
        ],
      },
      select: { id: true, reference: true, method: true, amount: true, createdAt: true, user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const p of stuck)
      out.push({
        type: "TOPUP_STUCK",
        severity: "WARNING",
        entity: "Payment",
        entityId: p.id,
        key: `stuck:${p.id}`,
        message: `Wallet top-up ${p.reference} (${rs(p.amount)}, ${p.user.name}) is still pending — ${p.method === "BANK_TRANSFER" ? "bank proof waiting for verification over a day" : `${p.method} hasn't confirmed it; check the merchant portal`}`,
        href: `/admin/payments/${p.id}`,
        data: { method: p.method, amount: p.amount },
      });

    const uncredited = await db.$queryRaw<{ id: string; reference: string; amount: number }[]>`
      SELECT p.id, p.reference, p.amount FROM "Payment" p
      WHERE p.purpose = 'WALLET_TOPUP' AND p.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
        AND NOT EXISTS (SELECT 1 FROM "CreditLedger" l WHERE l."paymentId" = p.id AND l.reason = 'TOPUP')
      LIMIT 50`;
    for (const p of uncredited)
      out.push({ type: "TOPUP_UNCREDITED", severity: "CRITICAL", entity: "Payment", entityId: p.id, key: `uncredited:${p.id}`, message: `Wallet top-up ${p.reference} (${rs(p.amount)}) is paid but no credit was written to the wallet`, href: `/admin/payments/${p.id}`, data: { amount: p.amount } });

    const cap = (await getSettings()).walletBalanceCap;
    const over = await db.$queryRaw<{ userId: string; name: string; balance: bigint }[]>`
      SELECT l."userId", u.name, SUM(l.amount)::bigint AS balance FROM "CreditLedger" l JOIN "User" u ON u.id = l."userId"
      WHERE l."userId" IN (SELECT DISTINCT "userId" FROM "CreditLedger" WHERE reason = 'TOPUP')
      GROUP BY l."userId", u.name HAVING SUM(l.amount) > ${cap}
      ORDER BY balance DESC LIMIT 50`;
    for (const u of over)
      out.push({ type: "WALLET_OVER_CAP", severity: "WARNING", entity: "User", entityId: u.userId, key: `cap:${u.userId}`, message: `${u.name} holds ${rs(Number(u.balance))} of credit — above the ${rs(cap)} wallet cap`, href: `/admin/customers/${u.userId}`, data: { balance: Number(u.balance), cap } });
    return out;
  },
};

/** More than TOPUP_VELOCITY_LIMIT top-ups started by one customer in one Kathmandu day (today and yesterday). */
export const walletTopupVelocity: Detector = {
  name: "wallet-topup-velocity",
  label: "Unusual wallet top-up activity",
  mode: "event",
  async run({ today }) {
    const out: Finding[] = [];
    for (const date of [addDays(today, -1), today]) {
      const rows = await db.payment.groupBy({ by: ["userId"], where: { purpose: "WALLET_TOPUP", createdAt: ktmDayRange(date) }, _count: { _all: true }, _sum: { amount: true }, having: { userId: { _count: { gt: TOPUP_VELOCITY_LIMIT } } } });
      if (!rows.length) continue;
      const names = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      for (const r of rows)
        out.push({
          type: "TOPUP_VELOCITY",
          severity: "WARNING",
          entity: "User",
          entityId: r.userId,
          key: `${r.userId}:${date}`,
          message: `${names.get(r.userId) ?? "A customer"} started ${r._count._all} wallet top-ups on ${date} (${rs(r._sum.amount ?? 0)}) — more than ${TOPUP_VELOCITY_LIMIT} a day`,
          href: `/admin/payments?purpose=WALLET_TOPUP&q=${encodeURIComponent(names.get(r.userId) ?? "")}`,
          data: { date, count: r._count._all, amount: r._sum.amount ?? 0 },
        });
    }
    return out;
  },
};
