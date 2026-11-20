import "server-only";
import { db } from "@/lib/db";
import { can, type PermissionSubject } from "@/lib/permissions";

/** Thrown by `riderActor` — `reason` lets the mobile API answer 403 (no permission) vs 404 (kitchen out of scope). */
export class RiderAccessError extends Error {
  constructor(
    message: string,
    public reason: "forbidden" | "scope",
  ) {
    super(message);
  }
}

type RiderUser = Exclude<PermissionSubject, string | null | undefined> & { id: string; role: string; kitchenIds?: string[] | null; kitchenId?: string | null };

/**
 * Who is acting in the rider app (shared by src/app/rider/actions.ts and /api/v1/rider/*).
 * Riders (DELIVERY_AGENT) act only on stops of their own routes (checked in dispatch.ts) with the OTP/photo rules.
 * Anyone else acts as staff (no OTP/photo, any route), so they also need dispatch.edit and the order's/route's
 * kitchen in scope.
 */
export async function riderActor(user: RiderUser, ref: { orderId?: string; routeId?: string }): Promise<{ id: string; isStaff: boolean }> {
  if (user.role === "DELIVERY_AGENT") return { id: user.id, isStaff: false };
  if (!can(user, "dispatch.edit")) throw new RiderAccessError("Only riders and dispatch can update stops", "forbidden");
  const kitchenId = ref.orderId
    ? (await db.order.findUniqueOrThrow({ where: { id: ref.orderId }, select: { kitchenId: true } })).kitchenId
    : (await db.deliveryRoute.findUniqueOrThrow({ where: { id: ref.routeId! }, select: { kitchenId: true } })).kitchenId;
  const ids = user.kitchenIds !== undefined ? user.kitchenIds : user.kitchenId ? [user.kitchenId] : null;
  if (ids && !ids.includes(kitchenId)) throw new RiderAccessError("That kitchen isn't in your scope", "scope");
  return { id: user.id, isStaff: true };
}
