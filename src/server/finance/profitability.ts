import "server-only";
import { db } from "@/lib/db";
import { monthRange } from "@/lib/dates";
import { profitability } from "@/server/analytics/revenue";
import type { AnalyticsFilters } from "@/server/analytics/filters";
import { assertCan, day, type Actor } from "./common";
import { periodStatuses } from "./settlement";

/**
 * P&L for /admin/profitability (WP-09). Built on `analytics/revenue.ts profitability()` — the same Estimated /
 * Recorded split — plus totals per column, per-month coverage and the accounting-period state.
 *
 * Honest labelling: the bottom line is called "Net profit" only when every month in the range is closed;
 * otherwise it's an "Operating estimate". A cost line with no data is null ("No data recorded"), never zero.
 */

export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = monthRange(m).next.slice(0, 7)) out.push(m);
  return out;
}

export async function profitAndLoss(actor: Actor, f: AnalyticsFilters) {
  assertCan(actor, "analytics.view");
  const p = await profitability(f);
  const months = monthsBetween(f.from, f.to);
  const kitchen = f.kitchenIds ? { kitchenId: { in: f.kitchenIds } } : {};
  const [statuses, coverage] = await Promise.all([
    periodStatuses(months),
    Promise.all(
      months.map(async (m) => {
        const { start, end } = monthRange(m);
        const range = { gte: day(start), lte: day(end) };
        const stamp = { gte: new Date(`${start}T00:00:00+05:45`), lt: new Date(`${monthRange(m).next}T00:00:00+05:45`) };
        const [expenses, drafts, settlements, openSettlements, statementLines] = await Promise.all([
          db.expense.count({ where: { date: range, status: { in: ["APPROVED", "PAID"] }, ...kitchen } }),
          db.expense.count({ where: { date: range, status: "DRAFT", ...kitchen } }),
          db.dailySettlement.count({ where: { date: range } }),
          db.dailySettlement.count({ where: { date: range, closedAt: null } }),
          db.gatewayStatementLine.count({ where: { settledAt: stamp } }),
        ]);
        return { month: m, expenses, drafts, settlements, openSettlements, statementLines };
      }),
    ),
  ]);
  const sum = (vals: (number | null)[]) => (vals.some((v) => v != null) ? vals.reduce<number>((a, v) => a + (v ?? 0), 0) : null);
  const estimatedCosts = sum(p.lines.map((l) => l.estimated));
  const recordedCosts = sum(p.lines.map((l) => l.actual));
  const final = statuses.every((s) => s.closedAt);
  return {
    ...p,
    estimatedCosts,
    recordedCosts,
    /** Revenue − estimated lines (lines with no estimate count as nothing). */
    estimatedProfit: p.revenue - (estimatedCosts ?? 0),
    /** Revenue − recorded lines only. */
    recordedProfit: p.revenue - (recordedCosts ?? 0),
    bottomLine: { label: final ? "Net profit (closed periods)" : "Operating estimate", value: p.operating, final },
    periods: statuses.map((s, i) => ({ ...s, ...coverage[i] })),
  };
}
