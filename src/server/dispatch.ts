import { db } from "@/lib/db";
import { dateOnly } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { setOrderStatus, cancelOrder } from "./orders";
import { recordCashCollected } from "./payments";

export class DispatchError extends Error {}

/** Orders ready to go out (or already out) for a kitchen-day. */
const DISPATCH_STATUSES = ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"] as const;

/**
 * Manifest grouped by slot → zone → hand-off point (office/shop/college name + area), so one rider
 * can hand a whole office its dabbas at reception. Plain grouping, no route optimisation.
 */
export async function manifest(kitchenId: string, date: string, slotId?: string | null) {
  const orders = await db.order.findMany({
    where: { kitchenId, deliveryDate: dateOnly(date), status: { in: [...DISPATCH_STATUSES] }, ...(slotId ? { slotId } : {}) },
    include: { zone: { select: { id: true, name: true } }, items: { select: { quantity: true, name: true } }, assignment: { include: { route: { select: { id: true, name: true } } } }, payment: { select: { method: true } } },
    orderBy: [{ slotLabel: "asc" }, { area: "asc" }, { placeName: "asc" }, { contactName: "asc" }],
  });
  type Stop = { key: string; placeName: string | null; area: string; landmark: string | null; orders: typeof orders; meals: number; cash: number };
  const groups = new Map<string, { slot: string; zoneId: string | null; zone: string; stops: Map<string, Stop> }>();
  for (const o of orders) {
    const gk = `${o.slotLabel ?? "Any time"}|${o.zoneId ?? "none"}`;
    const g = groups.get(gk) ?? { slot: o.slotLabel ?? "Any time", zoneId: o.zoneId, zone: o.zone?.name ?? "No zone", stops: new Map() };
    const sk = `${(o.placeName ?? o.addressLine).toLowerCase().trim()}|${o.area.toLowerCase().trim()}`;
    const st = g.stops.get(sk) ?? { key: sk, placeName: o.placeName, area: o.area, landmark: o.landmark, orders: [], meals: 0, cash: 0 };
    st.orders.push(o);
    st.meals += o.items.reduce((a, i) => a + i.quantity, 0);
    if (o.payment?.method === "CASH" && o.paymentStatus !== "PAID" && !["CANCELLED", "SKIPPED"].includes(o.status)) st.cash += o.customerShare;
    g.stops.set(sk, st);
    groups.set(gk, g);
  }
  return [...groups.values()].map((g) => ({ ...g, stops: [...g.stops.values()] }));
}

export async function createRoute(input: { kitchenId: string; date: string; name: string; slotId?: string | null; zoneId?: string | null; riderId?: string | null }) {
  if (!input.name.trim()) throw new DispatchError("Name the route");
  if (input.riderId) await assertRider(input.riderId);
  return db.deliveryRoute.create({ data: { kitchenId: input.kitchenId, date: dateOnly(input.date), name: input.name.trim(), slotId: input.slotId || null, zoneId: input.zoneId || null, riderId: input.riderId || null } });
}

async function assertRider(id: string) {
  const r = await db.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
  if (!r || r.role !== "DELIVERY_AGENT" || !r.isActive) throw new DispatchError("Pick an active delivery rider");
}

export async function setRouteRider(routeId: string, riderId: string | null) {
  if (riderId) await assertRider(riderId);
  return db.deliveryRoute.update({ where: { id: routeId }, data: { riderId } });
}

/** Assign orders (in the given order) to a route; orders on other routes move. Same kitchen-day only. */
export async function assignOrders(routeId: string, orderIds: string[]) {
  const route = await db.deliveryRoute.findUniqueOrThrow({ where: { id: routeId } });
  if (route.status === "DONE") throw new DispatchError("This route is finished");
  const orders = await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, kitchenId: true, deliveryDate: true, status: true } });
  const bad = orders.find((o) => o.kitchenId !== route.kitchenId || o.deliveryDate.getTime() !== route.date.getTime());
  if (bad) throw new DispatchError("Orders must be for the same kitchen and day as the route");
  const start = await db.deliveryAssignment.count({ where: { routeId } });
  let seq = start;
  for (const id of orderIds) {
    if (!orders.find((o) => o.id === id)) continue;
    await db.deliveryAssignment.upsert({ where: { orderId: id }, create: { orderId: id, routeId, sequence: ++seq }, update: { routeId, sequence: ++seq } });
  }
  return seq - start;
}

