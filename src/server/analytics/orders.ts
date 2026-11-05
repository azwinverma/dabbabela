import "server-only";
import type { OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, isoDate, ktmNow } from "@/lib/dates";
import { LIVE_STATUSES } from "@/server/transitions";
import { forecast, requirements } from "@/server/kitchen";
import { dayRange, orderWhere, type AnalyticsFilters } from "./filters";

/** Order pipeline (definitions in metrics.ts). */

export async function statusCounts(f: AnalyticsFilters) {
  const rows = await db.order.groupBy({ by: ["status"], where: orderWhere({ ...f, orderStatus: undefined }, { deliveryDate: dayRange(f.from, f.to) }), _count: { _all: true }, _sum: { total: true } });
  const map = new Map(rows.map((r) => [r.status, { count: r._count._all, value: r._sum.total ?? 0 }]));
  return (Object.keys(PIPELINE_LABEL) as OrderStatus[]).map((s) => ({ status: s, label: PIPELINE_LABEL[s], ...(map.get(s) ?? { count: 0, value: 0 }) }));
}

export const PIPELINE_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  SCHEDULED: "Scheduled",
  CONFIRMED: "Confirmed (locked)",
  PREPARING: "Preparing",
  PACKED: "Packed",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  FAILED_DELIVERY: "Delivery failed",
  CANCELLED: "Cancelled",
  SKIPPED: "Skipped",
};

/** PACKED / OUT_FOR_DELIVERY past their slot end (Kathmandu), or from an earlier day. */
export function delayedWhere(f: AnalyticsFilters, now = new Date()): Prisma.OrderWhereInput {
  const { date, time } = ktmNow(now);
  const today = new Date(`${date}T00:00:00.000Z`);
  return orderWhere(
    { ...f, orderStatus: undefined },
    { status: { in: ["PACKED", "OUT_FOR_DELIVERY"] }, OR: [{ deliveryDate: { lt: today } }, { deliveryDate: today, slot: { endTime: { lt: time } } }] },
  );
}

export const delayedCount = (f: AnalyticsFilters, now = new Date()) => db.order.count({ where: delayedWhere(f, now) });

async function scopedKitchens(f: AnalyticsFilters) {
  return db.kitchen.findMany({ where: { isActive: true, ...(f.kitchenIds ? { id: { in: f.kitchenIds } } : {}) }, select: { id: true, name: true, dailyCapacity: true }, orderBy: { createdAt: "asc" } });
}

/** Kitchen-days in [start, start+days) where booked meals (live statuses) exceed capacity. Kitchen scope only. */
export async function overCapacity(f: AnalyticsFilters, start: string, days = 7) {
  const kitchens = await scopedKitchens(f);
  if (!kitchens.length) return [];
  const end = addDays(start, days - 1);
  const range = dayRange(start, end);
  const ids = kitchens.map((k) => k.id);
  const [booked, overrides] = await Promise.all([
    db.$queryRaw<{ kitchenId: string; d: Date; meals: bigint }[]>`
      SELECT o."kitchenId", o."deliveryDate" AS d, SUM(oi.quantity) AS meals
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      WHERE o."kitchenId" = ANY(${ids}) AND o."deliveryDate" BETWEEN ${range.gte} AND ${range.lte} AND o.status::text = ANY(${LIVE_STATUSES as string[]})
      GROUP BY 1, 2`,
    db.kitchenCapacity.findMany({ where: { kitchenId: { in: ids }, date: range }, select: { kitchenId: true, date: true, maxMeals: true } }),
  ]);
  const cap = new Map(overrides.map((o) => [`${o.kitchenId}|${isoDate(o.date)}`, o.maxMeals]));
  const byId = new Map(kitchens.map((k) => [k.id, k]));
  return booked
    .map((b) => {
      const date = isoDate(b.d);
      const k = byId.get(b.kitchenId)!;
      const capacity = cap.get(`${b.kitchenId}|${date}`) ?? k.dailyCapacity;
      return { kitchenId: k.id, kitchen: k.name, date, meals: Number(b.meals), capacity };
    })
    .filter((r) => r.meals > r.capacity)
    .sort((a, b) => a.date.localeCompare(b.date) || a.kitchen.localeCompare(b.kitchen));
}

/** Ingredients short for `date` per kitchen (recipe need of confirmed orders vs stock on hand). */
export async function shortIngredients(f: AnalyticsFilters, date: string) {
  const kitchens = (await scopedKitchens(f)).slice(0, 10);
  const out: { kitchenId: string; kitchen: string; short: { name: string; short: number; unit: string }[]; missingRecipe: number }[] = [];
  for (const k of kitchens) {
    const fc = await forecast(k.id, date, 0);
    if (!fc.dishes.length) continue;
    const req = await requirements(k.id, fc.dishes.map((d) => ({ menuItemId: d.menuItemId, name: d.name, total: d.total })));
    const short = req.rows.filter((r) => r.short > 0).map((r) => ({ name: r.name, short: r.short, unit: r.unit }));
    if (short.length || req.missingRecipe.length) out.push({ kitchenId: k.id, kitchen: k.name, short, missingRecipe: req.missingRecipe.length });
  }
  return out;
}
