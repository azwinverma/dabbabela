import "server-only";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate } from "@/lib/dates";
import { duplicatePaymentSuspects, statementDuplicates, unmatchedLines } from "@/server/finance/statements";
import type { Detector, Finding } from "../types";

const DAY = 86_400_000;
const rs = (p: number) => `Rs ${(p / 100).toFixed(2)}`;

/** Suspected double payments in our records (same customer + amount within 10 minutes), last 7 days. */
export const duplicatePayments: Detector = {
  name: "duplicate-payments",
  label: "Suspected duplicate payments",
  mode: "event",
  async run({ now }) {
    const rows = await duplicatePaymentSuspects(new Date(now.getTime() - 7 * DAY), now);
    return rows.map((r) => ({
      type: "DUPLICATE_PAYMENT",
      severity: "CRITICAL",
      entity: "Payment",
      entityId: r.b,
      key: `${r.a}:${r.b}`,
      message: `Possible double payment: ${r.aref} and ${r.bref} (${rs(r.amount)} each, ${r.gap_s}s apart)`,
      href: `/admin/payments/${r.b}`,
      data: { ...r },
    }));
  },
};

/**
 * Reconciliation: payments settled by more than one gateway statement line, statement lines still unmatched
 * after 3 days (per gateway) and daily cash/gateway settlements left open with a variance.
 */
export const reconciliation: Detector = {
  name: "reconciliation",
  label: "Gateway and settlement reconciliation",
  mode: "condition",
  async run({ now, today }) {
    const out: Finding[] = [];
    for (const d of await statementDuplicates())
      out.push({ type: "STATEMENT_DUPLICATE", severity: "CRITICAL", entity: "Payment", entityId: d.payment.id, key: `statement-dup:${d.payment.id}`, message: `${d.payment.reference} was settled ${d.lines} times on gateway statements (${rs(d.settled)} for a ${rs(d.payment.amount)} payment)`, href: `/admin/payments/${d.payment.id}`, data: { lines: d.lines, settled: d.settled } });

    const old = (await unmatchedLines(undefined, 1000)).filter((l) => l.settledAt.getTime() < now.getTime() - 3 * DAY);
    const byProvider = new Map<string, { n: number; amount: number }>();
    for (const l of old) {
      const e = byProvider.get(l.provider) ?? { n: 0, amount: 0 };
      e.n++;
      e.amount += l.amount;
      byProvider.set(l.provider, e);
    }
    for (const [provider, e] of byProvider)
      out.push({ type: "STATEMENT_UNMATCHED", severity: "WARNING", key: `unmatched:${provider}`, message: `${e.n} ${provider} statement line${e.n === 1 ? "" : "s"} (${rs(e.amount)}) unmatched for more than 3 days`, href: "/admin/settlements", data: { provider, lines: e.n, amount: e.amount } });

    const open = await db.dailySettlement.findMany({ where: { closedAt: null, variance: { not: 0 }, date: { lt: dateOnly(addDays(today, -1)) } }, take: 200 });
    for (const s of open)
      out.push({ type: "SETTLEMENT_VARIANCE", severity: Math.abs(s.variance) >= 100_000 ? "CRITICAL" : "WARNING", entity: "DailySettlement", entityId: s.id, kitchenId: s.kitchenId, key: `settlement:${s.id}`, message: `${s.method} settlement for ${isoDate(s.date)} left open with a ${rs(s.variance)} variance`, href: "/admin/settlements", data: { date: isoDate(s.date), method: s.method, variance: s.variance } });
    return out;
  },
};
