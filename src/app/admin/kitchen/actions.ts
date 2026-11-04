"use server";

import type { BatchStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { dateOnly, isValidISODate } from "@/lib/dates";
import { lockDay, setOrderStatus } from "@/server/orders";
import { advanceBatch, markTicketsPrinted, planBatches, recordPacking, requirements, forecast, suggestQty } from "@/server/kitchen";
import { createPurchaseOrder } from "@/server/inventory";
import { assertKitchen, guard, kitchenWhere } from "@/components/admin/ops/scope";

function kd(fd: FormData) {
  const kitchenId = String(fd.get("kitchenId") ?? "");
  const date = String(fd.get("date") ?? "");
  if (!kitchenId || !isValidISODate(date)) throw new Error("Pick a kitchen and date");
  return { kitchenId, date };
}

export async function lockDayAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("kitchen.approve");
    const { kitchenId, date } = kd(fd);
    assertKitchen(user, kitchenId);
    const r = await lockDay(kitchenId, date, user.id);
    await audit({ actorId: user.id, action: "kitchen.lock_day", entity: "DayLock", entityId: `${kitchenId}:${date}`, summary: `Locked ${date}: ${r.confirmed} orders confirmed`, after: r });
    revalidatePath("/admin/kitchen");
    return done(r.alreadyLocked ? `Already locked — ${r.confirmed} late orders confirmed` : `Day locked. ${r.confirmed} orders confirmed for the kitchen.`);
  });
}

export async function planBatchesAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("kitchen.edit");
    const { kitchenId, date } = kd(fd);
    assertKitchen(user, kitchenId);
    const buffer = Math.max(0, Math.min(30, parseInt(String(fd.get("buffer") ?? "5"), 10) || 0));
    const r = await planBatches(kitchenId, date, buffer);
    revalidatePath("/admin/kitchen");
    return done(`Batches planned: ${r.created} new, ${r.updated} refreshed (${buffer}% buffer)`);
  });
}

export async function advanceBatchAction(batchId: string, to: BatchStatus, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("kitchen.edit");
    const b = await db.productionBatch.findUniqueOrThrow({ where: { id: batchId } });
    assertKitchen(user, b.kitchenId);
    const num = (k: string) => {
      const v = String(fd.get(k) ?? "").trim();
      return v === "" ? undefined : Math.max(0, parseInt(v, 10) || 0);
    };
    await advanceBatch(batchId, to, user.id, { actualPortions: num("actual"), wastePortions: num("waste"), assignedTo: String(fd.get("assignedTo") ?? "").trim() || undefined });
    revalidatePath("/admin/kitchen");
    return done(to === "DONE" ? "Batch done — ingredient usage posted to stock" : `Batch ${to.toLowerCase()}`);
  });
}

export async function startOrdersAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("kitchen.edit");
    const ids = fd.getAll("ids").map(String);
    const orders = await db.order.findMany({ where: { id: { in: ids }, ...kitchenWhere(user) }, select: { id: true } });
    const r = await setOrderStatus(orders.map((o) => o.id), "PREPARING", user.id, "Kitchen started");
    revalidatePath("/admin/kitchen");
    return r.changed.length ? done(`${r.changed.length} in the kitchen`) : fail(r.rejected[0]?.reason ?? "Nothing to start");
  });
}

export async function packingAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("kitchen.edit");
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    assertKitchen(user, o.kitchenId);
    const on = (k: string) => fd.get(k) === "on";
    const r = await recordPacking(orderId, user.id, { itemsOk: on("itemsOk"), labelOk: on("labelOk"), allergenOk: on("allergenOk"), sealedOk: on("sealedOk"), note: String(fd.get("note") ?? "") });
    revalidatePath("/admin/kitchen");
    return r.packed ? done(`${o.number} packed`) : fail(`Check failed for ${o.number} — fix and check again`);
  });
}

export async function qcAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("kitchen.edit");
    const { kitchenId, date } = kd(fd);
    assertKitchen(user, kitchenId);
    const type = String(fd.get("type"));
    const result = String(fd.get("result"));
    if (!["TEMPERATURE", "TASTE", "HYGIENE", "PACKAGING", "OTHER"].includes(type) || !["PASS", "FAIL"].includes(result)) return fail("Pick a check type and result");
    const note = String(fd.get("note") ?? "").trim();
    if (result === "FAIL" && !note) return fail("Describe the failure and what was done");
    await db.qcLog.create({ data: { kitchenId, date: dateOnly(date), type, result, value: String(fd.get("value") ?? "").trim() || null, note: note || null, batchId: String(fd.get("batchId") ?? "") || null, actorId: user.id } });
    revalidatePath("/admin/kitchen/qc");
    return done("QC check logged");
  });
}

export async function markPrintedAction(orderIds: string[]): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("kitchen.edit");
    const ok = await db.order.findMany({ where: { id: { in: orderIds }, ...kitchenWhere(user) }, select: { id: true } });
    await markTicketsPrinted(ok.map((o) => o.id));
    return done(`${ok.length} marked printed`);
  });
}

/** One DRAFT purchase order per supplier for today's shortages (inventory team reviews and sends). */
export async function draftPurchasesAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const { kitchenId, date } = kd(fd);
    assertKitchen(user, kitchenId);
    const buffer = Math.max(0, parseInt(String(fd.get("buffer") ?? "5"), 10) || 0);
    const f = await forecast(kitchenId, date, buffer);
    const req = await requirements(kitchenId, f.dishes.map((d) => ({ menuItemId: d.menuItemId, name: d.name, total: d.total })));
    const bySupplier = new Map<string, { ingredientId: string; quantity: number; unitCost: number }[]>();
    let noSupplier = 0;
    for (const r of req.rows.filter((x) => x.short > 0)) {
      if (!r.supplierId) {
        noSupplier++;
        continue;
      }
      const list = bySupplier.get(r.supplierId) ?? [];
      list.push({ ingredientId: r.ingredientId, quantity: suggestQty(r.short, r.reorderQty), unitCost: r.costPerUnit });
      bySupplier.set(r.supplierId, list);
    }
    if (!bySupplier.size) return fail(noSupplier ? `${noSupplier} short ingredient(s) have no supplier set` : "No shortages for this day");
    for (const [supplierId, lines] of bySupplier) await createPurchaseOrder({ supplierId, kitchenId, lines, expectedOn: date, notes: `Shortages for ${date}`, actorId: user.id });
    await audit({ actorId: user.id, action: "inventory.draft_pos", entity: "PurchaseOrder", summary: `${bySupplier.size} draft PO(s) for ${date}` });
    revalidatePath("/admin/inventory/purchases");
    return done(`${bySupplier.size} draft purchase order(s) created${noSupplier ? ` · ${noSupplier} item(s) without supplier` : ""}`, "/admin/inventory/purchases");
  });
}
