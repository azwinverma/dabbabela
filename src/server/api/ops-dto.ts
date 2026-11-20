import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { isValidISODate } from "@/lib/dates";
import { piiFor } from "@/components/admin/ops/scope";
import { riderActor, RiderAccessError } from "@/server/rider";
import { forbidden, notFound } from "./http";
import { assertKitchenScope, type ApiUser } from "./auth";

/** Shared helpers for the rider / kitchen / dispatcher endpoints of /api/v1. */

export const isoDateStr = z.string().refine(isValidISODate, "Use YYYY-MM-DD");
export const idList = z.array(z.string().min(1).max(64)).min(1, "Pick at least one order").max(200);

/** riderActor with API errors: no dispatch.edit → 403; order/route in another kitchen → 404. */
export async function apiRiderActor(user: ApiUser, ref: { orderId?: string; routeId?: string }) {
  if (user.role === "DELIVERY_AGENT") {
    // Riders: another rider's stop/route is 404 here (the service would also refuse it, with a 422).
    const riderId = ref.orderId
      ? (await db.deliveryAssignment.findUnique({ where: { orderId: ref.orderId }, select: { route: { select: { riderId: true } } } }))?.route.riderId
      : (await db.deliveryRoute.findUnique({ where: { id: ref.routeId! }, select: { riderId: true } }))?.riderId;
    if (riderId !== user.id) throw notFound("Not on your routes");
  }
  try {
    return await riderActor(user, ref);
  } catch (e) {
    if (e instanceof RiderAccessError) throw e.reason === "forbidden" ? forbidden(e.message) : notFound("Not found in your kitchens");
    throw e;
  }
}

/** Order in the user's kitchen scope, else 404. */
export async function scopedOrder(user: ApiUser, orderId: string) {
  const o = await db.order.findUnique({ where: { id: orderId }, select: { id: true, number: true, kitchenId: true, status: true } });
  if (!o) throw notFound("Order not found");
  assertKitchenScope(user, o.kitchenId);
  return o;
}

/** Route in the user's kitchen scope, else 404. */
export async function scopedRoute(user: ApiUser, routeId: string) {
  const r = await db.deliveryRoute.findUnique({ where: { id: routeId } });
  if (!r) throw notFound("Route not found");
  assertKitchenScope(user, r.kitchenId);
  return r;
}

/** Phone/email for staff views: full only with customers.pii (same as the admin pages). */
export const piiOf = (user: ApiUser) => piiFor(user);

/** Cash the rider must collect at a stop (paisa): unpaid CASH orders only. */
export function cashDue(o: { customerShare: number; paymentStatus: string; payment?: { method: string } | null }) {
  return o.payment?.method === "CASH" && o.paymentStatus !== "PAID" ? o.customerShare : 0;
}
