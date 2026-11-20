import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isoDate } from "@/lib/dates";
import { dayRange, orderDimsSql, subscriptionDims } from "@/server/analytics/filters";
import { METRICS, RECOGNISED_STATUSES } from "@/server/analytics/metrics";
import { ltv } from "@/server/analytics/customers";
import { renewalsDue } from "@/server/analytics/subscriptions";
import { cohorts } from "@/server/reports";
import { REVENUE_STATUSES } from "@/server/transitions";
import { pageOf, ratio, windowOf } from "./common";
import type { Col, ReportDef } from "./types";

export const subscriptionRenewals: ReportDef = {
  key: "subscription-renewals",
  title: "Subscription renewals",
  group: "Customers & plans",
  description: "Meal plans that ended in the range and whether the customer renewed.",
  definition:
    "Plans (not awaiting payment) whose end date is in the range. Renewed = a later plan was created from it (one-click renewal, `renewedFrom`) and isn't awaiting payment or cancelled. Renewal rate = renewed ÷ ended. Renewal is manual: “Renewals due” is the analytics metric for the next 7 days.",
  view: ["subscriptions.view"],
  exportPerms: [],
  filters: ["range", "kitchen", "company", "ctype"],
  columns: [
    { key: "reference", label: "Plan ref" },
    { key: "plan", label: "Plan" },
    { key: "customer", label: "Customer" },
    { key: "email", label: "Email", kind: "email" },
    { key: "endDate", label: "Ends", kind: "date" },
    { key: "status", label: "Status" },
    { key: "meals", label: "Meals", kind: "int" },
    { key: "total", label: "Plan total", kind: "money" },
    { key: "renewed", label: "Renewed" },
    { key: "renewal", label: "Renewal ref" },
  ],
  async run({ f, today }, paging) {
    const where: Prisma.SubscriptionWhereInput = { ...subscriptionDims(f), status: { not: "PENDING_PAYMENT" }, endDate: dayRange(f.from, f.to) };
    const renewedWhere: Prisma.SubscriptionWhereInput = { renewals: { some: { status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] } } } };
    const [count, renewed, due, list] = await Promise.all([
      db.subscription.count({ where }),
      db.subscription.count({ where: { AND: [where, renewedWhere] } }),
      renewalsDue(f, today),
      db.subscription.findMany({
        where,
        orderBy: [{ endDate: "desc" }, { reference: "asc" }],
        ...windowOf(paging),
        select: {
          reference: true,
          endDate: true,
          status: true,
          mealsTotal: true,
          total: true,
          plan: { select: { name: true } },
          user: { select: { name: true, email: true } },
          renewals: { where: { status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] } }, select: { reference: true }, take: 1 },
        },
      }),
    ]);
    return {
      rows: list.map((s) => ({ reference: s.reference, plan: s.plan.name, customer: s.user.name, email: s.user.email, endDate: isoDate(s.endDate), status: s.status, meals: s.mealsTotal, total: s.total, renewed: s.renewals.length ? "Yes" : "No", renewal: s.renewals[0]?.reference ?? "" })),
      count,
      summary: [
        { label: "Plans ended", value: count, kind: "int" },
        { label: "Renewed", value: renewed, kind: "int" },
        { label: "Renewal rate", value: ratio(renewed, count), kind: "pct" },
        { label: METRICS.renewalsDue.label, value: due, kind: "int", note: METRICS.renewalsDue.definition },
      ],
    };
  },
};

export const retention: ReportDef = {
  key: "retention",
  title: "Customer retention",
  group: "Customers & plans",
  description: "Monthly cohorts by first delivered order: share still ordering in each following month.",
  definition: "Cohort = month of the customer's first DELIVERED order (in your kitchens). Cell = customers of the cohort with a delivered order in month +n ÷ cohort size. Cohorts from the last N months (the date range doesn't apply).",
  view: ["customers.view"],
  exportPerms: [],
  filters: ["kitchen"],
  snapshot: true,
  choices: [{ name: "months", label: "Months", options: [{ value: "6", label: "6 months" }, { value: "12", label: "12 months" }] }],
  columns: [
    { key: "cohort", label: "Cohort" },
    { key: "size", label: "Customers", kind: "int" },
  ],
  async run({ f, choice }, paging) {
    const months = Number(choice.months) || 6;
    const rows = await cohorts(months, f.kitchenIds);
    const columns: Col[] = [{ key: "cohort", label: "Cohort" }, { key: "size", label: "Customers", kind: "int" }, ...Array.from({ length: months }, (_, i) => ({ key: `m${i}`, label: `Month +${i}`, kind: "pct" as const }))];
    const all = rows.map((r) => ({ cohort: r.cohort, size: r.size, ...Object.fromEntries(r.cells.map((c, i) => [`m${i}`, c])) }));
    return { rows: pageOf(all, paging), count: all.length, columns, totals: { cohort: "Total", size: all.reduce((a, r) => a + r.size, 0) } };
  },
};

const REC = RECOGNISED_STATUSES as string[];