export async function unassignOrder(orderId: string) {
  await db.deliveryAssignment.deleteMany({ where: { orderId } });
}

export async function moveStop(routeId: string, orderId: string, dir: -1 | 1) {
  const list = await db.deliveryAssignment.findMany({ where: { routeId }, orderBy: { sequence: "asc" } });
  const i = list.findIndex((a) => a.orderId === orderId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  await db.$transaction([
    db.deliveryAssignment.update({ where: { id: list[i].id }, data: { sequence: list[j].sequence } }),
    db.deliveryAssignment.update({ where: { id: list[j].id }, data: { sequence: list[i].sequence } }),
  ]);
}

/** Route leaves the kitchen: packed/prepared orders go OUT_FOR_DELIVERY (customers get their hand-off code). */
export async function startRoute(routeId: string, actorId: string) {
  const route = await db.deliveryRoute.findUniqueOrThrow({ where: { id: routeId }, include: { assignments: { include: { order: { select: { id: true, status: true } } } } } });
  if (!route.riderId) throw new DispatchError("Assign a rider first");
  if (!route.assignments.length) throw new DispatchError("No orders on this route");
  const ids = route.assignments.map((a) => a.order).filter((o) => ["PACKED", "FAILED_DELIVERY"].includes(o.status)).map((o) => o.id);
  const notPacked = route.assignments.filter((a) => ["SCHEDULED", "CONFIRMED", "PREPARING"].includes(a.order.status)).length;
  const r = await setOrderStatus(ids, "OUT_FOR_DELIVERY", actorId, `Out with ${route.name}`);
  for (const id of r.changed) await db.deliveryEvent.create({ data: { orderId: id, type: "PICKED_UP", actorId, note: route.name } });
  await db.deliveryRoute.update({ where: { id: routeId }, data: { status: "OUT", startedAt: route.startedAt ?? new Date() } });
  return { out: r.changed.length, notPacked, rejected: r.rejected };
}

async function riderOrder(orderId: string, riderId: string | null) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { assignment: { include: { route: true } }, payment: { select: { method: true } } } });
  if (riderId && o.assignment?.route.riderId !== riderId) throw new DispatchError("This stop isn't on your route");
  return o;
}

/** Normalise a typed code: keep digits only. */
export function otpMatches(expected: string | null | undefined, typed: string | null | undefined) {
  if (!expected) return true;
  const t = (typed ?? "").replace(/\D/g, "");
  return t.length === expected.length && t === expected;
}

/**
 * Rider marks a stop delivered. With the deliveryOtp flag on, the customer's 4-digit code is
 * required (wrong codes are logged and refused). Cash orders must record collection first.
 */
export async function deliverStop(orderId: string, rider: { id: string; isStaff: boolean }, input: { otp?: string; photoUrl?: string | null; note?: string; cashCollected?: number | null }) {
  const settings = await getSettings();
  const o = await riderOrder(orderId, rider.isStaff ? null : rider.id);
  if (o.status !== "OUT_FOR_DELIVERY" && o.status !== "FAILED_DELIVERY") throw new DispatchError("This order isn't out for delivery");
  if (settings.flags.deliveryOtp && !rider.isStaff) {
    const ok = otpMatches(o.deliveryOtp, input.otp);
    if (!ok) {
      await db.deliveryEvent.create({ data: { orderId, type: "NOTE", otpOk: false, actorId: rider.id, note: "Wrong hand-off code entered" } });
      throw new DispatchError("That code doesn't match — ask the customer to check the SMS / their account");
    }
  }
  if (settings.flags.deliveryPhoto && !rider.isStaff && !input.photoUrl) throw new DispatchError("Add a photo of the hand-off");
  if (o.payment?.method === "CASH" && o.paymentStatus !== "PAID") {
    if (input.cashCollected == null) throw new DispatchError(`Collect cash first`);
    await recordCashCollected(orderId, rider.id, input.cashCollected, o.assignment?.routeId ?? null);
  }
  const r = await setOrderStatus([orderId], "DELIVERED", rider.id, input.note || "Delivered");
  if (!r.changed.length) throw new DispatchError(r.rejected[0]?.reason ?? "Couldn't update the order");
  await db.deliveryEvent.create({ data: { orderId, type: "DELIVERED", otpOk: settings.flags.deliveryOtp ? !rider.isStaff || undefined : undefined, photoUrl: input.photoUrl || null, note: input.note || null, actorId: rider.id } });
}

