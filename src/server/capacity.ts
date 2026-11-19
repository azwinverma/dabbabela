import type { Prisma, Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { dateOnly, isValidISODate, isoDate, weekdayOf } from "@/lib/dates";
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

// ───────────── kitchen status (WP-07) ─────────────

/** OPEN takes orders; PAUSED is a temporary stop (gas outage, short staff); CLOSED is a shutdown until reopened. */
export const KITCHEN_STATUS = ["OPEN", "PAUSED", "CLOSED"] as const;
export type KitchenStatus = (typeof KITCHEN_STATUS)[number];

export type KitchenGate = { name: string; isActive: boolean; status: string; statusNote: string | null; workingDays: Weekday[] };

/**
 * Why a kitchen can't take new meals on `date`, or null. A PAUSED/CLOSED/inactive kitchen takes no new orders;
 * when working days are set, other weekdays are refused. Existing orders are never touched here.
 */
export function kitchenOrderProblem(k: KitchenGate, date: string): string | null {
  const why = k.statusNote ? ` (${k.statusNote})` : "";
  if (!k.isActive) return `${k.name} isn't taking orders`;
  if (k.status === "PAUSED") return `${k.name} has paused new orders${why}`;
  if (k.status === "CLOSED") return `${k.name} is shut down and isn't taking orders${why}`;
  if (k.workingDays.length && isValidISODate(date) && !k.workingDays.includes(weekdayOf(date))) return `${k.name} doesn't cook on ${weekdayOf(date)}`;
  return null;
}

/** Problem for a kitchen-day, or null when it can take new meals. */
export async function kitchenGate(kitchenId: string, date: string, client: Tx | typeof db = db) {
  const k = await client.kitchen.findUnique({ where: { id: kitchenId }, select: { name: true, isActive: true, status: true, statusNote: true, workingDays: true } });
  return k ? kitchenOrderProblem(k, date) : "That kitchen doesn't exist";
}

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
  // New meals need an open kitchen. Edits that add no meals (swaps, line edits on existing orders) still pass.
  if (p.meals > 0) {
    const problem = await kitchenGate(p.kitchenId, p.date, tx);
    if (problem) throw new CapacityError(problem);
  }
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

// ───────────── capacity changes (WP-07) ─────────────

export type CapacityActor = { id: string; role: string; customGrants?: readonly string[] | null; kitchenIds?: string[] | null; kitchenId?: string | null };

function actorScope(a: CapacityActor): string[] | null {
  if (a.kitchenIds !== undefined) return a.kitchenIds;
  return a.kitchenId ? [a.kitchenId] : null;
}

function requireRulesEdit(actor: CapacityActor, kitchenId: string) {
  if (!can(actor, "rules.edit")) throw new CapacityError("You don't have permission to change kitchen capacity");
  const ids = actorScope(actor);
  if (ids && !ids.includes(kitchenId)) throw new CapacityError("That kitchen isn't in your scope");
}

/**
 * Per-date meal limit for a kitchen. Orders already booked are kept even when the new limit is lower (the result
 * says how many meals are over); new orders are checked against it in assertDayCapacity.
 */
export async function setCapacityOverride(actor: CapacityActor, input: { kitchenId: string; date: string; maxMeals: number; note?: string | null }) {
  requireRulesEdit(actor, input.kitchenId);
  if (!isValidISODate(input.date)) throw new CapacityError("Pick a date");
  if (!Number.isInteger(input.maxMeals) || input.maxMeals < 0 || input.maxMeals > 100000) throw new CapacityError("Enter the meal limit for that day (0–100000)");
  const note = input.note?.trim().slice(0, 200) || null;
  const where = { kitchenId_date: { kitchenId: input.kitchenId, date: dateOnly(input.date) } };
  const before = await db.kitchenCapacity.findUnique({ where });
  const row = await db.kitchenCapacity.upsert({ where, create: { kitchenId: input.kitchenId, date: dateOnly(input.date), maxMeals: input.maxMeals, note }, update: { maxMeals: input.maxMeals, note } });
  const booked = await mealsBooked(input.kitchenId, input.date);
  await audit({
    actorId: actor.id,
    action: "capacity.set",
    entity: "Kitchen",
    entityId: input.kitchenId,
    summary: `${input.date}: ${input.maxMeals} meals${booked > input.maxMeals ? ` (${booked} already booked)` : ""}`,
    before: before ? { date: input.date, maxMeals: before.maxMeals, note: before.note } : null,
    after: { date: input.date, maxMeals: row.maxMeals, note: row.note, booked },
    reason: note,
  });
  return { row, booked, over: Math.max(0, booked - input.maxMeals) };
}

export async function clearCapacityOverride(actor: CapacityActor, id: string) {
  const row = await db.kitchenCapacity.findUnique({ where: { id } });
  if (!row) throw new CapacityError("That override is already gone");
  requireRulesEdit(actor, row.kitchenId);
  await db.kitchenCapacity.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "capacity.clear", entity: "Kitchen", entityId: row.kitchenId, summary: `${isoDate(row.date)}: back to the default`, before: { date: isoDate(row.date), maxMeals: row.maxMeals, note: row.note } });
  return row;
}

/** Change a kitchen's default daily capacity (audited before/after). */
export async function setDailyCapacity(actor: CapacityActor, kitchenId: string, dailyCapacity: number) {
  requireRulesEdit(actor, kitchenId);
  if (!Number.isInteger(dailyCapacity) || dailyCapacity < 0 || dailyCapacity > 100000) throw new CapacityError("Daily capacity must be 0–100000 meals");
  const before = await db.kitchen.findUniqueOrThrow({ where: { id: kitchenId }, select: { dailyCapacity: true } });
  if (before.dailyCapacity === dailyCapacity) return false;
  await db.kitchen.update({ where: { id: kitchenId }, data: { dailyCapacity } });
  await audit({ actorId: actor.id, action: "capacity.default", entity: "Kitchen", entityId: kitchenId, summary: `${before.dailyCapacity} → ${dailyCapacity} meals/day`, before, after: { dailyCapacity } });
  return true;
}
