import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, ktmNow, monthRange, todayKTM } from "@/lib/dates";
import { COOK_STATUSES, REVENUE_STATUSES } from "./transitions";
import { dayCapacity } from "./capacity";

/**
 * Owner dashboard metrics. Every number is computed live from the database; formulas are listed in
 * KPI_FORMULAS and shown next to each figure. Nothing is estimated or padded — empty data shows 0.
 */

export type Range = { from: string; to: string; kitchenId?: string | null };

export const KPI_FORMULAS: Record<string, string> = {
  gross: "Σ (subtotal + delivery fee) of orders delivered or still going out (status Scheduled → Delivered), by delivery date.",
  discounts: "Σ discount (company discount + coupons) on those orders.",
  refunds: "Σ refunded amount on those orders (wallet credit or processed refunds).",
  net: "Gross − discounts − refunds. Includes VAT when prices are VAT-inclusive.",
  vat: "Σ VAT recorded on those orders (from the active tax rule at order time).",
  collections: "Σ amount of payments marked Paid, by the time they were paid (cash in).",
  unpaid: "Payments still Pending (online not completed, cash not yet collected, bank transfer not verified).",
  meals: "Σ dabba quantity on orders Scheduled → Delivered for that day, against the kitchen's capacity (override or daily default).",
  activePlans: "Meal plans with status Active right now.",
  repeat: "Customers with an order in the range who also ordered on another day before or within the range ÷ customers with an order in the range.",
  churn: "Plans cancelled in the range ÷ plans that were active at the start of the range.",
  expectedCost: "Σ recipe cost snapshot (costTotal) on revenue orders — what the food should have cost.",
  actualCost: "Σ |quantity| × unit cost of stock USAGE + WASTE movements in the range — what the kitchen actually used.",
  margin: "Net sales − expected food cost (contribution before rent, staff and delivery wages).",
  waste: "Σ waste portions ÷ Σ cooked portions on production batches completed in the range.",
  onTime: "Delivered orders whose delivery time (Kathmandu) was at or before the end of their slot ÷ delivered orders with a slot.",
  failed: "Orders that ended the range in Delivery failed.",
  tickets: "Support tickets Open or Pending right now.",
  cac: "Marketing spend entered for the month ÷ customers whose first paid order was in that month.",
};

const revenueWhere = (r: Range): Prisma.OrderWhereInput => ({
  deliveryDate: { gte: dateOnly(r.from), lte: dateOnly(r.to) },
  status: { in: REVENUE_STATUSES },
  ...(r.kitchenId ? { kitchenId: r.kitchenId } : {}),
});

export async function salesSummary(r: Range) {
  const a = await db.order.aggregate({
    where: revenueWhere(r),
    _sum: { subtotal: true, deliveryFee: true, discount: true, tax: true, total: true, refundedAmount: true, costTotal: true, companyShare: true, customerShare: true },
    _count: true,
  });
  const s = a._sum;
  const gross = (s.subtotal ?? 0) + (s.deliveryFee ?? 0);
  const discounts = s.discount ?? 0;
  const refunds = s.refundedAmount ?? 0;
  const net = gross - discounts - refunds;
  const expectedCost = s.costTotal ?? 0;
  return {
    orders: a._count,
    gross,
    discounts,
    refunds,
    net,
    vat: s.tax ?? 0,
    expectedCost,
    margin: net - expectedCost,
    companyShare: s.companyShare ?? 0,
    customerShare: s.customerShare ?? 0,
  };
}

