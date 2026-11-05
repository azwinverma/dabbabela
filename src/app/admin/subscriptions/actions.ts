"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { rs } from "@/lib/money";
import { cancelSubscription, pauseSubscription, resumeSubscription, skipMeal, swapMeal, unskipMeal } from "@/server/subscriptions";
import { guard, reasonOf } from "@/components/admin/ops/scope";

export async function staffSkipAction(subId: string, orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("subscriptions.edit");
    const reason = reasonOf(fd);
    const r = await skipMeal(orderId, { id: user.id, isStaff: true }, null);
    await audit({ actorId: user.id, action: "plan.skip", entity: "Subscription", entityId: subId, summary: `Meal ${orderId} skipped (${r.policy})`, reason, after: r });
    revalidatePath(`/admin/subscriptions/${subId}`);
    return done(r.policy === "CREDIT" ? `Skipped — ${rs(r.credited)} credited` : `Skipped — moved to ${r.moved.join(", ") || "end of plan"}`);
  });
}

export async function staffUnskipAction(subId: string, orderId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("subscriptions.edit");
    await unskipMeal(orderId, { id: user.id, isStaff: true }, null);
    await audit({ actorId: user.id, action: "plan.unskip", entity: "Subscription", entityId: subId, summary: `Meal ${orderId} restored` });
    revalidatePath(`/admin/subscriptions/${subId}`);
    return done("Skip undone");
  });
}

export async function pauseAction(subId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("subscriptions.edit");
    const reason = reasonOf(fd);
    const from = String(fd.get("from") ?? "") || undefined;
    const n = await pauseSubscription(subId, { id: user.id, isStaff: true }, { from, reason });
    await audit({ actorId: user.id, action: "plan.pause", entity: "Subscription", entityId: subId, summary: `${n} meals held`, reason });
    revalidatePath(`/admin/subscriptions/${subId}`);
    return done(`Paused — ${n} meals on hold`);
  });
}

export async function resumeAction(subId: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("subscriptions.edit");
    const n = await resumeSubscription(subId, { id: user.id, isStaff: true });
    await audit({ actorId: user.id, action: "plan.resume", entity: "Subscription", entityId: subId, summary: `${n} meals re-added` });
    revalidatePath(`/admin/subscriptions/${subId}`);
    return done(`Resumed — ${n} meals scheduled`);
  });
}

export async function cancelPlanAction(subId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("subscriptions.edit");
    const reason = reasonOf(fd);
    const settlement = fd.get("settlement") === "REFUND" ? "REFUND" : "CREDIT";
    const sub = await db.subscription.findUniqueOrThrow({ where: { id: subId } });
    const r = await cancelSubscription(subId, { id: user.id, isStaff: true }, { reason, settlement });
    await audit({ actorId: user.id, action: "plan.cancel", entity: "Subscription", entityId: subId, summary: `${sub.reference}: ${r.cancelled} meals, ${rs(r.credit)} ${settlement}`, reason, before: { status: sub.status }, after: r });
    revalidatePath(`/admin/subscriptions/${subId}`);
    return done(`Cancelled ${r.cancelled} meals${r.credit ? ` — ${rs(r.credit)} ${settlement === "CREDIT" ? "credited" : "sent for refund"}` : ""}`);
  });
}

/** Staff swap of one plan meal (customer asked by phone). Same pricing/settlement as the customer swap; audited. */
export async function staffSwapAction(subId: string, orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("subscriptions.edit");
    const reason = reasonOf(fd);
    const boxId = String(fd.get("boxId") ?? "");
    const order = await db.order.findFirst({ where: { id: orderId, subscriptionId: subId }, include: { items: { select: { name: true, boxId: true } } } });
    if (!order) return fail("Meal not found");
    const r = await swapMeal(orderId, boxId, { id: user.id, isStaff: true }, null, { reason });
    if (r.changed) {
      await audit({ actorId: user.id, action: "plan.swap", entity: "Subscription", entityId: subId, summary: `Meal ${order.number} swapped (${r.delta ? rs(r.delta) : "same price"}, ${r.settlement})`, reason, before: { boxId: order.items[0]?.boxId, name: order.items[0]?.name }, after: { boxId, ...r } });
    }
    revalidatePath(`/admin/subscriptions/${subId}`);
    return done(r.changed ? `Swapped${r.delta ? ` — ${r.delta > 0 ? "+" : "−"}${rs(Math.abs(r.delta))} (${r.settlement.toLowerCase().replace("_", " ")})` : ""}` : "Already that dabba");
  });
}
