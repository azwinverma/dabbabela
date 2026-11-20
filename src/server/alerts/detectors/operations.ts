import "server-only";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate } from "@/lib/dates";
import { minutesOf, type Detector, type Finding } from "../types";

const DAY = 86_400_000;
const MOVING: ("CONFIRMED" | "PREPARING" | "PACKED" | "OUT_FOR_DELIVERY")[] = ["CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY"];

/** Delayed deliveries: today's orders not yet delivered after their slot ended (grouped per kitchen and slot). */
export const delayedDeliveries: Detector = {
  name: "delayed-deliveries",
  label: "Delayed deliveries",
  mode: "condition",
  async run({ today, time }) {
    const orders = await db.order.findMany({
      where: { deliveryDate: dateOnly(today), status: { in: MOVING }, slotId: { not: null } },
      select: { kitchenId: true, slotId: true, slot: { select: { label: true, endTime: true } }, kitchen: { select: { name: true } } },
    });
    const by = new Map<string, { kitchenId: string; kitchen: string; slot: string; endTime: string; n: number }>();
    for (const o of orders) {
      if (!o.slot || minutesOf(time) <= minutesOf(o.slot.endTime)) continue;
      const k = `${o.kitchenId}:${today}:${o.slotId}`;
      const e = by.get(k) ?? { kitchenId: o.kitchenId, kitchen: o.kitchen.name, slot: o.slot.label, endTime: o.slot.endTime, n: 0 };
      e.n++;
      by.set(k, e);
    }
    return [...by.entries()].map(([key, e]) => ({
      type: "DELIVERY_DELAYED",
      severity: minutesOf(time) - minutesOf(e.endTime) >= 30 ? "CRITICAL" : "WARNING",
      key,
      kitchenId: e.kitchenId,
      message: `${e.kitchen}: ${e.n} order${e.n === 1 ? "" : "s"} for the ${e.slot} slot not delivered yet (slot ended ${e.endTime})`,
      href: `/admin/dispatch?date=${today}`,
      data: { date: today, slot: e.slot, orders: e.n },
    }));
  },
};

/** Failed deliveries in the last 2 days (one alert per order; resolve after the customer is credited or re-delivered). */
export const failedDeliveries: Detector = {
  name: "failed-deliveries",
  label: "Failed deliveries",
  mode: "event",
  async run({ today }) {
    const orders = await db.order.findMany({
      where: { status: "FAILED_DELIVERY", deliveryDate: { gte: dateOnly(addDays(today, -2)), lte: dateOnly(today) } },
      select: { id: true, number: true, kitchenId: true, deliveryDate: true, contactName: true, deliveryEvents: { where: { type: "FAILED" }, orderBy: { createdAt: "desc" }, take: 1, select: { note: true } } },
      take: 200,
    });
    return orders.map((o) => ({
      type: "DELIVERY_FAILED",
      severity: "WARNING",
      entity: "Order",
      entityId: o.id,
      kitchenId: o.kitchenId,
      key: o.id,
      message: `Delivery failed: ${o.number} for ${o.contactName} on ${isoDate(o.deliveryDate)}${o.deliveryEvents[0]?.note ? ` — ${o.deliveryEvents[0].note}` : ""}`,
      href: `/admin/orders/${o.id}`,
      data: { number: o.number, date: isoDate(o.deliveryDate) },
    }));
  },
};

function meanSd(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1));
  return { mean, sd };
}

/**
 * Unusual refund activity: refunds requested in the last 24 hours against the previous 28 days (z-score > 3, at
 * least 3 refunds) — by count or by amount.
 */
export const refundSpike: Detector = {
  name: "refund-spike",
  label: "Unusual refund activity",
  mode: "event",
  async run({ now, today }) {
    const rows = await db.refund.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 29 * DAY), lte: now }, status: { not: "REJECTED" } }, select: { amount: true, createdAt: true } });
    const count = Array(29).fill(0) as number[];
    const amount = Array(29).fill(0) as number[];
    for (const r of rows) {
      const i = Math.floor((now.getTime() - r.createdAt.getTime()) / DAY);
      if (i < 0 || i > 28) continue;
      count[i]++;
      amount[i] += r.amount;
    }
    const c = meanSd(count.slice(1));
    const a = meanSd(amount.slice(1));
    const spike = (x: number, s: { mean: number; sd: number }) => (s.sd > 0 ? (x - s.mean) / s.sd > 3 : x > s.mean * 2);
    if (count[0] < 3 || !(spike(count[0], c) || spike(amount[0], a))) return [];
    return [
      {
        type: "REFUND_SPIKE",
        severity: "WARNING",
        key: today,
        message: `${count[0]} refunds in the last 24 hours (usual ${c.mean.toFixed(1)}/day) totalling Rs ${(amount[0] / 100).toFixed(0)}`,
        href: "/admin/refunds",
        data: { count: count[0], amount: amount[0], meanCount: Math.round(c.mean * 10) / 10, meanAmount: Math.round(a.mean) },
      } satisfies Finding,
    ];
  },
};

/**
 * Excessive wastage: a kitchen-day (yesterday or today) whose finished batches wasted ≥ 15% of cooked portions, or
 * more than twice the kitchen's 28-day rate (and 5 points above it); at least 5 portions wasted.
 */
export const wasteSpike: Detector = {
  name: "waste-spike",
  label: "Excessive wastage",
  mode: "event",
  async run({ today, kitchens }) {
    const out: Finding[] = [];
    for (const k of kitchens) {
      const base = await db.productionBatch.aggregate({ where: { kitchenId: k.id, status: "DONE", date: { gte: dateOnly(addDays(today, -29)), lt: dateOnly(addDays(today, -1)) } }, _sum: { actualPortions: true, wastePortions: true } });
      const baseRate = base._sum.actualPortions ? (base._sum.wastePortions ?? 0) / base._sum.actualPortions : 0;
      for (const date of [addDays(today, -1), today]) {
        const d = await db.productionBatch.aggregate({ where: { kitchenId: k.id, status: "DONE", date: dateOnly(date) }, _sum: { actualPortions: true, wastePortions: true } });
        const cooked = d._sum.actualPortions ?? 0;
        const waste = d._sum.wastePortions ?? 0;
        if (!cooked || waste < 5) continue;
        const rate = waste / cooked;
        if (!(rate >= 0.15 || (baseRate > 0 && rate > baseRate * 2 && rate - baseRate >= 0.05))) continue;
        out.push({
          type: "WASTE_SPIKE",
          severity: rate >= 0.25 ? "CRITICAL" : "WARNING",
          entity: "Kitchen",
          entityId: k.id,
          kitchenId: k.id,
          key: `${k.id}:${date}`,
          message: `${k.name}: ${waste} of ${cooked} portions wasted on ${date} (${Math.round(rate * 100)}%, usual ${Math.round(baseRate * 100)}%)`,
          href: `/admin/kitchen?kitchen=${k.id}&date=${date}`,
          data: { date, cooked, waste, rate: Math.round(rate * 1000) / 1000, baseRate: Math.round(baseRate * 1000) / 1000 },
        });
      }
    }
    return out;
  },
};
