import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isoDate, ktmNow } from "@/lib/dates";
import { paymentDims, stampRange } from "@/server/analytics/filters";
import { METRICS, NON_CASH_REFUNDS } from "@/server/analytics/metrics";
import * as rev from "@/server/analytics/revenue";
import { statusCounts } from "@/server/analytics/orders";
import { pageOf, totalsOf, windowOf } from "./common";
import type { ReportDef } from "./types";

const stamp = (d: Date | null | undefined) => (d ? `${ktmNow(d).date} ${ktmNow(d).time}` : null);

export const orderStatus: ReportDef = {
  key: "order-status",
  title: "Order status",
  group: "Orders",
  description: "Orders by status for delivery dates in the range — count and value.",
  definition: "Analytics → Order pipeline: every order with a delivery date in the range grouped by its current status; value = Σ order total. The status filter is ignored here (every status is a row).",
  view: [],
  exportPerms: [],
  filters: ["range", "kitchen", "company", "ctype"],
  columns: [
    { key: "label", label: "Status" },
    { key: "count", label: "Orders", kind: "int" },
    { key: "value", label: "Order value", kind: "money" },
    { key: "share", label: "Share of orders", kind: "pct" },
  ],
  async run({ f }, paging) {
    const rows = await statusCounts(f);
    const total = rows.reduce((a, r) => a + r.count, 0);
    const all = rows.map((r) => ({ status: r.status, label: r.label, count: r.count, value: r.value, share: total ? r.count / total : null }));
    return { rows: pageOf(all, paging), count: all.length, totals: { ...totalsOf(all, ["count", "value"], { label: "Total" }), share: total ? 1 : null } };
  },
};

export const cancellations: ReportDef = {
  key: "cancellations",
  title: "Cancellations",
  group: "Orders",
  description: "Orders cancelled, by delivery date, with who/why from the status history.",
  definition: "Analytics → Cancelled order value: orders with status Cancelled and delivery date in the range (single orders and plan meals); value = Σ order total. Reason = note on the cancellation status event.",
  view: [],
  exportPerms: [],
  filters: ["range", "kitchen", "company", "ctype"],
  columns: [
    { key: "number", label: "Order" },
    { key: "deliveryDate", label: "Delivery date", kind: "date" },
    { key: "cancelledAt", label: "Cancelled at" },
    { key: "source", label: "Source" },
    { key: "customer", label: "Customer" },
    { key: "email", label: "Email", kind: "email" },
    { key: "phone", label: "Phone", kind: "phone" },
    { key: "kitchen", label: "Kitchen" },
    { key: "company", label: "Company" },
    { key: "paymentStatus", label: "Payment" },
    { key: "total", label: "Order total", kind: "money" },
    { key: "reason", label: "Reason" },
  ],
  async run({ f }, paging) {
    const where = rev.cancelledWhere(f);
    const [count, sum, orders] = await Promise.all([
      db.order.count({ where }),
      rev.cancelled(f),
      db.order.findMany({
        where,
        orderBy: [{ deliveryDate: "desc" }, { number: "asc" }],
        ...windowOf(paging),
        select: {
          number: true,
          deliveryDate: true,
          cancelledAt: true,
          source: true,
          paymentStatus: true,
          total: true,
          contactPhone: true,
          user: { select: { name: true, email: true } },
          kitchen: { select: { name: true } },
          company: { select: { name: true } },
          events: { where: { toStatus: "CANCELLED" }, orderBy: { createdAt: "desc" }, take: 1, select: { note: true, actor: { select: { name: true } } } },
        },
      }),
    ]);
    const rows = orders.map((o) => ({
      number: o.number,
      deliveryDate: isoDate(o.deliveryDate),
      cancelledAt: stamp(o.cancelledAt),
      source: o.source,
      customer: o.user.name,
      email: o.user.email,
      phone: o.contactPhone,
      kitchen: o.kitchen.name,
      company: o.company?.name ?? "",
      paymentStatus: o.paymentStatus,
      total: o.total,
      reason: [o.events[0]?.note, o.events[0]?.actor?.name ? `by ${o.events[0].actor.name}` : null].filter(Boolean).join(" · "),
    }));
    return {
      rows,
      count,
      totals: { number: "Total", total: sum.value },
      summary: [
        { label: "Cancelled orders", value: sum.count, kind: "int" },
        { label: METRICS.cancelled.label, value: sum.value, kind: "money", note: METRICS.cancelled.definition },
      ],
    };
  },
};

export const refunds: ReportDef = {
  key: "refunds",
  title: "Refunds",
  group: "Orders",
  description: "Refunds processed in the range plus requests still open — method, status and order.",
  definition:
    "Rows: refunds processed in the range (by processed time, Kathmandu) and refunds requested in the range that aren't processed. Cash refunds = processed refunds paid back by gateway, bank or cash — the same figure as Analytics → Refunds paid out. Wallet-credit refunds move no cash (they stay in deferred revenue).",
  view: ["analytics.view", "refunds.view"],
  exportPerms: ["analytics.export"],
  filters: ["range", "kitchen", "company", "ctype"],
  columns: [
    { key: "requested", label: "Requested" },
    { key: "processed", label: "Processed" },
    { key: "payment", label: "Payment" },
    { key: "order", label: "Order" },
    { key: "customer", label: "Customer" },
    { key: "email", label: "Email", kind: "email" },
    { key: "method", label: "Method" },
    { key: "status", label: "Status" },
    { key: "amount", label: "Amount", kind: "money" },
    { key: "reason", label: "Reason" },
  ],
  async run({ f }, paging) {
    const st = stampRange(f.from, f.to);
    const dims = paymentDims({ ...f, method: undefined });
    const where: Prisma.RefundWhereInput = {
      AND: [{ OR: [{ status: "PROCESSED", processedAt: st }, { status: { not: "PROCESSED" }, createdAt: st }] }, { payment: dims }],
    };
    const [count, list, cashOut, byStatus] = await Promise.all([
      db.refund.count({ where }),
      db.refund.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...windowOf(paging),
        select: { createdAt: true, processedAt: true, amount: true, method: true, status: true, reason: true, payment: { select: { reference: true, user: { select: { name: true, email: true } } } }, order: { select: { number: true } } },
      }),
      rev.cash(f),
      db.refund.groupBy({ by: ["status", "method"], where, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    const processed = byStatus.filter((r) => r.status === "PROCESSED");
    const wallet = processed.filter((r) => NON_CASH_REFUNDS.includes(r.method)).reduce((a, r) => a + (r._sum.amount ?? 0), 0);
    const open = byStatus.filter((r) => r.status !== "PROCESSED" && r.status !== "REJECTED").reduce((a, r) => a + (r._sum.amount ?? 0), 0);
    const all = byStatus.reduce((a, r) => a + (r._sum.amount ?? 0), 0);
    return {
      rows: list.map((r) => ({
        requested: stamp(r.createdAt),
        processed: stamp(r.processedAt),
        payment: r.payment.reference,
        order: r.order?.number ?? "",
        customer: r.payment.user.name,
        email: r.payment.user.email,
        method: r.method,
        status: r.status,
        amount: r.amount,
        reason: r.reason,
      })),
      count,
      totals: { requested: "Total", amount: all },
      summary: [
        { label: METRICS.refundsOut.label, value: cashOut.refunds, kind: "money", note: METRICS.refundsOut.definition },
        { label: "Refunded as wallet credit", value: wallet, kind: "money", note: "Processed refunds credited to the customer's wallet (no cash moved)." },
        { label: "Open requests", value: open, kind: "money", note: "Requested or approved, not processed or rejected yet." },
      ],
    };
  },
};
