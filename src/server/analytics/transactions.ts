import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isoDate, todayKTM } from "@/lib/dates";
import { dayRange, orderWhere, type AnalyticsFilters } from "./filters";
import { NON_CASH_METHODS, RECOGNISED_STATUSES, UPCOMING_STATUSES } from "./metrics";
import {
  bookingsOrderWhere,
  bookingsPlanWhere,
  cancelledWhere,
  cashWhere,
  deferredWhere,
  pendingPaymentsWhere,
  recognisedWhere,
  refundsWhere,
  upcomingWhere,
} from "./revenue";
import { delayedWhere } from "./orders";
import { renewalsDueWhere, runRatePlansWhere } from "./subscriptions";

/**
 * Drill-down: the exact records behind each metric, using the same where-clause as the metric itself,
 * so the list total always equals the number that was clicked.
 */

export const DRILL_BASES = {
  recognised: { kind: "orders", label: "Recognised revenue — delivered orders", valueLabel: "Recognised (total − VAT − refunded)" },
  upcoming: { kind: "orders", label: "Scheduled revenue — orders still to deliver", valueLabel: "Total − VAT − refunded" },
  booked: { kind: "orders", label: "Booked by delivery date", valueLabel: "Subtotal + delivery fee" },
  cancelled: { kind: "orders", label: "Cancelled orders", valueLabel: "Order total" },
  deferred: { kind: "orders", label: "Deferred revenue — paid, not yet delivered (now)", valueLabel: "Total − VAT − refunded" },
  delayed: { kind: "orders", label: "Delayed orders (now)", valueLabel: "Order total" },
  status: { kind: "orders", label: "Orders by delivery date", valueLabel: "Order total" },
  bookings: { kind: "orders", label: "Bookings — single orders created", valueLabel: "Order total" },
  plans: { kind: "plans", label: "Bookings — meal plans bought", valueLabel: "Plan total" },
  runrate: { kind: "plans", label: "Plans in the run-rate (covering today)", valueLabel: "Plan total" },
  renewals: { kind: "plans", label: "Plans ending in the next 7 days", valueLabel: "Plan total" },
  cash: { kind: "payments", label: "Payments collected", valueLabel: "Amount" },
  receivables: { kind: "payments", label: "Payments awaiting collection (now)", valueLabel: "Amount" },
  refunds: { kind: "refunds", label: "Refunds paid out", valueLabel: "Amount" },
} as const;

export type DrillBasis = keyof typeof DRILL_BASES;
export const isDrillBasis = (b: string | undefined): b is DrillBasis => Boolean(b && b in DRILL_BASES);

export const PAGE_SIZE = 50;
const EXPORT_CAP = 20_000;

function orderBasisWhere(basis: DrillBasis, f: AnalyticsFilters): Prisma.OrderWhereInput {
  switch (basis) {
    case "recognised":
      return recognisedWhere(f);
    case "upcoming":
      return upcomingWhere(f);
    case "booked":
      return orderWhere(f, { deliveryDate: dayRange(f.from, f.to), status: { in: [...UPCOMING_STATUSES, ...RECOGNISED_STATUSES] } });
    case "cancelled":
      return cancelledWhere(f);
    case "deferred":
      return deferredWhere(f);
    case "delayed":
      return delayedWhere(f);
    case "bookings":
      return bookingsOrderWhere(f);
    default:
      return orderWhere(f, { deliveryDate: dayRange(f.from, f.to) });
  }
}

const orderSelect = {
  id: true,
  number: true,
  deliveryDate: true,
  createdAt: true,
  status: true,
  paymentStatus: true,
  source: true,
  subtotal: true,
  deliveryFee: true,
  discount: true,
  tax: true,
  total: true,
  refundedAmount: true,
  contactPhone: true,
  user: { select: { name: true, email: true } },
  kitchen: { select: { name: true } },
  zone: { select: { name: true } },
  company: { select: { name: true } },
  subscription: { select: { reference: true, plan: { select: { name: true } } } },
  payment: { select: { method: true, reference: true } },
} satisfies Prisma.OrderSelect;

