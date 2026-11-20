import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dayRange, orderDimsSql, type AnalyticsFilters } from "@/server/analytics/filters";
import { METRICS, RECOGNISED_STATUSES } from "@/server/analytics/metrics";
import * as rev from "@/server/analytics/revenue";
import { COMPANY_SHARE_PREFIX } from "@/server/corporate";
import { pageOf, ratio, totalsOf } from "./common";
import type { Col, ReportDef, Row, Summary } from "./types";

const MONEY_VIEW = ["analytics.view"] as const;
const MONEY_EXPORT = ["analytics.export"] as const;

// ───────────── period sales (daily / weekly / monthly / annual) ─────────────

const PERIOD_COLS: Col[] = [
  { key: "period", label: "Period" },
  { key: "from", label: "From", kind: "date" },
  { key: "to", label: "To", kind: "date" },
  { key: "delivered", label: "Delivered orders", kind: "int" },
  { key: "recognised", label: "Recognised revenue", kind: "money" },
  { key: "bookings", label: "Bookings", kind: "money" },
  { key: "cash", label: "Net cash", kind: "money" },
];

/** Headline tiles straight from the analytics functions (the period rows must add up to these). */
async function revenueSummary(f: AnalyticsFilters): Promise<Summary[]> {
  const [r, b, c] = await Promise.all([rev.recognised(f), rev.bookings(f), rev.cash(f)]);
  return [
    { label: METRICS.recognised.label, value: r.value, kind: "money", note: METRICS.recognised.definition },
    { label: METRICS.recognisedAdjustments.label, value: r.adjustments, kind: "money", note: METRICS.recognisedAdjustments.definition },
    { label: METRICS.bookings.label, value: b.total, kind: "money", note: METRICS.bookings.definition },
    { label: METRICS.netCash.label, value: c.net, kind: "money", note: `${METRICS.netCash.definition} ${METRICS.cashIn.definition}` },
  ];
}

function periodReport(key: string, title: string, bucket: "day" | "week" | "month" | "year", defaultDays: number): ReportDef {
  return {
    key,
    title,
    group: "Sales & revenue",
    description: `Recognised revenue, bookings and net cash per ${bucket}.`,
    definition:
      "Each row uses the analytics bases (Analytics → Revenue): recognised = delivered orders' total − VAT − refunded by delivery date; bookings = single orders + meal plans created; net cash = payments collected − cash refunds. Weeks start Sunday. The totals equal the analytics KPIs for the same filters.",
    view: [...MONEY_VIEW],
    exportPerms: [...MONEY_EXPORT],
    filters: ["range", "kitchen", "company", "ctype"],
    columns: PERIOD_COLS,
    defaultDays,
    async run({ f }, paging) {
      const series = await rev.trendSeries(f, bucket === "year" ? "month" : bucket);
      let rows: Row[];
      if (bucket === "year") {
        const years = new Map<string, Row>();
        for (const s of series) {
          const y = s.key.slice(0, 4);
          const r = years.get(y) ?? { period: y, from: s.from, to: s.to, delivered: 0, recognised: 0, bookings: 0, cash: 0 };
          r.to = s.to;
          for (const k of ["delivered", "recognised", "bookings", "cash"] as const) r[k] = (r[k] as number) + s[k];
          years.set(y, r);
        }
        rows = [...years.values()];
      } else {
        rows = series.map((s) => ({ period: bucket === "month" ? s.key.slice(0, 7) : bucket === "week" ? `Week of ${s.key}` : s.key, from: s.from, to: s.to, delivered: s.delivered, recognised: s.recognised, bookings: s.bookings, cash: s.cash }));
      }
      return {
        rows: pageOf(rows, paging),
        count: rows.length,
        totals: totalsOf(rows, ["delivered", "recognised", "bookings", "cash"], { period: "Total" }),
        summary: await revenueSummary(f),
      };
    },
  };
}

export const dailySales = periodReport("daily-sales", "Daily sales", "day", 30);
export const weeklySales = periodReport("weekly-sales", "Weekly sales", "week", 91);
export const monthlySales = periodReport("monthly-sales", "Monthly sales", "month", 365);
export const annualSales = periodReport("annual-sales", "Annual sales", "year", 365 * 3);

// ───────────── revenue by meal + meal profitability (shared query) ─────────────

const REC = RECOGNISED_STATUSES as string[];

/**
 * Per dabba (order-line name snapshot) on DELIVERED orders: quantity, line value, recorded unit cost and the order's
 * recognised revenue (total − VAT − refunded) allocated to its lines by line value (equal split when all lines are free).
 * Σ allocated revenue = recognised revenue (rows are rounded to the paisa; the total shown is the exact KPI).
 */
