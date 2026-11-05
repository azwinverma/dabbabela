import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, daysBetween, todayKTM } from "@/lib/dates";
import { METHOD_LABEL } from "@/lib/labels";
import {
  NONE,
  dayRange,
  isFiltered,
  orderDimsSql,
  orderWhere,
  paymentDims,
  stampRange,
  subscriptionDims,
  type AnalyticsFilters,
} from "./filters";
import { CASH_PAYMENT_STATUSES, DEFERRED_PAYMENT, DEFERRED_STATUSES, NON_CASH_METHODS, NON_CASH_REFUNDS, NOT_BOOKED, RECOGNISED_STATUSES, UPCOMING_STATUSES } from "./metrics";

/** Revenue bases (definitions in metrics.ts). All values are integer paisa. */

const n = (v: number | null | undefined) => v ?? 0;

// ───────────── basis where-clauses (shared with drill-down lists) ─────────────

export const bookingsOrderWhere = (f: AnalyticsFilters) => orderWhere(f, { subscriptionId: null, createdAt: stampRange(f.from, f.to), status: { notIn: NOT_BOOKED } });
export const bookingsPlanWhere = (f: AnalyticsFilters): Prisma.SubscriptionWhereInput => ({ ...subscriptionDims(f), createdAt: stampRange(f.from, f.to), status: { not: "PENDING_PAYMENT" } });
export const recognisedWhere = (f: AnalyticsFilters) => orderWhere(f, { status: { in: RECOGNISED_STATUSES }, deliveryDate: dayRange(f.from, f.to) });
export const upcomingWhere = (f: AnalyticsFilters) => orderWhere(f, { status: { in: UPCOMING_STATUSES }, deliveryDate: dayRange(f.from, f.to) });
export const cancelledWhere = (f: AnalyticsFilters) => orderWhere(f, { status: "CANCELLED", deliveryDate: dayRange(f.from, f.to) });
export const deferredWhere = (f: AnalyticsFilters) => orderWhere(f, { status: { in: DEFERRED_STATUSES }, paymentStatus: { in: DEFERRED_PAYMENT } });
export const cashWhere = (f: AnalyticsFilters, opts: { includeNonCash?: boolean } = {}): Prisma.PaymentWhereInput => ({
  AND: [{ paidAt: stampRange(f.from, f.to), status: { in: CASH_PAYMENT_STATUSES } }, opts.includeNonCash ? {} : { method: { notIn: NON_CASH_METHODS } }, paymentDims(f)],
});
export const refundsWhere = (f: AnalyticsFilters): Prisma.RefundWhereInput => ({
  status: "PROCESSED",
  processedAt: stampRange(f.from, f.to),
  method: { notIn: NON_CASH_REFUNDS },
  payment: paymentDims({ ...f, method: undefined }),
});
export const pendingPaymentsWhere = (f: AnalyticsFilters): Prisma.PaymentWhereInput => ({ AND: [{ status: "PENDING", amount: { gt: 0 } }, paymentDims(f)] });

/** Σ(total − tax − refunded) over a where. */
async function netOf(where: Prisma.OrderWhereInput) {
  const a = await db.order.aggregate({ where, _sum: { total: true, tax: true, refundedAmount: true }, _count: true });
  return { value: n(a._sum.total) - n(a._sum.tax) - n(a._sum.refundedAmount), vat: n(a._sum.tax), refunded: n(a._sum.refundedAmount), gross: n(a._sum.total), count: a._count };
}

export async function bookings(f: AnalyticsFilters) {
  const [single, plans] = await Promise.all([
    db.order.aggregate({ where: bookingsOrderWhere(f), _sum: { total: true }, _count: true }),
    db.subscription.aggregate({ where: bookingsPlanWhere(f), _sum: { total: true }, _count: true }),
  ]);
  const s = n(single._sum.total);
  const p = n(plans._sum.total);
  return { total: s + p, single: s, singleCount: single._count, plans: p, planCount: plans._count };
}

export async function cash(f: AnalyticsFilters) {
  const [inn, wallet, out] = await Promise.all([
    db.payment.aggregate({ where: cashWhere(f), _sum: { amount: true }, _count: true }),
    db.payment.aggregate({ where: { AND: [cashWhere(f, { includeNonCash: true }), { method: "WALLET" }] }, _sum: { amount: true }, _count: true }),
    f.method ? null : db.refund.aggregate({ where: refundsWhere(f), _sum: { amount: true }, _count: true }),
  ]);
  const collected = n(inn._sum.amount);
  const refunds = n(out?._sum.amount);
  return { collected, payments: inn._count, refunds, refundCount: out?._count ?? 0, net: collected - refunds, walletSpend: n(wallet._sum.amount), walletCount: wallet._count };
}