export async function collections(r: Range) {
  const where: Prisma.PaymentWhereInput = { paidAt: { gte: dateOnly(r.from), lt: dateOnly(addDays(r.to, 1)) }, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } };
  const [paid, byMethod, pending, failed] = await Promise.all([
    db.payment.aggregate({ where, _sum: { amount: true }, _count: true }),
    db.payment.groupBy({ by: ["method"], where, _sum: { amount: true }, _count: true }),
    db.payment.aggregate({ where: { status: "PENDING", amount: { gt: 0 } }, _sum: { amount: true }, _count: true }),
    db.payment.count({ where: { status: "FAILED", updatedAt: { gte: dateOnly(r.from) } } }),
  ]);
  return {
    collected: paid._sum.amount ?? 0,
    paymentsCount: paid._count,
    byMethod: byMethod.map((m) => ({ method: m.method, amount: m._sum.amount ?? 0, count: m._count })),
    pendingAmount: pending._sum.amount ?? 0,
    pendingCount: pending._count,
    failedCount: failed,
  };
}

export async function mealsDue(date: string, kitchenId?: string | null) {
  const kitchens = await db.kitchen.findMany({ where: { isActive: true, ...(kitchenId ? { id: kitchenId } : {}) }, select: { id: true } });
  let capacity = 0;
  for (const k of kitchens) capacity += await dayCapacity(k.id, date);
  const a = await db.orderItem.aggregate({
    _sum: { quantity: true },
    where: { order: { deliveryDate: dateOnly(date), status: { in: COOK_STATUSES }, ...(kitchenId ? { kitchenId } : {}) } },
  });
  return { date, meals: a._sum.quantity ?? 0, capacity };
}

export async function customerMetrics(r: Range) {
  const inRange = await db.order.groupBy({ by: ["userId"], where: revenueWhere(r), _count: { _all: true } });
  const ids = inRange.map((x) => x.userId);
  let repeat = 0;
  if (ids.length) {
    const days = await db.$queryRaw<{ userId: string; d: bigint }[]>`
      SELECT "userId", COUNT(DISTINCT "deliveryDate") AS d FROM "Order"
      WHERE "userId" = ANY(${ids}) AND "deliveryDate" <= ${dateOnly(r.to)}
        AND status::text = ANY(${REVENUE_STATUSES as string[]})
      GROUP BY "userId"`;
    repeat = days.filter((x) => Number(x.d) >= 2).length;
  }
  const start = dateOnly(r.from);
  const [activeAtStart, cancelled, activeNow] = await Promise.all([
    db.subscription.count({
      where: { createdAt: { lt: start }, endDate: { gte: start }, OR: [{ status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] } }, { status: "CANCELLED", updatedAt: { gte: start } }] },
    }),
    db.subscription.count({ where: { status: "CANCELLED", updatedAt: { gte: start, lt: dateOnly(addDays(r.to, 1)) } } }),
    db.subscription.count({ where: { status: "ACTIVE" } }),
  ]);
  return {
    customers: ids.length,
    repeatCustomers: repeat,
    repeatRate: ids.length ? repeat / ids.length : null,
    churn: activeAtStart ? cancelled / activeAtStart : null,
    plansCancelled: cancelled,
    plansActiveAtStart: activeAtStart,
    activePlans: activeNow,
  };
}

export async function actualFoodCost(r: Range) {
  const rows = await db.stockMovement.findMany({
    where: { type: { in: ["USAGE", "WASTE"] }, createdAt: { gte: dateOnly(r.from), lt: dateOnly(addDays(r.to, 1)) }, ...(r.kitchenId ? { kitchenId: r.kitchenId } : {}) },
    include: { ingredient: { select: { costPerUnit: true } } },
  });
  let usage = 0,
    waste = 0;
  for (const m of rows) {
    const v = Math.round(Math.abs(m.quantity) * (m.unitCost ?? m.ingredient.costPerUnit));
    if (m.type === "USAGE") usage += v;
    else waste += v;
  }
  return { movements: rows.length, usage, waste, total: usage + waste };
}

export async function wasteRate(r: Range) {
  const a = await db.productionBatch.aggregate({
    where: { status: "DONE", date: { gte: dateOnly(r.from), lte: dateOnly(r.to) }, ...(r.kitchenId ? { kitchenId: r.kitchenId } : {}) },
    _sum: { actualPortions: true, wastePortions: true },
    _count: true,
  });
  const cooked = a._sum.actualPortions ?? 0;
  return { batches: a._count, cooked, waste: a._sum.wastePortions ?? 0, rate: cooked ? (a._sum.wastePortions ?? 0) / cooked : null };
}

