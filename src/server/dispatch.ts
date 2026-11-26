import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, ktmNow, todayKTM } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { can, type PermissionSubject } from "@/lib/permissions";
import { setOrderStatus, cancelOrder } from "./orders";
import { recordCashCollected } from "./payments";
import { notify } from "./notify";

export class DispatchError extends Error {}
/** The stop's hand-off code is locked after too many wrong tries (API: 423 HANDOFF_LOCKED). */
export class HandoffLockedError extends DispatchError {}

/** Orders ready to go out (or already out) for a kitchen-day. */
const DISPATCH_STATUSES = ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"] as const;

/** Company drop details for orders: the company's delivery instructions and the order's office location (WP-12). */
export async function companyDropInfo(orders: { companyId: string | null; officeLocationId: string | null }[]) {
  const companyIds = [...new Set(orders.map((o) => o.companyId).filter((x): x is string => Boolean(x)))];
  const locationIds = [...new Set(orders.map((o) => o.officeLocationId).filter((x): x is string => Boolean(x)))];
  const [companies, locations] = await Promise.all([
    companyIds.length ? db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true, deliveryInstructions: true } }) : [],
    locationIds.length ? db.officeLocation.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true, receiverName: true } }) : [],
  ]);
  return { companies: new Map(companies.map((c) => [c.id, c])), locations: new Map(locations.map((l) => [l.id, l])) };
}

/**
 * Hand-off key for an order: company drops group by company + office location (else company + place), so the rider
 * hands a whole office its dabbas at once; everyone else by place name/address + area.
 */
export function dropKey(o: { companyId: string | null; officeLocationId: string | null; placeName: string | null; addressLine: string; area: string }) {
  const place = `${(o.placeName ?? o.addressLine).toLowerCase().trim()}|${o.area.toLowerCase().trim()}`;
  if (!o.companyId) return place;
  return `co:${o.companyId}|${o.officeLocationId ?? place}`;
}

/**
 * Manifest grouped by slot → zone → hand-off point (company office location, or office/shop/college name + area), so
 * one rider can hand a whole office its dabbas at reception. Company drops carry the company's delivery
 * instructions. Plain grouping, no route optimisation.
 */
