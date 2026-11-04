"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { done, fail, type ActionResult } from "@/lib/action";
import { parseRupees } from "@/lib/money";
import { storeUpload } from "@/lib/upload";
import { completeRoute, deliverStop, failStop } from "@/server/dispatch";
import { guard } from "@/components/admin/ops/scope";

const isRider = (role: string) => role === "DELIVERY_AGENT";

export async function deliverAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("rider.edit");
    const file = fd.get("photo");
    let photoUrl: string | null = null;
    if (file instanceof File && file.size > 0) photoUrl = (await storeUpload(file, { folder: "proof" })).url;
    const cashRaw = String(fd.get("cash") ?? "").trim();
    const cash = cashRaw ? parseRupees(cashRaw) : null;
    if (cashRaw && cash == null) return fail("Enter the cash amount in rupees");
    await deliverStop(orderId, { id: user.id, isStaff: !isRider(user.role) }, { otp: String(fd.get("otp") ?? ""), photoUrl, note: String(fd.get("note") ?? "").trim() || undefined, cashCollected: cash });
    revalidatePath("/rider", "layout");
    return done("Delivered ✓");
  });
}

export async function failAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("rider.edit");
    await failStop(orderId, { id: user.id, isStaff: !isRider(user.role) }, String(fd.get("reason") ?? ""));
    revalidatePath("/rider", "layout");
    return done("Marked failed — dispatch will follow up");
  });
}

export async function finishRouteAction(routeId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("rider.edit");
    await completeRoute(routeId, { id: user.id, isStaff: !isRider(user.role) });
    revalidatePath("/rider", "layout");
    return done("Route finished. Hand the cash to dispatch.");
  });
}
