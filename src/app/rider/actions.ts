"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { done, fail, type ActionResult } from "@/lib/action";
import { parseRupees } from "@/lib/money";
import { storeUpload } from "@/lib/upload";
import { completeRoute, deliverStop, failStop } from "@/server/dispatch";
import { assertKitchen, guard } from "@/components/admin/ops/scope";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";

const isRider = (role: string) => role === "DELIVERY_AGENT";

/**
 * Riders act only on stops of their own routes (checked in dispatch.ts). Anyone else using the rider app acts as
 * staff (no OTP/photo, any route), so they also need dispatch.edit and the order's/route's kitchen in scope.
 */
async function actor(user: CurrentUser, ref: { orderId?: string; routeId?: string }) {
  if (isRider(user.role)) return { id: user.id, isStaff: false };
  if (!can(user, "dispatch.edit")) throw new Error("Only riders and dispatch can update stops");
  const kitchenId = ref.orderId
    ? (await db.order.findUniqueOrThrow({ where: { id: ref.orderId }, select: { kitchenId: true } })).kitchenId
    : (await db.deliveryRoute.findUniqueOrThrow({ where: { id: ref.routeId! }, select: { kitchenId: true } })).kitchenId;
  assertKitchen(user, kitchenId);
  return { id: user.id, isStaff: true };
}

export async function deliverAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("rider.edit");
    const who = await actor(user, { orderId });
    const file = fd.get("photo");
    let photoUrl: string | null = null;
    if (file instanceof File && file.size > 0) photoUrl = (await storeUpload(file, { folder: "proof" })).url;
    const cashRaw = String(fd.get("cash") ?? "").trim();
    const cash = cashRaw ? parseRupees(cashRaw) : null;
    if (cashRaw && cash == null) return fail("Enter the cash amount in rupees");
    await deliverStop(orderId, who, { otp: String(fd.get("otp") ?? ""), photoUrl, note: String(fd.get("note") ?? "").trim() || undefined, cashCollected: cash });
    revalidatePath("/rider", "layout");
    return done("Delivered ✓");
  });
}

export async function failAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("rider.edit");
    await failStop(orderId, await actor(user, { orderId }), String(fd.get("reason") ?? ""), String(fd.get("detail") ?? ""));
    revalidatePath("/rider", "layout");
    return done("Marked failed — dispatch will follow up");
  });
}

export async function finishRouteAction(routeId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("rider.edit");
    await completeRoute(routeId, await actor(user, { routeId }));
    revalidatePath("/rider", "layout");
    return done("Route finished. Hand the cash to dispatch.");
  });
}
