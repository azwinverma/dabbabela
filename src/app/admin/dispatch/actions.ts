"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { parseRupees, rs } from "@/lib/money";
import { isValidISODate } from "@/lib/dates";
import { acknowledgeChange, assignOrders, autoGroupRoutes, completeRoute, createRoute, moveStop, recordHandIn, resolveFailed, routeCash, setRouteCost, setRouteRider, startRoute, unassignOrder, unlockHandoffCode } from "@/server/dispatch";
import { assertKitchen, guard, reasonOf } from "@/components/admin/ops/scope";

async function route(id: string, user: { kitchenId: string | null }) {
  const r = await db.deliveryRoute.findUniqueOrThrow({ where: { id } });
  assertKitchen(user, r.kitchenId);
  return r;
}

export async function createRouteAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    const kitchenId = String(fd.get("kitchenId"));
    const date = String(fd.get("date"));
    assertKitchen(user, kitchenId);
    if (!isValidISODate(date)) return fail("Bad date");
    const r = await createRoute({ kitchenId, date, name: String(fd.get("name") ?? ""), slotId: String(fd.get("slotId") ?? "") || null, zoneId: String(fd.get("zoneId") ?? "") || null, riderId: String(fd.get("riderId") ?? "") || null });
    const ids = fd.getAll("ids").map(String);
    if (ids.length) await assignOrders(r.id, ids);
    revalidatePath("/admin/dispatch");
    return done(`Route “${r.name}” created${ids.length ? ` with ${ids.length} stops` : ""}`);
  });
}

export async function assignAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    const ids = fd.getAll("ids").map(String);
    if (!ids.length) return fail("Tick some orders first");
    if (!String(fd.get("routeId") ?? "")) return createRouteAction(_p, fd);
    const r = await route(String(fd.get("routeId")), user);
    const n = await assignOrders(r.id, ids);
    await audit({ actorId: user.id, action: "dispatch.assign", entity: "DeliveryRoute", entityId: r.id, summary: `${r.name}: ${n} stop(s) added`, after: { orderIds: ids } });
    revalidatePath("/admin/dispatch");
    return done(`${n} stop(s) added to ${r.name}`);
  });
}

export async function unassignAction(orderId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    assertKitchen(user, o.kitchenId);
    const a = await db.deliveryAssignment.findUnique({ where: { orderId }, select: { routeId: true } });
    await unassignOrder(orderId);
    await audit({ actorId: user.id, action: "dispatch.unassign", entity: "Order", entityId: orderId, summary: `${o.number} removed from route`, before: a });
    revalidatePath("/admin/dispatch");
    return done("Removed from route");
  });
}

export async function moveAction(routeId: string, orderId: string, dir: -1 | 1): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    await route(routeId, user);
    await moveStop(routeId, orderId, dir);
    revalidatePath("/admin/dispatch");
    return done();
  });
}

export async function riderAction(routeId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    const r = await route(routeId, user);
    const riderId = String(fd.get("riderId") ?? "") || null;
    if (riderId === r.riderId) return done("No change");
    await setRouteRider(routeId, riderId);
    await audit({ actorId: user.id, action: "dispatch.reassign_rider", entity: "DeliveryRoute", entityId: routeId, summary: `${r.name}: rider changed`, before: { riderId: r.riderId }, after: { riderId } });
    revalidatePath("/admin/dispatch");
    return done("Rider updated");
  });
}

export async function startRouteAction(routeId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    const r0 = await route(routeId, user);
    const r = await startRoute(routeId, user.id);
    await audit({ actorId: user.id, action: "dispatch.start_route", entity: "DeliveryRoute", entityId: routeId, summary: `${r0.name}: ${r.out} out` });
    revalidatePath("/admin/dispatch");
    return done(`${r.out} order(s) out for delivery${r.notPacked ? ` · ${r.notPacked} not packed yet — they stay behind` : ""}`);
  });
}

export async function completeRouteAction(routeId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    await route(routeId, user);
    await completeRoute(routeId, { id: user.id, isStaff: true });
    revalidatePath("/admin/dispatch");
    return done("Route completed");
  });
}

export async function handInAction(routeId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    const r = await route(routeId, user);
    const amount = parseRupees(String(fd.get("amount") ?? ""));
    if (amount == null || amount < 0) return fail("Enter the cash counted");
    const before = await routeCash(routeId);
    await recordHandIn(routeId, user.id, amount);
    const variance = amount - before.collected;
    await audit({ actorId: user.id, action: "dispatch.cash_hand_in", entity: "DeliveryRoute", entityId: routeId, summary: `${r.name}: counted ${rs(amount)} vs collected ${rs(before.collected)}`, reason: variance ? String(fd.get("note") ?? "") || "Variance" : null, before, after: { handedIn: amount, variance } });
    revalidatePath("/admin/dispatch");
    return variance === 0 ? done("Cash matches") : done(`Recorded — variance ${rs(variance)}`);
  });
}

export async function resolveFailedAction(orderId: string, action: "RETRY" | "CANCEL", _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    assertKitchen(user, o.kitchenId);
    const reason = reasonOf(fd);
    await resolveFailed(orderId, user.id, action, reason);
    await audit({ actorId: user.id, action: `dispatch.failed_${action.toLowerCase()}`, entity: "Order", entityId: orderId, summary: o.number, reason });
    revalidatePath("/admin/dispatch");
    return done(action === "RETRY" ? "Sent out again" : "Cancelled and credited");
  });
}

export async function autoGroupAction(kitchenId: string, date: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    assertKitchen(user, kitchenId);
    if (!isValidISODate(date)) return fail("Bad date");
    const r = await autoGroupRoutes(kitchenId, date);
    if (!r.stops) return done("Nothing left to group — every open order is on a route");
    await audit({ actorId: user.id, action: "dispatch.auto_group", entity: "Kitchen", entityId: kitchenId, summary: `${date}: ${r.stops} stop(s) grouped, ${r.routes} new route(s)` });
    revalidatePath("/admin/dispatch");
    return done(`${r.stops} stop(s) grouped by slot and zone · ${r.routes} new route(s)`);
  });
}

export async function routeCostAction(routeId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    const r = await route(routeId, user);
    const raw = String(fd.get("cost") ?? "").trim();
    const cost = raw ? parseRupees(raw) : null;
    if (raw && (cost == null || cost < 0)) return fail("Enter the route cost in rupees");
    await setRouteCost(routeId, cost);
    await audit({ actorId: user.id, action: "dispatch.route_cost", entity: "DeliveryRoute", entityId: routeId, summary: `${r.name}: cost ${cost == null ? "cleared" : rs(cost)}`, before: { cost: r.cost }, after: { cost } });
    revalidatePath("/admin/dispatch");
    return done("Route cost saved");
  });
}

export async function acknowledgeChangeAction(orderId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    assertKitchen(user, o.kitchenId);
    await acknowledgeChange(orderId);
    await audit({ actorId: user.id, action: "dispatch.change_checked", entity: "Order", entityId: orderId, summary: `${o.number}: changed delivery checked against its route` });
    revalidatePath("/admin/dispatch");
    return done("Marked as checked");
  });
}

/** Dispatch override after 5 wrong hand-off codes (M3): resets the stop's counter; audited. */
export async function unlockHandoffAction(orderId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("dispatch.edit");
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    assertKitchen(user, o.kitchenId);
    await unlockHandoffCode(orderId, user, "Unlocked from the dispatch board after calling the customer");
    revalidatePath("/admin/dispatch");
    return done("Unlocked — the rider can enter the code again");
  });
}
