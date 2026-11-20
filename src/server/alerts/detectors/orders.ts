import "server-only";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate } from "@/lib/dates";
import type { Detector, Finding } from "../types";

const HOUR = 3600_000;

/**
 * Unpaid orders: orders still PENDING_PAYMENT more than 2 hours after they were placed, for a delivery day that
 * hasn't passed (grouped per delivery day — CRITICAL for today), and bank transfers with a proof waiting for
 * verification. Clears when they are paid, cancelled or expired.
 */
export const unpaidOrders: Detector = {
  name: "unpaid-orders",
  label: "Unpaid orders",
  mode: "condition",
  async run({ now, today }) {
    const out: Finding[] = [];
    const rows = await db.order.groupBy({
      by: ["deliveryDate"],
      where: { status: "PENDING_PAYMENT", createdAt: { lt: new Date(now.getTime() - 2 * HOUR) }, deliveryDate: { gte: dateOnly(today) } },
      _count: { _all: true },
      _sum: { total: true },
    });
    for (const r of rows) {
      const date = isoDate(r.deliveryDate);
      const n = r._count._all;
      out.push({
        type: "UNPAID_ORDERS",
        severity: date === today ? "CRITICAL" : date === addDays(today, 1) ? "WARNING" : "INFO",
        key: date,
        message: `${n} order${n === 1 ? "" : "s"} for ${date} still awaiting payment`,
        href: `/admin/orders?status=PENDING_PAYMENT&from=${date}&to=${date}`,
        data: { date, orders: n, total: r._sum.total ?? 0 },
      });
    }
    const transfers = await db.payment.count({ where: { method: "BANK_TRANSFER", status: "PENDING", proofUrl: { not: null } } });
    if (transfers)
      out.push({ type: "TRANSFER_TO_VERIFY", severity: "WARNING", key: "bank-transfers", message: `${transfers} bank transfer${transfers === 1 ? "" : "s"} with proof waiting for verification`, href: "/admin/payments?status=PENDING&method=BANK_TRANSFER", data: { payments: transfers } });
    return out;
  },
};

/**
 * Plan renewals: a renewal (Subscription.renewedFromId) still unpaid 24 hours after it was created, or whose
 * start date has arrived; CRITICAL when its payment failed or it starts within a day.
 */
export const planRenewals: Detector = {
  name: "plan-renewals",
  label: "Failed or overdue plan renewals",
  mode: "condition",
  async run({ now, today }) {
    const subs = await db.subscription.findMany({
      where: { status: "PENDING_PAYMENT", renewedFromId: { not: null }, OR: [{ createdAt: { lt: new Date(now.getTime() - 24 * HOUR) } }, { startDate: { lte: dateOnly(addDays(today, 1)) } }] },
      select: { id: true, reference: true, startDate: true, user: { select: { name: true } }, plan: { select: { name: true } }, payments: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 } },
      take: 200,
    });
    return subs.map((s) => {
      const failed = s.payments[0]?.status === "FAILED";
      const start = isoDate(s.startDate);
      const soon = start <= addDays(today, 1);
      return {
        type: failed ? "RENEWAL_FAILED" : "RENEWAL_OVERDUE",
        severity: failed || soon ? "CRITICAL" : "WARNING",
        entity: "Subscription",
        entityId: s.id,
        key: s.id,
        message: `${s.user.name}'s ${s.plan.name} renewal ${s.reference} ${failed ? "payment failed" : "is still unpaid"} (starts ${start})`,
        href: `/admin/subscriptions/${s.id}`,
        data: { reference: s.reference, startDate: start, paymentFailed: failed },
      } satisfies Finding;
    });
  },
};

/**
 * Missing meal selections: plan meals in the next 3 days that have no dabba (the rotation had nothing to pick —
 * usually the week's menu isn't published) or no item at all.
 */
export const missingSelections: Detector = {
  name: "missing-selections",
  label: "Missing meal selections",
  mode: "condition",
  async run({ today }) {
    const orders = await db.order.findMany({
      where: {
        subscriptionId: { not: null },
        status: { in: ["SCHEDULED", "CONFIRMED", "PENDING_PAYMENT"] },
        deliveryDate: { gte: dateOnly(today), lte: dateOnly(addDays(today, 3)) },
        OR: [{ items: { none: {} } }, { items: { some: { boxId: null, customBoxId: null } } }],
      },
      select: { deliveryDate: true, kitchenId: true },
    });
    const by = new Map<string, { date: string; kitchenId: string; n: number }>();
    for (const o of orders) {
      const date = isoDate(o.deliveryDate);
      const k = `${o.kitchenId}:${date}`;
      const e = by.get(k) ?? { date, kitchenId: o.kitchenId, n: 0 };
      e.n++;
      by.set(k, e);
    }
    return [...by.entries()].map(([k, e]) => ({
      type: "MISSING_SELECTION",
      severity: e.date <= addDays(today, 1) ? "CRITICAL" : "WARNING",
      key: k,
      kitchenId: e.kitchenId,
      message: `${e.n} plan meal${e.n === 1 ? "" : "s"} on ${e.date} have no dabba selected — publish the menu or pick a dabba`,
      href: `/admin/weekly-menus`,
      data: { date: e.date, orders: e.n },
    }));
  },
};