const planSelect = {
  id: true,
  reference: true,
  createdAt: true,
  status: true,
  startDate: true,
  endDate: true,
  mealsTotal: true,
  total: true,
  tax: true,
  discount: true,
  cancelReason: true,
  user: { select: { name: true, email: true } },
  plan: { select: { name: true } },
} satisfies Prisma.SubscriptionSelect;

const paymentSelect = {
  id: true,
  reference: true,
  method: true,
  status: true,
  amount: true,
  refundedAmount: true,
  gatewayFee: true,
  feeActual: true,
  paidAt: true,
  createdAt: true,
  user: { select: { name: true, email: true } },
  subscription: { select: { reference: true } },
  _count: { select: { orders: true } },
} satisfies Prisma.PaymentSelect;

const refundSelect = {
  id: true,
  amount: true,
  method: true,
  status: true,
  reason: true,
  processedAt: true,
  providerRef: true,
  payment: { select: { reference: true, user: { select: { name: true, email: true } } } },
  order: { select: { number: true, id: true } },
} satisfies Prisma.RefundSelect;

export type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;
export type PlanRow = Prisma.SubscriptionGetPayload<{ select: typeof planSelect }>;
export type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;
export type RefundRow = Prisma.RefundGetPayload<{ select: typeof refundSelect }>;

export type DrillResult =
  | { kind: "orders"; rows: OrderRow[]; count: number; sum: number }
  | { kind: "plans"; rows: PlanRow[]; count: number; sum: number }
  | { kind: "payments"; rows: PaymentRow[]; count: number; sum: number }
  | { kind: "refunds"; rows: RefundRow[]; count: number; sum: number };

/** The value an order contributes to the clicked metric. */
export function orderValue(basis: DrillBasis, o: Pick<OrderRow, "total" | "tax" | "refundedAmount" | "subtotal" | "deliveryFee">) {
  if (basis === "recognised" || basis === "upcoming" || basis === "deferred") return o.total - o.tax - o.refundedAmount;
  if (basis === "booked") return o.subtotal + o.deliveryFee;
  return o.total;
}

function paymentWhere(basis: DrillBasis, f: AnalyticsFilters) {
  if (basis === "receivables") return pendingPaymentsWhere(f);
  return cashWhere(f, { includeNonCash: Boolean(f.method && NON_CASH_METHODS.includes(f.method)) });
}

function planWhere(basis: DrillBasis, f: AnalyticsFilters, today: string) {
  if (basis === "runrate") return runRatePlansWhere(f, today);
  if (basis === "renewals") return renewalsDueWhere(f, today);
  return bookingsPlanWhere(f);
}

/** One page of records (page is 1-based) or, with `all`, up to the export cap. */
export async function drill(basis: DrillBasis, f: AnalyticsFilters, opts: { page?: number; all?: boolean; today?: string } = {}): Promise<DrillResult> {
  const take = opts.all ? EXPORT_CAP : PAGE_SIZE;
  const skip = opts.all ? 0 : (Math.max(1, opts.page ?? 1) - 1) * PAGE_SIZE;
  const kind = DRILL_BASES[basis].kind;
  const today = opts.today ?? todayKTM();
  if (kind === "orders") {
    const where = orderBasisWhere(basis, f);
    const [rows, agg] = await Promise.all([
      db.order.findMany({ where, select: orderSelect, orderBy: [{ deliveryDate: "desc" }, { number: "asc" }], skip, take }),
      db.order.aggregate({ where, _sum: { total: true, tax: true, refundedAmount: true, subtotal: true, deliveryFee: true }, _count: true }),
    ]);
    const s = agg._sum;
    const sum = orderValue(basis, { total: s.total ?? 0, tax: s.tax ?? 0, refundedAmount: s.refundedAmount ?? 0, subtotal: s.subtotal ?? 0, deliveryFee: s.deliveryFee ?? 0 });
    return { kind, rows, count: agg._count, sum };
  }
  if (kind === "plans") {
    const where = planWhere(basis, f, today);
    const [rows, agg] = await Promise.all([
      db.subscription.findMany({ where, select: planSelect, orderBy: { createdAt: "desc" }, skip, take }),
      db.subscription.aggregate({ where, _sum: { total: true }, _count: true }),
    ]);
    return { kind, rows, count: agg._count, sum: agg._sum.total ?? 0 };
  }
  if (kind === "payments") {
    const where = paymentWhere(basis, f);
    const [rows, agg] = await Promise.all([
      db.payment.findMany({ where, select: paymentSelect, orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }], skip, take }),
      db.payment.aggregate({ where, _sum: { amount: true }, _count: true }),
    ]);
    return { kind, rows, count: agg._count, sum: agg._sum.amount ?? 0 };
  }
  const where = refundsWhere(f);
  const [rows, agg] = await Promise.all([
    db.refund.findMany({ where, select: refundSelect, orderBy: { processedAt: "desc" }, skip, take }),
    db.refund.aggregate({ where, _sum: { amount: true }, _count: true }),
  ]);
  return { kind: "refunds", rows, count: agg._count, sum: agg._sum.amount ?? 0 };
}

