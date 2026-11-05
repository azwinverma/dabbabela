import "server-only";
import type { DietPreference, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { dayRange, isFiltered, orderDims, orderDimsSql, stampRange, type AnalyticsFilters } from "./filters";
import { RECOGNISED_STATUSES } from "./metrics";
import { recognisedWhere } from "./revenue";

/**
 * Customer statistics, all on the DELIVERED basis (definitions in metrics.ts). Only data the customer gave us
 * (orders, the diet preference they set, ratings they chose to leave, tickets they opened) is used.
 */

const REC = RECOGNISED_STATUSES as string[];

export async function customerStats(f: AnalyticsFilters) {
  const day = dayRange(f.from, f.to);
  const dims = orderDimsSql(f, "o");
  const rows = await db.$queryRaw<{ active: bigint; orders: bigint; returning: bigint; fresh: bigint }[]>`
    WITH inr AS (
      SELECT o."userId", COUNT(*) AS n FROM "Order" o
      WHERE o.status::text = ANY(${REC}) AND o."deliveryDate" BETWEEN ${day.gte} AND ${day.lte} ${dims}
      GROUP BY 1
    ), firsts AS (
      SELECT o."userId", MIN(o."deliveryDate") AS first FROM "Order" o
      WHERE o.status::text = ANY(${REC}) AND o."userId" IN (SELECT "userId" FROM inr) ${dims}
      GROUP BY 1
    )
    SELECT (SELECT COUNT(*) FROM inr) AS active,
           (SELECT COALESCE(SUM(n), 0) FROM inr) AS orders,
           (SELECT COUNT(*) FROM firsts WHERE first < ${day.gte}) AS returning,
           (SELECT COUNT(*) FROM firsts WHERE first >= ${day.gte}) AS fresh`;
  const r = rows[0];
  const active = Number(r?.active ?? 0);
  const orders = Number(r?.orders ?? 0);
  return { active, newCustomers: Number(r?.fresh ?? 0), returning: Number(r?.returning ?? 0), deliveredOrders: orders, frequency: active ? orders / active : null };
}

/** Historical LTV: Σ recognised revenue per customer, all time up to the range end, averaged over customers with a delivered order. */
export async function ltv(f: AnalyticsFilters) {
  const end = dayRange(f.from, f.to).lte;
  const rows = await db.$queryRaw<{ customers: bigint; total: bigint | null }[]>`
    SELECT COUNT(*) AS customers, SUM(v) AS total FROM (
      SELECT o."userId", SUM(o.total - o.tax - o."refundedAmount") AS v FROM "Order" o
      WHERE o.status::text = ANY(${REC}) AND o."deliveryDate" <= ${end} ${orderDimsSql(f, "o")}
      GROUP BY 1
    ) t`;
  const customers = Number(rows[0]?.customers ?? 0);
  const total = Number(rows[0]?.total ?? 0);
  return { customers, total, average: customers ? Math.round(total / customers) : null };
}

export async function topCustomers(f: AnalyticsFilters, take = 10) {
  const rows = await db.order.groupBy({ by: ["userId"], where: recognisedWhere(f), _sum: { total: true, tax: true, refundedAmount: true }, _count: { _all: true } });
  const ranked = rows
    .map((r) => ({ userId: r.userId, value: (r._sum.total ?? 0) - (r._sum.tax ?? 0) - (r._sum.refundedAmount ?? 0), orders: r._count._all }))
    .sort((a, b) => b.value - a.value || a.userId.localeCompare(b.userId))
    .slice(0, take);
  const users = await db.user.findMany({ where: { id: { in: ranked.map((r) => r.userId) } }, select: { id: true, name: true, email: true, deletedAt: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return ranked.map((r) => {
    const u = byId.get(r.userId);
    return { ...r, name: u?.deletedAt ? "Deleted customer" : (u?.name ?? "—"), email: u?.deletedAt ? null : (u?.email ?? null) };
  });
}

/** Diet preference the customer set on their profile, among active customers in the range. */
export async function dietMix(f: AnalyticsFilters) {
  const active = await db.order.groupBy({ by: ["userId"], where: recognisedWhere(f) });
  if (!active.length) return [];
  const rows = await db.user.groupBy({ by: ["diet"], where: { id: { in: active.map((a) => a.userId) } }, _count: { _all: true } });
  return rows.map((r) => ({ diet: r.diet as DietPreference, count: r._count._all })).sort((a, b) => b.count - a.count);
}

export async function ratings(f: AnalyticsFilters) {
  const a = await db.feedback.aggregate({ where: { order: recognisedWhere(f) }, _avg: { rating: true }, _count: true });
  return { average: a._avg.rating ?? null, count: a._count };
}

export const complaintsWhere = (f: AnalyticsFilters): Prisma.SupportTicketWhereInput => ({
  createdAt: stampRange(f.from, f.to),
  ...(isFiltered(f) ? { order: orderDims(f) } : {}),
});

/** Tickets opened in the range by category, plus a weekly trend (weeks start Sunday). */
export async function complaints(f: AnalyticsFilters) {
  const where = complaintsWhere(f);
  const [byCat, rows] = await Promise.all([
    db.supportTicket.groupBy({ by: ["category"], where, _count: { _all: true } }),
    db.supportTicket.findMany({ where, select: { createdAt: true } }),
  ]);
  const weeks = new Map<string, number>();
  for (const t of rows) {
    const d = new Date(t.createdAt.getTime() + 345 * 60_000).toISOString().slice(0, 10);
    const wk = addDays(d, -new Date(`${d}T00:00:00Z`).getUTCDay());
    weeks.set(wk, (weeks.get(wk) ?? 0) + 1);
  }
  return {
    total: rows.length,
    byCategory: byCat.map((c) => ({ category: c.category, count: c._count._all })).sort((a, b) => b.count - a.count),
    weekly: [...weeks.entries()].sort().map(([week, count]) => ({ week, count })),
  };
}