export async function failStop(orderId: string, rider: { id: string; isStaff: boolean }, reason: string) {
  if (!reason.trim()) throw new DispatchError("Say what went wrong");
  const o = await riderOrder(orderId, rider.isStaff ? null : rider.id);
  if (o.status !== "OUT_FOR_DELIVERY") throw new DispatchError("This order isn't out for delivery");
  const r = await setOrderStatus([orderId], "FAILED_DELIVERY", rider.id, reason);
  if (!r.changed.length) throw new DispatchError(r.rejected[0]?.reason ?? "Couldn't update the order");
  await db.deliveryEvent.create({ data: { orderId, type: "FAILED", note: reason, actorId: rider.id } });
}

/** Dispatcher: send a failed delivery out again, or cancel it with wallet credit. */
export async function resolveFailed(orderId: string, actorId: string, action: "RETRY" | "CANCEL", reason: string) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (o.status !== "FAILED_DELIVERY") throw new DispatchError("Order isn't in failed delivery");
  if (action === "RETRY") {
    await setOrderStatus([orderId], "OUT_FOR_DELIVERY", actorId, `Retry: ${reason}`);
    await db.deliveryEvent.create({ data: { orderId, type: "RETRY", note: reason, actorId } });
    return;
  }
  await cancelOrder(orderId, { id: actorId, isStaff: true }, { reason, settlement: "CREDIT" });
}

export async function completeRoute(routeId: string, rider: { id: string; isStaff: boolean }) {
  const route = await db.deliveryRoute.findUniqueOrThrow({ where: { id: routeId }, include: { assignments: { include: { order: { select: { status: true } } } } } });
  if (!rider.isStaff && route.riderId !== rider.id) throw new DispatchError("Not your route");
  const open = route.assignments.filter((a) => a.order.status === "OUT_FOR_DELIVERY").length;
  if (open) throw new DispatchError(`${open} stop(s) still out — mark them delivered or failed`);
  return db.deliveryRoute.update({ where: { id: routeId }, data: { status: "DONE", completedAt: new Date() } });
}

/** Cash a route should bring back: cash recorded as collected by the rider on its stops. */
export async function routeCash(routeId: string) {
  const route = await db.deliveryRoute.findUniqueOrThrow({ where: { id: routeId }, include: { assignments: { include: { order: { include: { payment: { select: { method: true } } } } } } } });
  const expected = route.assignments
    .filter((a) => a.order.payment?.method === "CASH" && !["CANCELLED", "SKIPPED"].includes(a.order.status))
    .reduce((s, a) => s + a.order.customerShare, 0);
  return { expected, collected: route.cashCollected, handedIn: route.cashHandedIn, variance: route.cashHandedIn == null ? null : route.cashHandedIn - route.cashCollected };
}

/** Dispatcher counts the cash a rider hands in. Variance against collected is kept on the route. */
export async function recordHandIn(routeId: string, actorId: string, amount: number) {
  if (!(amount >= 0)) throw new DispatchError("Enter the amount counted");
  return db.deliveryRoute.update({ where: { id: routeId }, data: { cashHandedIn: amount, cashCheckedById: actorId } });
}
