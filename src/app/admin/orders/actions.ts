"use server";

import type { OrderStatus, RefundMethod } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { parseRupees, rs } from "@/lib/money";
import { adjustOrder, cancelOrder, setOrderStatus, type Settlement } from "@/server/orders";
import { requestRefund } from "@/server/payments";
import { TRANSITIONS } from "@/server/transitions";
import { assertKitchen, guard, reasonOf, kitchenWhere } from "@/components/admin/ops/scope";

const STATUSES = Object.keys(TRANSITIONS) as OrderStatus[];

async function loadOrder(id: string, user: { kitchenId: string | null }) {
  const o = await db.order.findUniqueOrThrow({ where: { id } });
  assertKitchen(user, o.kitchenId);
  return o;
}

export async function changeStatusAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.edit");
    const to = String(fd.get("status")) as OrderStatus;
    if (!STATUSES.includes(to) || to === "CANCELLED") return fail("Pick a status (use Cancel for cancellations)");
    const o = await loadOrder(orderId, user);
    const note = String(fd.get("note") ?? "").trim() || null;
    if (to === "FAILED_DELIVERY" && !note) return fail("Say why the delivery failed");
    const r = await setOrderStatus([orderId], to, user.id, note ?? "Changed by staff");
    if (!r.changed.length) return fail(r.rejected[0]?.reason ?? "Nothing changed");
    await audit({ actorId: user.id, action: "order.status", entity: "Order", entityId: orderId, summary: `${o.number}: ${o.status} → ${to}`, reason: note, before: { status: o.status }, after: { status: to } });
    revalidatePath(`/admin/orders/${orderId}`);
    return done(`Moved to ${to.replace(/_/g, " ").toLowerCase()}`);
  });
}

export async function cancelAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.edit");
    const o = await loadOrder(orderId, user);
    const reason = reasonOf(fd);
    const settlement = (["CREDIT", "REFUND", "NONE"].includes(String(fd.get("settlement"))) ? String(fd.get("settlement")) : "CREDIT") as Settlement;
    const r = await cancelOrder(orderId, { id: user.id, isStaff: true }, { reason, settlement });
    await audit({ actorId: user.id, action: "order.cancel", entity: "Order", entityId: orderId, summary: `${o.number} cancelled (${r.settlement}${r.amount ? ` ${rs(r.amount)}` : ""})`, reason, before: { status: o.status }, after: { status: "CANCELLED", settlement: r.settlement, amount: r.amount } });
    revalidatePath(`/admin/orders/${orderId}`);
    return done(r.settlement === "NONE" ? "Cancelled" : r.settlement === "CREDIT" ? `Cancelled — ${rs(r.amount)} credited` : `Cancelled — refund of ${rs(r.amount)} requested`);
  });
}

export async function adjustAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.edit");
    const o = await loadOrder(orderId, user);
    const reason = reasonOf(fd);
    const amount = parseRupees(String(fd.get("amount") ?? ""));
    if (!amount) return fail("Enter an amount, e.g. -50 for a Rs 50 credit or 30 for an extra charge");
    await adjustOrder(orderId, user.id, amount, reason);
    await audit({ actorId: user.id, action: "order.adjust", entity: "Order", entityId: orderId, summary: `${o.number}: adjustment ${rs(amount)}`, reason, after: { amount } });
    revalidatePath(`/admin/orders/${orderId}`);
    return done(amount < 0 ? `${rs(-amount)} credited to the customer's wallet` : `Charge of ${rs(amount)} recorded`);
  });
}

export async function refundAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("refunds.create");
    const o = await loadOrder(orderId, user);
    if (!o.paymentId) return fail("This order has no payment");
    const reason = reasonOf(fd);
    const amount = parseRupees(String(fd.get("amount") ?? ""));
    if (!amount || amount <= 0) return fail("Enter the refund amount");
    const method = (["ORIGINAL", "BANK", "CASH", "WALLET_CREDIT"].includes(String(fd.get("method"))) ? String(fd.get("method")) : "WALLET_CREDIT") as RefundMethod;
    await requestRefund({ paymentId: o.paymentId, orderId, amount, reason, method, actorId: user.id });
    revalidatePath(`/admin/orders/${orderId}`);
    return done(`Refund of ${rs(amount)} requested — finance approves and processes it`);
  });
}

export async function bulkStatusAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.bulk");
    const ids = fd.getAll("ids").map(String).filter(Boolean).slice(0, 500);
    const to = String(fd.get("status")) as OrderStatus;
    if (!ids.length) return fail("Tick the orders first");
    if (!STATUSES.includes(to) || to === "CANCELLED") return fail("Pick a status (cancel orders one by one, with a settlement)");
    const reason = reasonOf(fd);
    const scoped = user.kitchenIds ? (await db.order.findMany({ where: { id: { in: ids }, ...kitchenWhere(user) }, select: { id: true } })).map((o) => o.id) : ids;
    const r = await setOrderStatus(scoped, to, user.id, `Bulk: ${reason}`);
    await audit({ actorId: user.id, action: "order.bulk_status", entity: "Order", summary: `${r.changed.length} → ${to}, ${r.rejected.length} rejected`, reason, after: { to, changed: r.changed, rejected: r.rejected } });
    revalidatePath("/admin/orders");
    const skipped = ids.length - scoped.length;
    const rej = r.rejected.slice(0, 6).map((x) => x.reason).join("; ");
    const msg = `${r.changed.length} updated${r.rejected.length ? ` · ${r.rejected.length} not changed: ${rej}${r.rejected.length > 6 ? " …" : ""}` : ""}${skipped ? ` · ${skipped} outside your kitchen` : ""}`;
    return r.changed.length ? done(msg) : fail(msg);
  });
}