export async function manifest(kitchenId: string, date: string, slotId?: string | null) {
  const orders = await db.order.findMany({
    where: { kitchenId, deliveryDate: dateOnly(date), status: { in: [...DISPATCH_STATUSES] }, ...(slotId ? { slotId } : {}) },
    include: { zone: { select: { id: true, name: true } }, items: { select: { quantity: true, name: true } }, assignment: { include: { route: { select: { id: true, name: true } } } }, payment: { select: { method: true } } },
    orderBy: [{ slotLabel: "asc" }, { area: "asc" }, { placeName: "asc" }, { contactName: "asc" }],
  });
  const info = await companyDropInfo(orders);
  type Stop = { key: string; placeName: string | null; area: string; landmark: string | null; company: string | null; office: string | null; instructions: string | null; orders: typeof orders; meals: number; cash: number };
  const groups = new Map<string, { slot: string; zoneId: string | null; zone: string; stops: Map<string, Stop> }>();
  for (const o of orders) {
    const gk = `${o.slotLabel ?? "Any time"}|${o.zoneId ?? "none"}`;
    const g = groups.get(gk) ?? { slot: o.slotLabel ?? "Any time", zoneId: o.zoneId, zone: o.zone?.name ?? "No zone", stops: new Map() };
    const sk = dropKey(o);
    const co = o.companyId ? info.companies.get(o.companyId) : undefined;
    const loc = o.officeLocationId ? info.locations.get(o.officeLocationId) : undefined;
    const st = g.stops.get(sk) ?? { key: sk, placeName: o.placeName, area: o.area, landmark: o.landmark, company: co?.name ?? null, office: loc?.name ?? null, instructions: co?.deliveryInstructions ?? null, orders: [], meals: 0, cash: 0 };
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
  if (input.riderId) await assertRider(input.riderId, input.kitchenId);
  const route = await db.deliveryRoute.create({ data: { kitchenId: input.kitchenId, date: dateOnly(input.date), name: input.name.trim(), slotId: input.slotId || null, zoneId: input.zoneId || null, riderId: input.riderId || null } });
  if (route.riderId) void notifyRouteAssigned(route.id);
  return route;
}

/** Tell a rider they were put on a route (in-app + push). Deduped per route and rider. */
async function notifyRouteAssigned(routeId: string) {
  const r = await db.deliveryRoute.findUnique({ where: { id: routeId }, select: { id: true, name: true, date: true, riderId: true, _count: { select: { assignments: true } } } });
  if (!r?.riderId) return;
  await notify("rider.route_assigned", { userId: r.riderId }, { route: r.name, date: isoDate(r.date), stops: r._count.assignments }, { link: `/rider/route/${r.id}`, dedupeKey: `route-assigned:${r.id}:${r.riderId}` });
}

/** Active DELIVERY_AGENT, available (rider profile), and working for this kitchen (or unassigned to one). */
async function assertRider(id: string, kitchenId?: string) {
  const r = await db.user.findUnique({ where: { id }, select: { role: true, isActive: true, kitchenId: true, riderProfile: { select: { isAvailable: true } } } });
  if (!r || r.role !== "DELIVERY_AGENT" || !r.isActive) throw new DispatchError("Pick an active delivery rider");
  if (r.riderProfile && !r.riderProfile.isAvailable) throw new DispatchError("This rider is marked unavailable");
  if (kitchenId && r.kitchenId && r.kitchenId !== kitchenId) throw new DispatchError("This rider works for another kitchen");
}

export async function setRouteRider(routeId: string, riderId: string | null) {
  const route = await db.deliveryRoute.findUniqueOrThrow({ where: { id: routeId } });
  if (route.status === "DONE") throw new DispatchError("This route is finished");
  if (riderId) await assertRider(riderId, route.kitchenId);
  const updated = await db.deliveryRoute.update({ where: { id: routeId }, data: { riderId } });
  if (riderId && riderId !== route.riderId) void notifyRouteAssigned(routeId);
  return updated;
}

/** Estimated route cost (rider pay + fuel), paisa. null clears it. Used by profitability. */
export async function setRouteCost(routeId: string, cost: number | null) {
  if (cost != null && (!Number.isInteger(cost) || cost < 0)) throw new DispatchError("Enter the route cost in rupees");
  return db.deliveryRoute.update({ where: { id: routeId }, data: { cost } });
}

/** Assign orders (in the given order) to a route; orders on other routes move. Same kitchen-day only. */
export async function assignOrders(routeId: string, orderIds: string[]) {
  const route = await db.deliveryRoute.findUniqueOrThrow({ where: { id: routeId } });
  if (route.status === "DONE") throw new DispatchError("This route is finished");
  const orders = await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, kitchenId: true, deliveryDate: true, status: true } });
  const bad = orders.find((o) => o.kitchenId !== route.kitchenId || o.deliveryDate.getTime() !== route.date.getTime());
  if (bad) throw new DispatchError("Orders must be for the same kitchen and day as the route");
  const last = await db.deliveryAssignment.aggregate({ where: { routeId }, _max: { sequence: true } });
  let seq = last._max.sequence ?? 0;
  let n = 0;
  for (const id of new Set(orderIds)) {
    if (!orders.find((o) => o.id === id)) continue;
    const sequence = ++seq;
    n++;
    // createdAt = "routed at": later delivery changes (slot/address) are flagged against it
    await db.deliveryAssignment.upsert({ where: { orderId: id }, create: { orderId: id, routeId, sequence }, update: { routeId, sequence, createdAt: new Date() } });
  }
  return n;
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
  if (riderId && o.assignment && isPastDay(isoDate(o.assignment.route.date))) throw new DispatchError("Past routes are read-only — call dispatch");
  return o;
}