export const customerLifetimeValue: ReportDef = {
  key: "clv",
  title: "Customer lifetime value",
  group: "Customers & plans",
  description: "Historical revenue per customer up to the end of the range.",
  definition: "Analytics → Historical LTV, per customer: Σ recognised revenue (delivered orders' total − VAT − refunded) since signup up to the range end, same filters. Average = Σ ÷ customers with a delivered order. Historical only — no prediction.",
  view: ["analytics.view", "customers.view"],
  exportPerms: ["analytics.export"],
  filters: ["range", "kitchen", "company", "ctype"],
  columns: [
    { key: "customer", label: "Customer" },
    { key: "email", label: "Email", kind: "email" },
    { key: "first", label: "First delivery", kind: "date" },
    { key: "last", label: "Last delivery", kind: "date" },
    { key: "orders", label: "Delivered orders", kind: "int" },
    { key: "value", label: "Lifetime revenue", kind: "money" },
  ],
  async run({ f }, paging) {
    const end = dayRange(f.from, f.to).lte;
    const w = windowOf(paging);
    const [summary, rows] = await Promise.all([
      ltv(f),
      db.$queryRaw<{ userId: string; v: bigint; c: bigint; first: Date; last: Date; name: string | null; email: string | null; deletedAt: Date | null }[]>`
        SELECT t.*, u.name, u.email, u."deletedAt" FROM (
          SELECT o."userId", SUM(o.total - o.tax - o."refundedAmount") AS v, COUNT(*) AS c, MIN(o."deliveryDate") AS first, MAX(o."deliveryDate") AS last
          FROM "Order" o WHERE o.status::text = ANY(${REC}) AND o."deliveryDate" <= ${end} ${orderDimsSql(f, "o")}
          GROUP BY 1
        ) t JOIN "User" u ON u.id = t."userId"
        ORDER BY t.v DESC, t."userId" ASC LIMIT ${w.take} OFFSET ${w.skip}`,
    ]);
    return {
      rows: rows.map((r) => ({ customer: r.deletedAt ? "Deleted customer" : (r.name ?? "—"), email: r.deletedAt ? null : r.email, first: isoDate(r.first), last: isoDate(r.last), orders: Number(r.c), value: Number(r.v) })),
      count: summary.customers,
      totals: { customer: "Total", value: summary.total },
      summary: [
        { label: "Customers", value: summary.customers, kind: "int" },
        { label: METRICS.ltv.label, value: summary.average, kind: "money", note: METRICS.ltv.definition },
      ],
    };
  },
};

const LIVE = REVENUE_STATUSES as string[];

export const popularMeals: ReportDef = {
  key: "popular-meals",
  title: "Popular meals",
  group: "Menu & costing",
  description: "What customers ordered most — by dish (portions) or by dabba.",
  definition:
    "Orders Scheduled → Delivered with delivery date in the range (the “booked by delivery date” set, so it includes meals still to deliver). Dish portions come from the immutable order snapshots (set dabbas and Build-a-Dabba): Σ dish qty × line quantity. By dabba: Σ line quantity and line value.",
  view: [],
  exportPerms: [],
  filters: ["range", "kitchen", "company", "ctype"],
  choices: [{ name: "level", label: "Show", options: [{ value: "dish", label: "Dishes" }, { value: "dabba", label: "Dabbas" }] }],
  columns: [
    { key: "name", label: "Name" },
    { key: "qty", label: "Portions / sold", kind: "int" },
    { key: "orders", label: "Orders", kind: "int" },
    { key: "share", label: "Share", kind: "pct" },
  ],
  async run({ f, choice }, paging) {
    const day = dayRange(f.from, f.to);
    const dims = orderDimsSql(f, "o");
    const rows =
      choice.level === "dabba"
        ? await db.$queryRaw<{ name: string; n: bigint; o: bigint }[]>`
            SELECT oi.name, SUM(oi.quantity) AS n, COUNT(DISTINCT o.id) AS o FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
            WHERE o."deliveryDate" BETWEEN ${day.gte} AND ${day.lte} AND o.status::text = ANY(${LIVE}) ${dims}
            GROUP BY 1`
        : await db.$queryRaw<{ name: string; n: bigint; o: bigint }[]>`
            SELECT c->>'name' AS name, SUM(COALESCE((c->>'qty')::int, 1) * oi.quantity) AS n, COUNT(DISTINCT o.id) AS o
            FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" CROSS JOIN LATERAL jsonb_array_elements(oi.components) c
            WHERE o."deliveryDate" BETWEEN ${day.gte} AND ${day.lte} AND o.status::text = ANY(${LIVE}) ${dims}
            GROUP BY 1`;
    const total = rows.reduce((a, r) => a + Number(r.n), 0);
    const all = rows.map((r) => ({ name: r.name ?? "—", qty: Number(r.n), orders: Number(r.o), share: ratio(Number(r.n), total) })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
    return { rows: pageOf(all, paging), count: all.length, totals: { name: "Total", qty: total, share: total ? 1 : null } };
  },
};