export async function deliveryMetrics(r: Range) {
  const delivered = await db.order.findMany({
    where: { status: "DELIVERED", deliveryDate: { gte: dateOnly(r.from), lte: dateOnly(r.to) }, deliveredAt: { not: null }, slotId: { not: null }, ...(r.kitchenId ? { kitchenId: r.kitchenId } : {}) },
    select: { deliveryDate: true, deliveredAt: true, slot: { select: { endTime: true } } },
  });
  let onTime = 0;
  for (const o of delivered) {
    const at = ktmNow(o.deliveredAt!);
    const day = isoDate(o.deliveryDate);
    if (at.date < day || (at.date === day && at.time <= (o.slot?.endTime ?? "23:59"))) onTime++;
  }
  const failed = await db.order.count({ where: { status: "FAILED_DELIVERY", deliveryDate: { gte: dateOnly(r.from), lte: dateOnly(r.to) }, ...(r.kitchenId ? { kitchenId: r.kitchenId } : {}) } });
  return { withSlot: delivered.length, onTime, onTimeRate: delivered.length ? onTime / delivered.length : null, failed };
}

export async function popularBoxes(r: Range, take = 8) {
  const rows = await db.orderItem.groupBy({ by: ["name"], where: { order: revenueWhere(r) }, _sum: { quantity: true, lineTotal: true }, orderBy: { _sum: { quantity: "desc" } }, take });
  return rows.map((x) => ({ name: x.name, qty: x._sum.quantity ?? 0, revenue: x._sum.lineTotal ?? 0 }));
}

/** Dish-level portions from immutable order snapshots (covers set dabbas and Build-a-Dabba). */
export async function popularDishes(r: Range, take = 10) {
  const rows = await db.$queryRaw<{ name: string; n: bigint }[]>`
    SELECT c->>'name' AS name, SUM((c->>'qty')::int * oi.quantity) AS n
    FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
    CROSS JOIN LATERAL jsonb_array_elements(oi.components) c
    WHERE o."deliveryDate" BETWEEN ${dateOnly(r.from)} AND ${dateOnly(r.to)}
      AND o.status::text = ANY(${REVENUE_STATUSES as string[]})
      ${r.kitchenId ? Prisma.sql`AND o."kitchenId" = ${r.kitchenId}` : Prisma.empty}
    GROUP BY 1 ORDER BY 2 DESC LIMIT ${take}`;
  return rows.map((x) => ({ name: x.name, portions: Number(x.n) }));
}

export async function dailySeries(r: Range) {
  const rows = await db.order.groupBy({ by: ["deliveryDate"], where: revenueWhere(r), _sum: { total: true }, _count: true });
  const map = new Map(rows.map((x) => [isoDate(x.deliveryDate), { total: x._sum.total ?? 0, orders: x._count }]));
  const out: { date: string; total: number; orders: number }[] = [];
  for (let d = r.from; d <= r.to && out.length < 120; d = addDays(d, 1)) out.push({ date: d, ...(map.get(d) ?? { total: 0, orders: 0 }) });
  return out;
}

export async function lowStock(kitchenId?: string | null) {
  const [ings, sums] = await Promise.all([
    db.ingredient.findMany({ where: { isActive: true, safetyStock: { gt: 0 } }, select: { id: true, name: true, unit: true, safetyStock: true } }),
    db.stockMovement.groupBy({ by: ["ingredientId"], where: kitchenId ? { kitchenId } : {}, _sum: { quantity: true } }),
  ]);
  const onHand = new Map(sums.map((s) => [s.ingredientId, s._sum.quantity ?? 0]));
  // Only flag items that have ever been stocked — a brand-new kitchen with no receipts isn't "low", it's unset.
  return ings.filter((i) => onHand.has(i.id) && (onHand.get(i.id) ?? 0) < i.safetyStock).map((i) => ({ ...i, onHand: onHand.get(i.id) ?? 0 }));
}