type Cell = string | number | null | undefined | Date;
export type Masker = { email: (e: string | null | undefined) => string; phone: (p: string | null | undefined) => string };
const rupees = (p: number | null | undefined) => ((p ?? 0) / 100).toFixed(2);

/** CSV rows for a drill result. Contact details go through the caller's PII masker. */
export function drillCsvRows(basis: DrillBasis, r: DrillResult, mask: Masker): Cell[][] {
  if (r.kind === "orders")
    return [
      ["Order", "Delivery date", "Created", "Status", "Payment status", "Source", "Plan", "Customer", "Email", "Phone", "Kitchen", "Zone", "Company", "Method", "Subtotal", "Delivery", "Discount", "VAT", "Total", "Refunded", DRILL_BASES[basis].valueLabel],
      ...r.rows.map((o) => [
        o.number,
        isoDate(o.deliveryDate),
        o.createdAt,
        o.status,
        o.paymentStatus,
        o.source,
        o.subscription?.plan.name,
        o.user.name,
        mask.email(o.user.email),
        mask.phone(o.contactPhone),
        o.kitchen.name,
        o.zone?.name,
        o.company?.name,
        o.payment?.method,
        rupees(o.subtotal),
        rupees(o.deliveryFee),
        rupees(o.discount),
        rupees(o.tax),
        rupees(o.total),
        rupees(o.refundedAmount),
        rupees(orderValue(basis, o)),
      ]),
    ];
  if (r.kind === "plans")
    return [
      ["Reference", "Plan", "Customer", "Email", "Status", "Bought", "Start", "End", "Meals", "VAT", "Discount", "Total", "Cancel reason"],
      ...r.rows.map((s) => [s.reference, s.plan.name, s.user.name, mask.email(s.user.email), s.status, s.createdAt, isoDate(s.startDate), isoDate(s.endDate), s.mealsTotal, rupees(s.tax), rupees(s.discount), rupees(s.total), s.cancelReason]),
    ];
  if (r.kind === "payments")
    return [
      ["Reference", "Method", "Status", "Customer", "Email", "Plan", "Orders", "Paid at", "Amount", "Refunded", "Fee (estimated)", "Fee (actual)"],
      ...r.rows.map((p) => [p.reference, p.method, p.status, p.user.name, mask.email(p.user.email), p.subscription?.reference, p._count.orders, p.paidAt, rupees(p.amount), rupees(p.refundedAmount), rupees(p.gatewayFee), p.feeActual == null ? "" : rupees(p.feeActual)]),
    ];
  return [
    ["Payment", "Order", "Customer", "Email", "Method", "Status", "Reason", "Provider ref", "Processed at", "Amount"],
    ...r.rows.map((x) => [x.payment.reference, x.order?.number, x.payment.user.name, mask.email(x.payment.user.email), x.method, x.status, x.reason, x.providerRef, x.processedAt, rupees(x.amount)]),
  ];
}