export async function recognised(f: AnalyticsFilters) {
  const r = await netOf(recognisedWhere(f));
  return { ...r, aov: r.count ? Math.round(r.value / r.count) : null };
}

export const upcoming = (f: AnalyticsFilters) => netOf(upcomingWhere(f));

export async function cancelled(f: AnalyticsFilters) {
  const a = await db.order.aggregate({ where: cancelledWhere(f), _sum: { total: true }, _count: true });
  return { value: n(a._sum.total), count: a._count };
}

/** Deferred revenue snapshot (now). Wallet balance is customer-level: only shown when nothing but the date is filtered. */
export async function deferred(f: AnalyticsFilters) {
  const base = deferredWhere(f);
  const [all, plans, wallet] = await Promise.all([
    netOf(base),
    netOf({ AND: [base, { subscriptionId: { not: null } }] }),
    isFiltered(f) ? null : db.creditLedger.aggregate({ _sum: { amount: true } }),
  ]);
  const walletBalance = wallet ? n(wallet._sum.amount) : null;
  return { orders: all.value, orderCount: all.count, plans: plans.value, planMeals: plans.count, single: all.value - plans.value, walletBalance, total: all.value + (walletBalance ?? 0) };
}

export async function receivables(f: AnalyticsFilters) {
  const scopedOut = Boolean(f.kitchenIds || f.zoneId || f.diet || f.planId || f.categoryId || f.channel || f.orderStatus || f.paymentStatus);
  const [pending, inv] = await Promise.all([
    db.payment.aggregate({ where: pendingPaymentsWhere(f), _sum: { amount: true }, _count: true }),
    scopedOut || f.customerType === "INDIVIDUAL" || f.companyId === NONE
      ? null
      : db.invoice.findMany({ where: { kind: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_PAID"] }, ...(f.companyId ? { companyId: f.companyId } : {}) }, select: { total: true, paidAmount: true } }),
  ]);
  return {
    pending: n(pending._sum.amount),
    pendingCount: pending._count,
    invoicesOutstanding: inv ? inv.reduce((a, i) => a + i.total - i.paidAmount, 0) : null,
    invoiceCount: inv?.length ?? null,
  };
}

/** Old "gross/net sales" kept for continuity, correctly labelled as booked-by-delivery-date (includes VAT and undelivered meals). */
export async function bookedByDelivery(f: AnalyticsFilters) {
  const a = await db.order.aggregate({
    where: orderWhere(f, { deliveryDate: dayRange(f.from, f.to), status: { in: [...UPCOMING_STATUSES, ...RECOGNISED_STATUSES] } }),
    _sum: { subtotal: true, deliveryFee: true, discount: true, refundedAmount: true },
    _count: true,
  });
  const gross = n(a._sum.subtotal) + n(a._sum.deliveryFee);
  return { gross, discounts: n(a._sum.discount), refunds: n(a._sum.refundedAmount), net: gross - n(a._sum.discount) - n(a._sum.refundedAmount), count: a._count };
}

// ───────────── period presets with growth ─────────────

export type Period = { key: string; label: string; from: string; to: string; prevFrom: string; prevTo: string };

export function periodPresets(today = todayKTM()): Period[] {
  const shift = (from: string, to: string) => {
    const len = daysBetween(from, to) + 1;
    return { prevFrom: addDays(from, -len), prevTo: addDays(from, -1) };
  };
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthStart = `${addDays(monthStart, -1).slice(0, 7)}-01`;
  const dayOfMonth = daysBetween(monthStart, today);
  const prevMonthEnd = addDays(monthStart, -1);
  const prevMonthSame = addDays(prevMonthStart, dayOfMonth) > prevMonthEnd ? prevMonthEnd : addDays(prevMonthStart, dayOfMonth);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const lastYear = String(Number(today.slice(0, 4)) - 1);
  const ytdPrevTo = `${lastYear}${today.slice(4)}` === `${lastYear}-02-29` ? `${lastYear}-02-28` : `${lastYear}${today.slice(4)}`;
  const yesterday = addDays(today, -1);
  return [
    { key: "today", label: "Today", from: today, to: today, ...shift(today, today) },
    { key: "yesterday", label: "Yesterday", from: yesterday, to: yesterday, ...shift(yesterday, yesterday) },
    { key: "week", label: "Last 7 days", from: addDays(today, -6), to: today, ...shift(addDays(today, -6), today) },
    { key: "month", label: "Month to date", from: monthStart, to: today, prevFrom: prevMonthStart, prevTo: prevMonthSame },
    { key: "ytd", label: "Year to date", from: yearStart, to: today, prevFrom: `${lastYear}-01-01`, prevTo: ytdPrevTo },
  ];
}

export const growth = (cur: number, prev: number) => (prev ? (cur - prev) / Math.abs(prev) : null);

export async function periodTiles(f: AnalyticsFilters, today = todayKTM()) {
  return Promise.all(
    periodPresets(today).map(async (p) => {
      const cur = { ...f, from: p.from, to: p.to };
      const prev = { ...f, from: p.prevFrom, to: p.prevTo };
      const [b, pb, r, pr, c, pc] = await Promise.all([bookings(cur), bookings(prev), recognised(cur), recognised(prev), cash(cur), cash(prev)]);
      return {
        ...p,
        bookings: b.total,
        bookingsGrowth: growth(b.total, pb.total),
        recognised: r.value,
        recognisedGrowth: growth(r.value, pr.value),
        cash: c.net,
        cashGrowth: growth(c.net, pc.net),
      };
    }),
  );
}

// ───────────── trend series ─────────────

export type Bucket = "day" | "week" | "month";
export const BUCKETS: Bucket[] = ["day", "week", "month"];

const KTM_DATE = (col: string) => Prisma.raw(`((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kathmandu')::date`);

/** Recognised / bookings / cash per bucket (weeks start Sunday, the Nepali work week). */
export async function trendSeries(f: AnalyticsFilters, bucket: Bucket = "day") {
  const trunc = (expr: Prisma.Sql) =>
    bucket === "day" ? Prisma.sql`${expr}` : bucket === "month" ? Prisma.sql`date_trunc('month', ${expr})::date` : Prisma.sql`(${expr} - EXTRACT(DOW FROM ${expr})::int)`;
  const day = dayRange(f.from, f.to);
  const st = stampRange(f.from, f.to);
  const dims = orderDimsSql(f, "o");
  const [rec, single, plans, cashRows] = await Promise.all([
    db.$queryRaw<{ b: Date; v: bigint; c: bigint }[]>`
      SELECT ${trunc(Prisma.sql`o."deliveryDate"`)} AS b, SUM(o.total - o.tax - o."refundedAmount") AS v, COUNT(*) AS c
      FROM "Order" o WHERE o.status::text = ANY(${RECOGNISED_STATUSES as string[]}) AND o."deliveryDate" BETWEEN ${day.gte} AND ${day.lte} ${dims}
      GROUP BY 1`,
    db.$queryRaw<{ b: Date; v: bigint }[]>`
      SELECT ${trunc(Prisma.sql`${KTM_DATE('o."createdAt"')}`)} AS b, SUM(o.total) AS v
      FROM "Order" o WHERE o."subscriptionId" IS NULL AND o.status::text <> ALL(${NOT_BOOKED as string[]})
        AND o."createdAt" >= ${st.gte} AND o."createdAt" < ${st.lt} ${dims}
      GROUP BY 1`,
    db.subscription.findMany({ where: bookingsPlanWhere(f), select: { createdAt: true, total: true } }),
    db.payment.findMany({ where: cashWhere(f), select: { paidAt: true, amount: true } }),
  ]);
  const keyOf = (d: string) => {
    if (bucket === "day") return d;
    if (bucket === "month") return `${d.slice(0, 7)}-01`;
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    return addDays(d, -dow);
  };
  const ktmDate = (t: Date) => new Date(t.getTime() + 345 * 60_000).toISOString().slice(0, 10);
  const map = new Map<string, { recognised: number; delivered: number; bookings: number; cash: number }>();
  const get = (k: string) => map.get(k) ?? (map.set(k, { recognised: 0, delivered: 0, bookings: 0, cash: 0 }), map.get(k)!);
  for (const r of rec) Object.assign(get(r.b.toISOString().slice(0, 10)), { recognised: Number(r.v), delivered: Number(r.c) });
  for (const r of single) get(r.b.toISOString().slice(0, 10)).bookings += Number(r.v);
  for (const p of plans) get(keyOf(ktmDate(p.createdAt))).bookings += p.total;
  for (const p of cashRows) if (p.paidAt) get(keyOf(ktmDate(p.paidAt))).cash += p.amount;
  // Refunds reduce net cash in the bucket they were processed.
  if (!f.method) {
    const refunds = await db.refund.findMany({ where: refundsWhere(f), select: { processedAt: true, amount: true } });
    for (const r of refunds) if (r.processedAt) get(keyOf(ktmDate(r.processedAt))).cash -= r.amount;
  }
  const out: { key: string; from: string; to: string; recognised: number; delivered: number; bookings: number; cash: number }[] = [];
  for (let k = keyOf(f.from); k <= f.to && out.length < 400; ) {
    const next = bucket === "day" ? addDays(k, 1) : bucket === "week" ? addDays(k, 7) : `${addDays(`${k.slice(0, 7)}-28`, 4).slice(0, 7)}-01`;
    const from = k < f.from ? f.from : k;
    const to = addDays(next, -1) > f.to ? f.to : addDays(next, -1);
    out.push({ key: k, from, to, ...(map.get(k) ?? { recognised: 0, delivered: 0, bookings: 0, cash: 0 }) });
    k = next;
  }
  return out;
}

// ───────────── breakdowns ─────────────

export type BreakdownRow = { key: string; label: string; value: number; count: number };

const sortRows = (rows: BreakdownRow[]) => rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

/** Recognised revenue by kitchen, zone or company (Prisma groupBy on the same where as the KPI). */
async function recognisedBy(f: AnalyticsFilters, by: "kitchenId" | "zoneId" | "companyId") {
  const rows = await db.order.groupBy({ by: [by], where: recognisedWhere(f), _sum: { total: true, tax: true, refundedAmount: true }, _count: { _all: true } });
  return rows.map((r) => ({ id: (r[by] as string | null) ?? null, value: n(r._sum.total) - n(r._sum.tax) - n(r._sum.refundedAmount), count: r._count._all }));
}

export async function byKitchen(f: AnalyticsFilters): Promise<BreakdownRow[]> {
  const rows = await recognisedBy(f, "kitchenId");
  const names = new Map((await db.kitchen.findMany({ where: { id: { in: rows.map((r) => r.id!).filter(Boolean) } }, select: { id: true, name: true } })).map((k) => [k.id, k.name]));
  return sortRows(rows.map((r) => ({ key: r.id!, label: names.get(r.id!) ?? "Unknown kitchen", value: r.value, count: r.count })));
}

export async function byZone(f: AnalyticsFilters): Promise<BreakdownRow[]> {
  const rows = await recognisedBy(f, "zoneId");
  const names = new Map((await db.deliveryZone.findMany({ where: { id: { in: rows.map((r) => r.id!).filter(Boolean) } }, select: { id: true, name: true } })).map((k) => [k.id, k.name]));
  return sortRows(rows.map((r) => ({ key: r.id ?? NONE, label: r.id ? (names.get(r.id) ?? "Unknown zone") : "No zone recorded", value: r.value, count: r.count })));
}

export async function byCompany(f: AnalyticsFilters): Promise<BreakdownRow[]> {
  const rows = await recognisedBy(f, "companyId");
  const names = new Map((await db.company.findMany({ where: { id: { in: rows.map((r) => r.id!).filter(Boolean) } }, select: { id: true, name: true } })).map((k) => [k.id, k.name]));
  return sortRows(rows.map((r) => ({ key: r.id ?? NONE, label: r.id ? (names.get(r.id) ?? "Unknown company") : "Individual customers", value: r.value, count: r.count })));
}

/** Recognised revenue by meal plan (plan meals) vs single orders. */
export async function byPlan(f: AnalyticsFilters): Promise<BreakdownRow[]> {
  const day = dayRange(f.from, f.to);
  const rows = await db.$queryRaw<{ id: string | null; name: string | null; v: bigint; c: bigint }[]>`
    SELECT p.id, p.name, SUM(o.total - o.tax - o."refundedAmount") AS v, COUNT(*) AS c
    FROM "Order" o LEFT JOIN "Subscription" s ON s.id = o."subscriptionId" LEFT JOIN "MealPlan" p ON p.id = s."planId"
    WHERE o.status::text = ANY(${RECOGNISED_STATUSES as string[]}) AND o."deliveryDate" BETWEEN ${day.gte} AND ${day.lte} ${orderDimsSql(f, "o")}
    GROUP BY 1, 2`;
  return sortRows(rows.map((r) => ({ key: r.id ?? NONE, label: r.name ?? "Single orders (no plan)", value: Number(r.v), count: Number(r.c) })));
}

/** Meal-plan bookings by plan (counted once at purchase). */
export async function planBookingsByPlan(f: AnalyticsFilters): Promise<BreakdownRow[]> {
  const rows = await db.subscription.groupBy({ by: ["planId"], where: bookingsPlanWhere(f), _sum: { total: true }, _count: { _all: true } });
  const names = new Map((await db.mealPlan.findMany({ where: { id: { in: rows.map((r) => r.planId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  return sortRows(rows.map((r) => ({ key: r.planId, label: names.get(r.planId) ?? "Unknown plan", value: n(r._sum.total), count: r._count._all })));
}

/** Line value (Σ lineTotal, before order-level discounts, incl. VAT) of delivered items by dabba category. */
export async function byCategory(f: AnalyticsFilters): Promise<BreakdownRow[]> {
  const day = dayRange(f.from, f.to);
  const rows = await db.$queryRaw<{ id: string | null; name: string | null; v: bigint; c: bigint }[]>`
    SELECT mc.id, mc.name, SUM(oi."lineTotal") AS v, SUM(oi.quantity) AS c
    FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN "LunchBox" b ON b.id = oi."boxId" LEFT JOIN "MealCategory" mc ON mc.id = b."categoryId"
    WHERE o.status::text = ANY(${RECOGNISED_STATUSES as string[]}) AND o."deliveryDate" BETWEEN ${day.gte} AND ${day.lte} ${orderDimsSql(f, "o")}
    GROUP BY 1, 2`;
  return sortRows(rows.map((r) => ({ key: r.id ?? NONE, label: r.name ?? "Uncategorised / Build-a-Dabba", value: Number(r.v), count: Number(r.c) })));
}

/** Recognised revenue by the customer's first-touch acquisition channel (User.acquisitionSource). */
export async function byChannel(f: AnalyticsFilters): Promise<{ rows: BreakdownRow[]; captured: boolean }> {
  const day = dayRange(f.from, f.to);
  const rows = await db.$queryRaw<{ ch: string | null; v: bigint; c: bigint }[]>`
    SELECT u."acquisitionSource" AS ch, SUM(o.total - o.tax - o."refundedAmount") AS v, COUNT(*) AS c
    FROM "Order" o JOIN "User" u ON u.id = o."userId"
    WHERE o.status::text = ANY(${RECOGNISED_STATUSES as string[]}) AND o."deliveryDate" BETWEEN ${day.gte} AND ${day.lte} ${orderDimsSql(f, "o")}
    GROUP BY 1`;
  const out = sortRows(rows.map((r) => ({ key: r.ch ?? NONE, label: r.ch ?? "Not captured yet", value: Number(r.v), count: Number(r.c) })));
  return { rows: out, captured: out.some((r) => r.key !== NONE) };
}

/** Cash basis by payment method; wallet spends listed separately as non-cash. */
export async function cashByMethod(f: AnalyticsFilters): Promise<(BreakdownRow & { cash: boolean })[]> {
  const rows = await db.payment.groupBy({ by: ["method"], where: cashWhere(f, { includeNonCash: true }), _sum: { amount: true }, _count: { _all: true } });
  return rows
    .map((r) => ({ key: r.method, label: METHOD_LABEL[r.method] + (NON_CASH_METHODS.includes(r.method) ? " (not new cash)" : ""), value: n(r._sum.amount), count: r._count._all, cash: !NON_CASH_METHODS.includes(r.method) }))
    .sort((a, b) => Number(b.cash) - Number(a.cash) || b.value - a.value);
}

// ───────────── profitability (estimated vs recorded) ─────────────

export type CostLine = { key: string; label: string; estimated: number | null; actual: number | null; note?: string };

const OVERHEAD_EXCLUDE = ["FOOD", "PACKAGING", "DELIVERY", "GATEWAY_FEES"];

/**
 * Contribution view. `null` = no data recorded for that source (never shown as zero-as-fact).
 * This is an operating estimate; WP-09 owns the full P&L and period close.
 */
export async function profitability(f: AnalyticsFilters) {
  const rec = await recognised(f);
  const delivered = recognisedWhere(f);
  const kitchenFilter = f.kitchenIds ? { kitchenId: { in: f.kitchenIds } } : {};
  const expenseBase: Prisma.ExpenseWhereInput = { date: dayRange(f.from, f.to), status: { in: ["APPROVED", "PAID"] }, ...kitchenFilter };
  const [orders, configuredPackaging, movements, routes, payments, feeActual, expenses, categories, closed] = await Promise.all([
    db.order.aggregate({ where: delivered, _sum: { costTotal: true, packagingCost: true } }),
    db.lunchBox.count({ where: { packagingCost: { gt: 0 } } }),
    db.stockMovement.findMany({
      where: { type: { in: ["USAGE", "WASTE"] }, createdAt: stampRange(f.from, f.to), ...kitchenFilter },
      select: { quantity: true, unitCost: true, ingredient: { select: { costPerUnit: true } } },
    }),
    db.deliveryRoute.aggregate({ where: { date: dayRange(f.from, f.to), cost: { not: null }, ...kitchenFilter }, _sum: { cost: true }, _count: true }),
    db.payment.aggregate({ where: cashWhere(f), _sum: { gatewayFee: true }, _count: true }),
    db.payment.aggregate({ where: { AND: [cashWhere(f), { feeActual: { not: null } }] }, _sum: { feeActual: true }, _count: true }),
    db.expense.groupBy({ by: ["categoryId"], where: expenseBase, _sum: { amount: true }, _count: { _all: true } }),
    db.expenseCategory.findMany({ select: { id: true, key: true, kind: true } }),
    db.accountingPeriod.count({ where: { closedAt: { not: null }, month: { gte: f.from.slice(0, 7), lte: f.to.slice(0, 7) } } }),
  ]);
  const catKey = new Map(categories.map((c) => [c.id, c]));
  const exp = (pred: (key: string, kind: string) => boolean) => {
    const hits = expenses.filter((e) => {
      const c = catKey.get(e.categoryId);
      return c && pred(c.key, c.kind);
    });
    return hits.length ? hits.reduce((a, e) => a + n(e._sum.amount), 0) : null;
  };
  const stockUsed = movements.length ? movements.reduce((a, m) => a + Math.round(Math.abs(m.quantity) * (m.unitCost ?? m.ingredient.costPerUnit)), 0) : null;
  const packagingEst = n(orders._sum.packagingCost);
  const lines: CostLine[] = [
    { key: "food", label: "Food cost", estimated: rec.count ? n(orders._sum.costTotal) : null, actual: stockUsed ?? exp((k) => k === "FOOD"), note: stockUsed == null ? "No stock usage recorded" : undefined },
    { key: "packaging", label: "Packaging", estimated: packagingEst || configuredPackaging ? packagingEst : null, actual: exp((k) => k === "PACKAGING"), note: !packagingEst && !configuredPackaging ? "No packaging cost set on any dabba" : undefined },
    { key: "delivery", label: "Delivery", estimated: routes._count ? n(routes._sum.cost) : null, actual: exp((k) => k === "DELIVERY"), note: routes._count ? undefined : "No route costs entered" },
    { key: "gateway", label: "Gateway fees", estimated: payments._count ? n(payments._sum.gatewayFee) : null, actual: feeActual._count ? n(feeActual._sum.feeActual) : null, note: feeActual._count ? `${feeActual._count} of ${payments._count} payments reconciled` : "No gateway statements imported" },
    { key: "overheads", label: "Labour, rent, utilities, marketing, other", estimated: null, actual: exp((k, kind) => !OVERHEAD_EXCLUDE.includes(k) && kind !== "CAPEX"), note: f.kitchenIds ? "Only expenses tagged to these kitchens" : undefined },
  ];
  const best = (l: CostLine) => l.actual ?? l.estimated;
  const known = lines.filter((l) => best(l) != null);
  const contribution = rec.value - lines.slice(0, 4).reduce((a, l) => a + (l.estimated ?? 0), 0);
  const operating = rec.value - known.reduce((a, l) => a + (best(l) ?? 0), 0);
  return { revenue: rec.value, lines, contribution, operating, coverage: known.length, closedMonths: closed, months: monthsIn(f.from, f.to) };
}

function monthsIn(from: string, to: string) {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
}