/** Normalise a typed code: keep digits only. */
export function otpMatches(expected: string | null | undefined, typed: string | null | undefined) {
  if (!expected) return true;
  const t = (typed ?? "").replace(/\D/g, "");
  return t.length === expected.length && t === expected;
}

/** Wrong hand-off codes allowed per order before the stop locks (security review M3: 4 digits = 10,000 codes). */
export const HANDOFF_MAX_WRONG = 5;
export const HANDOFF_UNLOCK_NOTE = "Hand-off code unlocked by dispatch";
export const HANDOFF_LOCKED_MESSAGE = "Too many wrong codes — this stop is locked. Call dispatch: they can unlock it or confirm the hand-off themselves.";

/** Wrong codes entered on an order since dispatch last unlocked it (the DeliveryEvent log is the counter — no schema change). */
export async function wrongHandoffCodes(orderId: string, client: Pick<typeof db, "deliveryEvent"> = db) {
  const unlock = await client.deliveryEvent.findFirst({ where: { orderId, type: "NOTE", note: HANDOFF_UNLOCK_NOTE }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return client.deliveryEvent.count({ where: { orderId, otpOk: false, ...(unlock ? { createdAt: { gt: unlock.createdAt } } : {}) } });
}

/**
 * Check a typed hand-off code under a per-order lock: refused once HANDOFF_MAX_WRONG wrong codes were entered (until
 * dispatch unlocks), and each wrong code is logged. Per rider, tries are also rate-limited (fail closed).
 */
async function checkHandoffCode(o: { id: string; number: string; deliveryOtp: string | null }, riderId: string, typed: string | undefined) {
  const { rateLimit, LIMITS } = await import("@/lib/rate-limit");
  if (!(await rateLimit("handoff-otp:rider", riderId, LIMITS.handoffOtp.max, LIMITS.handoffOtp.windowMs, { failClosed: true }))) throw new DispatchError("Too many code attempts — wait a few minutes or call dispatch");
  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`handoff:${o.id}`}))`;
    const wrong = await wrongHandoffCodes(o.id, tx);
    if (wrong >= HANDOFF_MAX_WRONG) return "locked" as const;
    if (otpMatches(o.deliveryOtp, typed)) return "ok" as const;
    await tx.deliveryEvent.create({ data: { orderId: o.id, type: "NOTE", otpOk: false, actorId: riderId, note: "Wrong hand-off code entered" } });
    return wrong + 1 >= HANDOFF_MAX_WRONG ? ("locked_now" as const) : ("wrong" as const);
  });
  if (outcome === "ok") return;
  if (outcome === "locked_now") {
    await audit({ actorId: riderId, action: "delivery.otp_locked", entity: "Order", entityId: o.id, summary: `${o.number}: hand-off locked after ${HANDOFF_MAX_WRONG} wrong codes` });
    const { log } = await import("@/lib/logger");
    log.warn("delivery.otp_locked", { orderId: o.id, riderId });
  }
  if (outcome === "wrong") throw new DispatchError("That code doesn't match — ask the customer to check the SMS / their account");
  throw new HandoffLockedError(HANDOFF_LOCKED_MESSAGE);
}

/** Dispatch override after a lock: resets the wrong-code counter for one order (audited, reason required). */
export async function unlockHandoffCode(orderId: string, actor: { id: string }, reason: string) {
  if (reason.trim().length < 3) throw new DispatchError("Say why you're unlocking the hand-off code");
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, number: true } });
  await db.deliveryEvent.create({ data: { orderId, type: "NOTE", actorId: actor.id, note: HANDOFF_UNLOCK_NOTE } });
  await audit({ actorId: actor.id, action: "delivery.otp_unlock", entity: "Order", entityId: orderId, summary: `${o.number}: hand-off code unlocked`, reason });
}

/**
 * Rider marks a stop delivered. With the deliveryOtp flag on, the customer's 4-digit code is
 * required (wrong codes are logged and refused; 5 wrong codes lock the stop until dispatch unlocks it).
 * Cash orders must record collection first.
 */
export async function deliverStop(orderId: string, rider: { id: string; isStaff: boolean }, input: { otp?: string; photoUrl?: string | null; note?: string; cashCollected?: number | null }) {
  const settings = await getSettings();
  const o = await riderOrder(orderId, rider.isStaff ? null : rider.id);
  if (o.status !== "OUT_FOR_DELIVERY" && o.status !== "FAILED_DELIVERY") throw new DispatchError("This order isn't out for delivery");
  if (settings.flags.deliveryOtp && !rider.isStaff) await checkHandoffCode(o, rider.id, input.otp);
  if (settings.flags.deliveryPhoto && !rider.isStaff && !input.photoUrl) throw new DispatchError("Add a photo of the hand-off");
  if (o.payment?.method === "CASH" && o.paymentStatus !== "PAID") {
    if (input.cashCollected == null) throw new DispatchError(`Collect cash first`);
    await recordCashCollected(orderId, rider.id, input.cashCollected, o.assignment?.routeId ?? null);
  }
  const r = await setOrderStatus([orderId], "DELIVERED", rider.id, input.note || "Delivered");
  if (!r.changed.length) throw new DispatchError(r.rejected[0]?.reason ?? "Couldn't update the order");
  await db.deliveryEvent.create({ data: { orderId, type: "DELIVERED", otpOk: settings.flags.deliveryOtp ? !rider.isStaff || undefined : undefined, photoUrl: input.photoUrl || null, note: input.note || null, actorId: rider.id } });
  // Staff confirming a hand-off without the customer's code (e.g. after a lock) is an override — on the audit trail.
  if (settings.flags.deliveryOtp && rider.isStaff) await audit({ actorId: rider.id, action: "delivery.otp_override", entity: "Order", entityId: orderId, summary: `${o.number}: delivered without the hand-off code (staff)`, reason: input.note || null });
}

/** Reasons the rider app offers. Free text is still accepted (staff, "Other"), but a reason is always required. */
export const FAILED_REASONS = [
  "Customer not reachable",
  "Office/shop closed",
  "Wrong or incomplete address",
  "Customer refused the order",
  "Damaged in transit",
  "Ran out of time in the slot",
] as const;

export function failedReason(raw: string | null | undefined, detail?: string | null) {
  const r = (raw ?? "").trim();
  const d = (detail ?? "").trim();
  if (r === "Other" || r.startsWith("Other")) {
    if (d.length < 3) throw new DispatchError("Say what went wrong");
    return `Other: ${d}`.slice(0, 300);
  }
  if (r.length < 3) throw new DispatchError("Say what went wrong");
  return (d ? `${r} — ${d}` : r).slice(0, 300);
}

export async function failStop(orderId: string, rider: { id: string; isStaff: boolean }, reasonRaw: string, detail?: string | null) {
  const reason = failedReason(reasonRaw, detail);
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
    const ev = await db.deliveryEvent.create({ data: { orderId, type: "RETRY", note: reason, actorId } });
    // the first "on the way" message is de-duplicated per order; a retry gets its own (outbox, prefs respected)
    void notify("order.out_for_delivery", { userId: o.userId }, { number: o.number, otp: o.deliveryOtp ?? "" }, { link: `/account/orders/${orderId}`, dedupeKey: `ofd-retry:${ev.id}` });
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

// ═════════════════════════════ WP-13: grouping, change flags, riders, rider days, performance ═════════════════════════════

/** Staff/rider making a call. kitchenIds null = all kitchens. */
export type DispatchActor = { id: string; role: string; customGrants?: readonly string[] | null; kitchenIds?: string[] | null };

function needPerm(actor: DispatchActor, perm: "dispatch.view" | "dispatch.edit") {
  if (!can(actor as PermissionSubject, perm)) throw new DispatchError("You don't have permission to do that");
}

const GROUPABLE = ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED"] as const;

/**
 * Route grouping: unassigned orders of a kitchen-day go onto one route per slot × zone (in manifest
 * order: area, then hand-off point). An open PLANNED route for the same slot and zone is reused.
 */
export async function autoGroupRoutes(kitchenId: string, date: string) {
  const orders = await db.order.findMany({
    where: { kitchenId, deliveryDate: dateOnly(date), status: { in: [...GROUPABLE] }, assignment: null },
    select: { id: true, slotId: true, slotLabel: true, zoneId: true, zone: { select: { name: true } } },
    orderBy: [{ slotLabel: "asc" }, { area: "asc" }, { placeName: "asc" }, { contactName: "asc" }],
  });
  const groups = new Map<string, { slotId: string | null; zoneId: string | null; name: string; ids: string[] }>();
  for (const o of orders) {
    const k = `${o.slotId ?? ""}|${o.zoneId ?? ""}`;
    const g = groups.get(k) ?? { slotId: o.slotId, zoneId: o.zoneId, name: `${o.slotLabel ?? "Any time"} · ${o.zone?.name ?? "No zone"}`, ids: [] };
    g.ids.push(o.id);
    groups.set(k, g);
  }
  let routes = 0;
  let stops = 0;
  for (const g of groups.values()) {
    const open = await db.deliveryRoute.findFirst({ where: { kitchenId, date: dateOnly(date), status: "PLANNED", slotId: g.slotId, zoneId: g.zoneId }, orderBy: { createdAt: "asc" } });
    const route = open ?? (await createRoute({ kitchenId, date, name: g.name, slotId: g.slotId, zoneId: g.zoneId }));
    if (!open) routes++;
    stops += await assignOrders(route.id, g.ids);
  }
  return { routes, stops };
}

/**
 * Orders whose delivery changed after they were put on a route: a staff `order.reassign_delivery`
 * (slot/address change) logged after routing, or a slot/zone that no longer matches the route's.
 */
export async function routeChanges(routeIds: string[]) {
  const out = new Map<string, string[]>();
  if (!routeIds.length) return out;
  const asg = await db.deliveryAssignment.findMany({
    where: { routeId: { in: routeIds } },
    select: { orderId: true, createdAt: true, route: { select: { slotId: true, zoneId: true } }, order: { select: { slotId: true, zoneId: true, status: true } } },
  });
  const logs = await db.auditLog.findMany({ where: { action: "order.reassign_delivery", entity: "Order", entityId: { in: asg.map((a) => a.orderId) } }, select: { entityId: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  for (const a of asg) {
    if (["DELIVERED", "CANCELLED", "SKIPPED"].includes(a.order.status)) continue;
    const why: string[] = [];
    if (logs.some((l) => l.entityId === a.orderId && l.createdAt > a.createdAt)) why.push("Delivery details changed after routing");
    if (a.route.slotId && a.order.slotId !== a.route.slotId) why.push("Slot no longer matches the route");
    if (a.route.zoneId && a.order.zoneId !== a.route.zoneId) why.push("Zone no longer matches the route");
    if (why.length) out.set(a.orderId, why);
  }
  return out;
}

/** Dispatcher checked a changed stop: re-stamps "routed at" (slot/zone mismatches stay until it's moved). */
export async function acknowledgeChange(orderId: string) {
  const a = await db.deliveryAssignment.findUnique({ where: { orderId } });
  if (!a) throw new DispatchError("This order isn't on a route");
  await db.deliveryAssignment.update({ where: { orderId }, data: { createdAt: new Date() } });
}

// ───────────── riders ─────────────

const RIDER_SELECT = {
  id: true,
  name: true,
  email: true,
  phoneNumber: true,
  isActive: true,
  kitchenId: true,
  internalNote: true,
  riderProfile: true,
} as const;

/** DELIVERY_AGENT users the actor may see: their kitchens' riders plus riders not tied to a kitchen. */
export async function listRiders(actor: DispatchActor) {
  needPerm(actor, "dispatch.view");
  const ids = actor.kitchenIds ?? null;
  return db.user.findMany({ where: { role: "DELIVERY_AGENT", deletedAt: null, ...(ids ? { OR: [{ kitchenId: { in: ids } }, { kitchenId: null }] } : {}) }, select: RIDER_SELECT, orderBy: { name: "asc" } });
}

/** Riders a route of this kitchen can take (active account; kitchen matches or none). */
export async function ridersForKitchen(kitchenId: string) {
  const rows = await db.user.findMany({
    where: { role: "DELIVERY_AGENT", isActive: true, OR: [{ kitchenId }, { kitchenId: null }] },
    select: { id: true, name: true, phoneNumber: true, riderProfile: { select: { isAvailable: true, vehicle: true, phone: true, zoneIds: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, phone: r.riderProfile?.phone || r.phoneNumber, vehicle: r.riderProfile?.vehicle ?? null, zoneIds: r.riderProfile?.zoneIds ?? [], available: r.riderProfile?.isAvailable ?? true }));
}

export type RiderInput = { userId: string; vehicle?: string | null; phone?: string | null; isAvailable: boolean; zoneIds: string[]; kitchenId: string | null; notes?: string | null };

async function riderForEdit(actor: DispatchActor, userId: string) {
  needPerm(actor, "dispatch.edit");
  const user = await db.user.findUnique({ where: { id: userId }, include: { riderProfile: true } });
  if (!user || user.role !== "DELIVERY_AGENT" || user.deletedAt) throw new DispatchError("Pick a user with the delivery rider role (add one under Staff first)");
  const scope = actor.kitchenIds ?? null;
  if (scope && user.kitchenId && !scope.includes(user.kitchenId)) throw new DispatchError("That rider works for a kitchen outside your scope");
  return user;
}

/** Create or update a rider profile (links a DELIVERY_AGENT user). Audited with before/after. */
export async function saveRider(actor: DispatchActor, input: RiderInput) {
  const user = await riderForEdit(actor, input.userId);
  const scope = actor.kitchenIds ?? null;
  const kitchenId = input.kitchenId || null;
  if (scope && (!kitchenId || !scope.includes(kitchenId))) throw new DispatchError("Pick one of your kitchens for this rider");
  if (kitchenId && !(await db.kitchen.findUnique({ where: { id: kitchenId }, select: { id: true } }))) throw new DispatchError("Unknown kitchen");
  const zoneIds = [...new Set(input.zoneIds.filter(Boolean))];
  if (zoneIds.length) {
    const zones = await db.deliveryZone.findMany({ where: { id: { in: zoneIds } }, select: { id: true, kitchenId: true } });
    if (zones.length !== zoneIds.length) throw new DispatchError("Unknown zone");
    if (kitchenId && zones.some((z) => z.kitchenId !== kitchenId)) throw new DispatchError("A rider's zones must be served by the rider's kitchen");
  }
  const phone = (input.phone ?? "").trim() || null;
  if (phone && !/^\+?[0-9 -]{7,20}$/.test(phone)) throw new DispatchError("Enter a valid phone number");
  const vehicle = (input.vehicle ?? "").trim().slice(0, 60) || null;
  const notes = (input.notes ?? "").trim().slice(0, 1000) || null;
  const p = user.riderProfile;
  const before = p ? { vehicle: p.vehicle, phone: p.phone, isAvailable: p.isAvailable, zoneIds: p.zoneIds, kitchenId: user.kitchenId, notes: user.internalNote } : null;
  const after = { vehicle, phone, isAvailable: input.isAvailable, zoneIds, kitchenId, notes };
  const [profile] = await db.$transaction([
    db.riderProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, vehicle, phone, isAvailable: input.isAvailable, zoneIds }, update: { vehicle, phone, isAvailable: input.isAvailable, zoneIds } }),
    db.user.update({ where: { id: user.id }, data: { kitchenId, internalNote: notes } }),
  ]);
  await audit({ actorId: actor.id, action: p ? "rider.update" : "rider.create", entity: "RiderProfile", entityId: user.id, summary: user.name, before, after });
  return profile;
}

export async function setRiderAvailable(actor: DispatchActor, userId: string, isAvailable: boolean) {
  const user = await riderForEdit(actor, userId);
  await db.riderProfile.upsert({ where: { userId }, create: { userId, isAvailable }, update: { isAvailable } });
  await audit({ actorId: actor.id, action: "rider.availability", entity: "RiderProfile", entityId: userId, summary: `${user.name}: ${isAvailable ? "available" : "unavailable"}`, before: { isAvailable: user.riderProfile?.isAvailable ?? true }, after: { isAvailable } });
}

/** Removes the profile only — the login stays (manage accounts under Staff). Open routes keep their rider. */
export async function deleteRiderProfile(actor: DispatchActor, userId: string) {
  const user = await riderForEdit(actor, userId);
  if (!user.riderProfile) throw new DispatchError("No rider profile to remove");
  await db.riderProfile.delete({ where: { userId } });
  await audit({ actorId: actor.id, action: "rider.delete", entity: "RiderProfile", entityId: userId, summary: user.name, before: user.riderProfile });
}

// ───────────── rider app: day window ─────────────

export const RIDER_PAST_DAYS = 14;
export const RIDER_AHEAD_DAYS = 7;

export function isPastDay(date: string, today = todayKTM()) {
  return date < today;
}

/** Days the rider app can open: the last two weeks (read-only) through the coming week. */
export function riderDayWindow(today = todayKTM()) {
  return { from: addDays(today, -RIDER_PAST_DAYS), to: addDays(today, RIDER_AHEAD_DAYS), today };
}

/** ?date= for the rider app: valid and inside the window, else today. */
export function riderDate(raw: string | null | undefined, today = todayKTM()) {
  const w = riderDayWindow(today);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw >= w.from && raw <= w.to ? raw : today;
}

function riderWhere(viewer: DispatchActor) {
  if (viewer.role === "DELIVERY_AGENT") return { riderId: viewer.id };
  return viewer.kitchenIds ? { kitchenId: { in: viewer.kitchenIds } } : {};
}

/** Routes for one day: riders see only their own; staff see their kitchens'. */
export async function riderRoutes(viewer: DispatchActor, date: string) {
  const w = riderDayWindow();
  if (date < w.from || date > w.to) throw new DispatchError("Pick a day in the last two weeks or the coming week");
  return db.deliveryRoute.findMany({
    where: { date: dateOnly(date), ...riderWhere(viewer) },
    include: { slot: { select: { label: true } }, rider: { select: { name: true } }, assignments: { include: { order: { select: { status: true } } } } },
    orderBy: { createdAt: "asc" },
  });
}

/** Route counts per day in the window, for the date picker. */
export async function riderRouteDays(viewer: DispatchActor) {
  const w = riderDayWindow();
  const rows = await db.deliveryRoute.groupBy({ by: ["date"], where: { date: { gte: dateOnly(w.from), lte: dateOnly(w.to) }, ...riderWhere(viewer) }, _count: true });
  return new Map(rows.map((r) => [isoDate(r.date), r._count]));
}

/** One route if the viewer may see it (riders: own only; staff: kitchen scope), else null. */
export async function riderRoute(viewer: DispatchActor, routeId: string) {
  const r = await db.deliveryRoute.findUnique({
    where: { id: routeId },
    include: { slot: { select: { label: true } }, assignments: { orderBy: { sequence: "asc" }, include: { order: { include: { items: { select: { name: true, quantity: true } }, payment: { select: { method: true } } } } } } },
  });
  if (!r) return null;
  if (viewer.role === "DELIVERY_AGENT" ? r.riderId !== viewer.id : viewer.kitchenIds && !viewer.kitchenIds.includes(r.kitchenId)) return null;
  return { ...r, readOnly: isPastDay(isoDate(r.date)) };
}

// ───────────── performance ─────────────

export type PerfRow = {
  key: string;
  label: string;
  delivered: number;
  failed: number;
  failedRate: number | null;
  withSlot: number;
  onTime: number;
  onTimeRate: number | null;
  days: number;
  perDay: number | null;
  cash: number;
  routes: number;
  routeCost: number;
};

/** On time = DELIVERED event at or before the slot's end time (Kathmandu) on the delivery date. */
export function deliveredOnTime(at: Date, deliveryDate: Date, slotEnd: string) {
  const k = ktmNow(at);
  const day = isoDate(deliveryDate);
  return k.date < day || (k.date === day && k.time <= slotEnd);
}

/**
 * Delivery performance per rider and per zone, from DeliveryEvent records for orders whose delivery
 * date is in range. Rider = whoever recorded the event. failedRate = FAILED ÷ (DELIVERED + FAILED)
 * attempts; deliveries/day = DELIVERED ÷ days with a delivery; cash = Σ CASH_COLLECTED amounts;
 * route cost = Σ DeliveryRoute.cost of the rider's / zone's routes dated in range.
 */
export async function deliveryPerformance(input: { from: string; to: string; kitchenIds?: string[] | null }) {
  const range = { gte: dateOnly(input.from), lte: dateOnly(input.to) };
  const kw = input.kitchenIds ? { kitchenId: { in: input.kitchenIds } } : {};
  const [events, routes] = await Promise.all([
    db.deliveryEvent.findMany({
      where: { type: { in: ["DELIVERED", "FAILED", "CASH_COLLECTED"] }, order: { deliveryDate: range, ...kw } },
      select: { type: true, amount: true, actorId: true, createdAt: true, actor: { select: { name: true } }, order: { select: { deliveryDate: true, zoneId: true, zone: { select: { name: true } }, slot: { select: { endTime: true } } } } },
    }),
    db.deliveryRoute.findMany({ where: { date: range, ...kw }, select: { riderId: true, zoneId: true, cost: true, rider: { select: { name: true } }, zone: { select: { name: true } } } }),
  ]);
  type Acc = PerfRow & { dayset: Set<string> };
  const blank = (key: string, label: string): Acc => ({ key, label, delivered: 0, failed: 0, failedRate: null, withSlot: 0, onTime: 0, onTimeRate: null, days: 0, perDay: null, cash: 0, routes: 0, routeCost: 0, dayset: new Set() });
  const riders = new Map<string, Acc>();
  const zones = new Map<string, Acc>();
  const total = blank("all", "All");
  const get = (m: Map<string, Acc>, key: string, label: string) => {
    const r = m.get(key) ?? blank(key, label);
    m.set(key, r);
    return r;
  };
  for (const e of events) {
    const accs = [get(riders, e.actorId ?? "none", e.actor?.name ?? "Unknown"), get(zones, e.order.zoneId ?? "none", e.order.zone?.name ?? "No zone"), total];
    for (const a of accs) {
      if (e.type === "CASH_COLLECTED") a.cash += e.amount ?? 0;
      else if (e.type === "FAILED") a.failed++;
      else {
        a.delivered++;
        a.dayset.add(isoDate(e.order.deliveryDate));
        if (e.order.slot) {
          a.withSlot++;
          if (deliveredOnTime(e.createdAt, e.order.deliveryDate, e.order.slot.endTime)) a.onTime++;
        }
      }
    }
  }
  for (const r of routes) {
    const accs = [...(r.riderId ? [get(riders, r.riderId, r.rider?.name ?? "Unknown")] : []), get(zones, r.zoneId ?? "none", r.zone?.name ?? "No zone"), total];
    for (const a of accs) {
      a.routes++;
      a.routeCost += r.cost ?? 0;
    }
  }
  const finish = (a: Acc): PerfRow => {
    const { dayset, ...row } = a;
    const attempts = row.delivered + row.failed;
    return { ...row, days: dayset.size, perDay: dayset.size ? row.delivered / dayset.size : null, failedRate: attempts ? row.failed / attempts : null, onTimeRate: row.withSlot ? row.onTime / row.withSlot : null };
  };
  const sort = (m: Map<string, Acc>) => [...m.values()].map(finish).sort((a, b) => b.delivered - a.delivered || a.label.localeCompare(b.label));
  return { riders: sort(riders), zones: sort(zones), total: finish(total) };
}