export async function mealRevenueRows(f: AnalyticsFilters) {
  const day = dayRange(f.from, f.to);
  const rows = await db.$queryRaw<{ name: string; qty: bigint; line: bigint; cost: bigint; rev: Prisma.Decimal | number | null; orders: bigint }[]>`
    WITH o AS (
      SELECT o.id, (o.total - o.tax - o."refundedAmount") AS net FROM "Order" o
      WHERE o.status::text = ANY(${REC}) AND o."deliveryDate" BETWEEN (${day.gte} AT TIME ZONE 'UTC')::date AND (${day.lte} AT TIME ZONE 'UTC')::date ${orderDimsSql(f, "o")}
    ), lt AS (
      SELECT oi."orderId", SUM(oi."lineTotal") AS s, COUNT(*) AS c FROM "OrderItem" oi JOIN o ON o.id = oi."orderId" GROUP BY 1
    )
    SELECT oi.name, SUM(oi.quantity) AS qty, SUM(oi."lineTotal") AS line, SUM(oi."unitCost" * oi.quantity) AS cost,
           SUM(CASE WHEN lt.s > 0 THEN o.net::numeric * oi."lineTotal" / lt.s ELSE o.net::numeric / lt.c END) AS rev,
           COUNT(DISTINCT o.id) AS orders
    FROM "OrderItem" oi JOIN o ON o.id = oi."orderId" JOIN lt ON lt."orderId" = oi."orderId"
    GROUP BY oi.name`;
  return rows
    .map((r) => {
      const revenue = Math.round(Number(r.rev ?? 0));
      const cost = Number(r.cost);
      return { name: r.name, orders: Number(r.orders), qty: Number(r.qty), line: Number(r.line), revenue, cost, margin: revenue - cost, marginPct: ratio(revenue - cost, revenue) };
    })
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
}

export const revenueByMeal: ReportDef = {
  key: "revenue-by-meal",
  title: "Revenue by meal",
  group: "Sales & revenue",
  description: "Recognised revenue per dabba sold, with quantities and line value.",
  definition:
    "Delivered orders in the range. Each order's recognised revenue (total − VAT − refunded) is split over its lines in proportion to line value (before order-level discounts). Line value = Σ line totals (VAT-inclusive, before discounts). The total equals Analytics → Recognised revenue.",
  view: [...MONEY_VIEW],
  exportPerms: [...MONEY_EXPORT],
  filters: ["range", "kitchen", "company", "ctype"],
  columns: [
    { key: "name", label: "Dabba" },
    { key: "qty", label: "Sold", kind: "int" },
    { key: "orders", label: "Orders", kind: "int" },
    { key: "line", label: "Line value", kind: "money" },
    { key: "revenue", label: "Recognised revenue", kind: "money" },
    { key: "share", label: "Share", kind: "pct" },
  ],
  async run({ f }, paging) {
    const [rows, r] = await Promise.all([mealRevenueRows(f), rev.recognised(f)]);
    const all = rows.map((x) => ({ ...x, share: ratio(x.revenue, r.value) }));
    return {
      rows: pageOf(all, paging),
      count: all.length,
      totals: { name: "Total", qty: all.reduce((a, x) => a + x.qty, 0), line: all.reduce((a, x) => a + x.line, 0), revenue: r.value, share: r.value ? 1 : null },
      summary: [{ label: METRICS.recognised.label, value: r.value, kind: "money", note: METRICS.recognised.definition }],
    };
  },
};

export const mealProfitability: ReportDef = {
  key: "meal-profitability",
  title: "Meal profitability",
  group: "Menu & costing",
  description: "Per dabba: allocated recognised revenue against the recorded recipe cost.",
  definition:
    "Delivered orders in the range. Revenue as in Revenue by meal (recognised revenue allocated by line value). Cost = Σ unit cost × quantity snapshotted on each order line at order time (the recipe cost then). Margin = revenue − cost: food contribution before packaging, delivery and overheads (see Analytics → Profitability).",
  view: [...MONEY_VIEW],
  exportPerms: [...MONEY_EXPORT],
  filters: ["range", "kitchen", "company", "ctype"],
  columns: [
    { key: "name", label: "Dabba" },
    { key: "qty", label: "Sold", kind: "int" },
    { key: "revenue", label: "Recognised revenue", kind: "money" },
    { key: "cost", label: "Food cost (recorded)", kind: "money" },
    { key: "margin", label: "Food margin", kind: "money" },
    { key: "marginPct", label: "Margin %", kind: "pct" },
  ],
  async run({ f }, paging) {
    const rows = (await mealRevenueRows(f)).sort((a, b) => b.margin - a.margin || a.name.localeCompare(b.name));
    const t = totalsOf(rows, ["qty", "revenue", "cost", "margin"], { name: "Total" });
    t.marginPct = ratio(Number(t.margin), Number(t.revenue));
    return { rows: pageOf(rows, paging), count: rows.length, totals: t };
  },
};