export async function alerts() {
  const dayAgo = new Date(Date.now() - 86400000);
  const [failedJobs, failedMessages, stuckPending, transfers, low, openTickets] = await Promise.all([
    db.jobRun.count({ where: { status: "FAILED", startedAt: { gte: dayAgo } } }),
    db.outboundMessage.count({ where: { status: "FAILED" } }),
    db.order.count({ where: { status: "PENDING_PAYMENT", createdAt: { lt: new Date(Date.now() - 2 * 3600_000) } } }),
    db.payment.count({ where: { method: "BANK_TRANSFER", status: "PENDING", proofUrl: { not: null } } }),
    lowStock(),
    db.supportTicket.count({ where: { status: { in: ["OPEN", "PENDING"] } } }),
  ]);
  return { failedJobs, failedMessages, stuckPending, transfers, lowStock: low.length, openTickets };
}

export const SPEND_KEY = "marketing.spend";

export async function marketingSpend(): Promise<Record<string, number>> {
  const row = await db.setting.findUnique({ where: { key: SPEND_KEY } });
  return (row?.value as Record<string, number> | undefined) ?? {};
}

export async function cac(ym: string) {
  const { start, end } = monthRange(ym);
  const spend = (await marketingSpend())[ym] ?? null;
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM (
      SELECT "userId", MIN("deliveryDate") AS first FROM "Order"
      WHERE status::text = ANY(${REVENUE_STATUSES as string[]})
      GROUP BY "userId"
    ) f WHERE f.first BETWEEN ${dateOnly(start)} AND ${dateOnly(end)}`;
  const newCustomers = Number(rows[0]?.n ?? 0);
  return { ym, spend, newCustomers, cac: spend != null && newCustomers ? Math.round(spend / newCustomers) : null };
}

/** Retention by first-order month: share of the cohort ordering again in each following month. */
export async function cohorts(months = 6) {
  const startYm = monthRange(addDays(todayKTM(), -months * 31).slice(0, 7)).start;
  const rows = await db.$queryRaw<{ cohort: string; m: string; n: bigint }[]>`
    WITH firsts AS (
      SELECT "userId", to_char(MIN("deliveryDate"), 'YYYY-MM') AS cohort FROM "Order"
      WHERE status::text = ANY(${REVENUE_STATUSES as string[]}) GROUP BY "userId"
    ), act AS (
      SELECT DISTINCT "userId", to_char("deliveryDate", 'YYYY-MM') AS m FROM "Order"
      WHERE status::text = ANY(${REVENUE_STATUSES as string[]})
    )
    SELECT f.cohort, a.m, COUNT(DISTINCT a."userId") AS n
    FROM firsts f JOIN act a ON a."userId" = f."userId"
    WHERE f.cohort >= ${startYm.slice(0, 7)}
    GROUP BY 1, 2 ORDER BY 1, 2`;
  const byCohort = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byCohort.has(r.cohort)) byCohort.set(r.cohort, new Map());
    byCohort.get(r.cohort)!.set(r.m, Number(r.n));
  }
  const monthsAfter = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5)) - Number(a.slice(5));
  return [...byCohort.entries()].map(([cohort, m]) => {
    const size = m.get(cohort) ?? 0;
    const cells: (number | null)[] = [];
    for (let i = 0; i < months; i++) cells.push(null);
    for (const [month, n] of m) {
      const i = monthsAfter(cohort, month);
      if (i >= 0 && i < months) cells[i] = size ? n / size : null;
    }
    return { cohort, size, cells };
  });
}

// ───────────── CSV ─────────────

export function csv(rows: (string | number | boolean | null | undefined | Date)[][]) {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

/** Paisa → "1250.00" for spreadsheets. */
export const money = (p: number | null | undefined) => ((p ?? 0) / 100).toFixed(2);
