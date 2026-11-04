import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dateOnly } from "@/lib/dates";
import { LIVE_STATUSES } from "./transitions";

type Tx = Prisma.TransactionClient;

/**
 * Serialise writers for one kitchen-day. Every code path that adds meals to a day takes this lock
 * inside its transaction, so two customers can't both take the last portion.
 */
export async function lockKitchenDay(tx: Tx, kitchenId: string, date: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kday:${kitchenId}:${date}`}))`;
}

export async function lockUser(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`user:${userId}`}))`;
}

export class CapacityError extends Error {}

export async function dayCapacity(kitchenId: string, date: string, client: Tx | typeof db = db) {
  const [kitchen, override] = await Promise.all([
    client.kitchen.findUnique({ where: { id: kitchenId }, select: { dailyCapacity: true } }),
    client.kitchenCapacity.findUnique({ where: { kitchenId_date: { kitchenId, date: dateOnly(date) } } }),
  ]);
  return override?.maxMeals ?? kitchen?.dailyCapacity ?? 0;
}

export async function mealsBooked(kitchenId: string, date: string, client: Tx | typeof db = db) {
  const r = await client.orderItem.aggregate({
    _sum: { quantity: true },
    where: { order: { kitchenId, deliveryDate: dateOnly(date), status: { in: LIVE_STATUSES } } },
  });
  return r._sum.quantity ?? 0;
}

/** Portions of a set box already booked on a date. */
export async function boxBooked(boxId: string, date: string, kitchenId: string, client: Tx | typeof db = db) {
  const r = await client.orderItem.aggregate({
    _sum: { quantity: true },
    where: { boxId, order: { kitchenId, deliveryDate: dateOnly(date), status: { in: LIVE_STATUSES } } },
  });
  return r._sum.quantity ?? 0;
}

/** Portions of a dish already booked through Build-a-Dabba on a date. */
export async function dishBooked(menuItemId: string, date: string, kitchenId: string, client: Tx | typeof db = db) {
  const rows = await client.$queryRaw<{ n: bigint | null }[]>`
    SELECT SUM((c->>'qty')::int * oi.quantity) AS n
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    CROSS JOIN LATERAL jsonb_array_elements(oi.components) c
    WHERE oi."customBoxId" IS NOT NULL
      AND o."kitchenId" = ${kitchenId}
      AND o."deliveryDate" = ${dateOnly(date)}
      AND o.status::text = ANY(${LIVE_STATUSES as string[]})
      AND c->>'menuItemId' = ${menuItemId}`;
  return Number(rows[0]?.n ?? 0);
}

export async function slotBooked(slotId: string, date: string, client: Tx | typeof db = db) {
  return client.order.count({ where: { slotId, deliveryDate: dateOnly(date), status: { in: LIVE_STATUSES } } });
}

/**
 * Check a kitchen-day can take more meals. Call after lockKitchenDay inside the same transaction.
 * boxes: boxId → { qty, capacity } ; dishes: menuItemId → { qty, limit }.
 */
export async function assertDayCapacity(
  tx: Tx,
  p: {
    kitchenId: string;
    date: string;
    meals: number;
    slotId?: string | null;
    orders?: number;
    boxes?: Map<string, { qty: number; capacity: number | null; name: string }>;
    dishes?: Map<string, { qty: number; limit: number | null; name: string }>;
  },
) {
  const lock = await tx.dayLock.findUnique({ where: { kitchenId_date: { kitchenId: p.kitchenId, date: dateOnly(p.date) } } });
  if (lock) throw new CapacityError(`Orders for ${p.date} are closed — the kitchen has locked the day`);
  const [cap, booked] = await Promise.all([dayCapacity(p.kitchenId, p.date, tx), mealsBooked(p.kitchenId, p.date, tx)]);
  if (booked + p.meals > cap) throw new CapacityError(`We're fully booked on ${p.date} (${Math.max(0, cap - booked)} meals left)`);
  if (p.slotId) {
    const slot = await tx.deliverySlot.findUnique({ where: { id: p.slotId } });
    if (!slot || !slot.isActive) throw new CapacityError("That delivery window isn't available");
    const n = await slotBooked(p.slotId, p.date, tx);
    if (n + (p.orders ?? 1) > slot.capacity) throw new CapacityError(`The ${slot.label} window is full on ${p.date} — pick another time`);
  }
  for (const [boxId, b] of p.boxes ?? []) {
    if (b.capacity == null) continue;
    const n = await boxBooked(boxId, p.date, p.kitchenId, tx);
    if (n + b.qty > b.capacity) throw new CapacityError(`${b.name} is sold out on ${p.date}${b.capacity - n > 0 ? ` (only ${b.capacity - n} left)` : ""}`);
  }
  for (const [id, d] of p.dishes ?? []) {
    if (d.limit == null) continue;
    const n = await dishBooked(id, p.date, p.kitchenId, tx);
    if (n + d.qty > d.limit) throw new CapacityError(`${d.name} has run out for ${p.date}`);
  }
}