// ───────────── revenue by kitchen / corporate client ─────────────

export const revenueByKitchen: ReportDef = {
  key: "revenue-by-kitchen",
  title: "Revenue by kitchen",
  group: "Sales & revenue",
  description: "Recognised revenue, delivered orders and average order value per kitchen.",
  definition: "Analytics → Revenue by kitchen (recognised basis: delivered orders' total − VAT − refunded, by delivery date). Rows add up to recognised revenue.",
  view: [...MONEY_VIEW],
  exportPerms: [...MONEY_EXPORT],
  filters: ["range", "kitchen", "company", "ctype"],
  columns: [
    { key: "kitchen", label: "Kitchen" },
    { key: "orders", label: "Delivered orders", kind: "int" },
    { key: "revenue", label: "Recognised revenue", kind: "money" },
    { key: "aov", label: "Average order value", kind: "money" },
    { key: "share", label: "Share", kind: "pct" },
  ],
  async run({ f }, paging) {
    const [rows, r] = await Promise.all([rev.byKitchen(f), rev.recognised(f)]);
    const all = rows.map((x) => ({ kitchen: x.label, orders: x.count, revenue: x.value, aov: x.count ? Math.round(x.value / x.count) : null, share: ratio(x.value, r.value) }));
    return {
      rows: pageOf(all, paging),
      count: all.length,
      totals: { kitchen: "Total", orders: r.count, revenue: r.value, aov: r.aov, share: r.value ? 1 : null },
      summary: [
        { label: METRICS.recognised.label, value: r.value, kind: "money", note: METRICS.recognised.definition },
        { label: METRICS.recognisedAdjustments.label, value: r.adjustments, kind: "money", note: METRICS.recognisedAdjustments.definition },
      ],
    };
  },
};

export const revenueByCorporate: ReportDef = {
  key: "revenue-by-corporate",
  title: "Revenue by corporate client",
  group: "Sales & revenue",
  description: "Recognised revenue per company, with the employer and employee shares and staff adjustments.",
  definition:
    "Delivered orders of company employees in the range (Analytics → Revenue by company, corporate customers only). Company / employee share are the split recorded at checkout; company adjustments are company-share adjustment rows from staff edits on those orders (VAT-inclusive, billed on the next invoice).",
  view: [...MONEY_VIEW, "corporate.view"],
  exportPerms: [...MONEY_EXPORT],
  filters: ["range", "kitchen", "company"],
  columns: [
    { key: "company", label: "Company" },
    { key: "orders", label: "Delivered orders", kind: "int" },
    { key: "revenue", label: "Recognised revenue", kind: "money" },
    { key: "companyShare", label: "Company share", kind: "money" },
    { key: "companyAdjustments", label: "Company adjustments", kind: "money" },
    { key: "employeeShare", label: "Employee share", kind: "money" },
  ],
  async run({ f, companyIds }, paging) {
    const cf: AnalyticsFilters = { ...f, customerType: "CORPORATE" };
    const where = rev.recognisedWhere(cf);
    const [rows, shares, adjustments] = await Promise.all([
      rev.byCompany(cf),
      db.order.groupBy({ by: ["companyId"], where, _sum: { companyShare: true, customerShare: true } }),
      db.orderAdjustment.findMany({ where: { order: where, reason: { startsWith: COMPANY_SHARE_PREFIX } }, select: { amount: true, order: { select: { companyId: true } } } }),
    ]);
    const share = new Map(shares.map((s) => [s.companyId, s._sum]));
    const adj = new Map<string, number>();
    for (const a of adjustments) if (a.order.companyId) adj.set(a.order.companyId, (adj.get(a.order.companyId) ?? 0) + a.amount);
    const all: Row[] = rows
      .filter((x) => !companyIds || companyIds.includes(x.key))
      .map((x) => ({ company: x.label, orders: x.count, revenue: x.value, companyShare: share.get(x.key)?.companyShare ?? 0, companyAdjustments: adj.get(x.key) ?? 0, employeeShare: share.get(x.key)?.customerShare ?? 0 }));
    return { rows: pageOf(all, paging), count: all.length, totals: totalsOf(all, ["orders", "revenue", "companyShare", "companyAdjustments", "employeeShare"], { company: "Total" }) };
  },
};
