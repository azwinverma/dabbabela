"use server";

import type { StockMovementType, StockUnit } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { parseRupees } from "@/lib/money";
import { isValidISODate } from "@/lib/dates";
import { createPurchaseOrder, receivePurchase, recordMovement, setPurchaseStatus } from "@/server/inventory";
import { assertKitchen, guard, reasonOf } from "@/components/admin/ops/scope";

const UNITS: StockUnit[] = ["KG", "G", "L", "ML", "PC", "PACK"];
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => {
  const v = parseFloat(s(fd, k));
  return Number.isFinite(v) ? v : 0;
};

export async function saveIngredientAction(id: string | null, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const name = s(fd, "name");
    if (!name) return fail("Name is required", { name: "Required" });
    const unit = s(fd, "unit") as StockUnit;
    if (!UNITS.includes(unit)) return fail("Pick a unit");
    const cost = parseRupees(s(fd, "cost"));
    if (cost == null || cost < 0) return fail("Enter the cost per unit in rupees", { cost: "e.g. 95 or 12.50" });
    const data = {
      name,
      nameNe: s(fd, "nameNe") || null,
      unit,
      costPerUnit: cost,
      safetyStock: Math.max(0, n(fd, "safety")),
      reorderQty: Math.max(0, n(fd, "reorder")),
      shelfLifeDays: s(fd, "shelf") ? Math.max(0, parseInt(s(fd, "shelf"), 10) || 0) : null,
      supplierId: s(fd, "supplierId") || null,
      allergenCodes: fd.getAll("allergens").map(String),
      isActive: fd.get("isActive") !== null || !id,
    };
    const before = id ? await db.ingredient.findUnique({ where: { id } }) : null;
    const row = id ? await db.ingredient.update({ where: { id }, data }) : await db.ingredient.create({ data });
    await audit({ actorId: user.id, action: id ? "ingredient.update" : "ingredient.create", entity: "Ingredient", entityId: row.id, summary: row.name, before, after: data });
    revalidatePath("/admin/inventory");
    return done("Saved", id ? undefined : `/admin/inventory/ingredients/${row.id}`);
  });
}

export async function movementAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const kitchenId = s(fd, "kitchenId");
    assertKitchen(user, kitchenId);
    const type = s(fd, "type") as StockMovementType;
    if (!["RECEIPT", "USAGE", "WASTE", "ADJUSTMENT", "RETURN"].includes(type)) return fail("Pick a movement type");
    const qty = parseFloat(s(fd, "quantity"));
    const cost = s(fd, "unitCost") ? parseRupees(s(fd, "unitCost")) : null;
    const expiresOn = s(fd, "expiresOn");
    const m = await recordMovement({ ingredientId: s(fd, "ingredientId"), kitchenId, type, quantity: qty, unitCost: cost, note: s(fd, "note"), expiresOn: expiresOn && isValidISODate(expiresOn) ? expiresOn : null, actorId: user.id });
    if (type === "ADJUSTMENT" || type === "WASTE") await audit({ actorId: user.id, action: `stock.${type.toLowerCase()}`, entity: "StockMovement", entityId: m.id, summary: `${m.quantity}`, reason: m.note });
    if (type === "RECEIPT" && cost != null) await db.ingredient.update({ where: { id: m.ingredientId }, data: { costPerUnit: cost } });
    revalidatePath("/admin/inventory");
    return done("Movement recorded");
  });
}

export async function saveSupplierAction(id: string | null, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const name = s(fd, "name");
    if (!name) return fail("Name is required");
    const data = { name, contact: s(fd, "contact") || null, phone: s(fd, "phone") || null, email: s(fd, "email") || null, address: s(fd, "address") || null, panVat: s(fd, "panVat") || null, notes: s(fd, "notes") || null, isActive: id ? fd.get("isActive") !== null : true };
    const row = id ? await db.supplier.update({ where: { id }, data }) : await db.supplier.create({ data });
    await audit({ actorId: user.id, action: id ? "supplier.update" : "supplier.create", entity: "Supplier", entityId: row.id, summary: row.name });
    revalidatePath("/admin/inventory/suppliers");
    return done("Supplier saved");
  });
}

export async function createPOAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const kitchenId = s(fd, "kitchenId");
    assertKitchen(user, kitchenId);
    const ing = fd.getAll("line_ingredient").map(String);
    const qty = fd.getAll("line_qty").map((v) => parseFloat(String(v)));
    const cost = fd.getAll("line_cost").map((v) => parseRupees(String(v)));
    const lines = ing.map((ingredientId, i) => ({ ingredientId, quantity: qty[i], unitCost: cost[i] ?? -1 })).filter((l) => l.ingredientId && l.quantity > 0);
    if (lines.some((l) => l.unitCost < 0)) return fail("Every line needs a unit cost");
    const po = await createPurchaseOrder({ supplierId: s(fd, "supplierId"), kitchenId, expectedOn: s(fd, "expectedOn") || null, notes: s(fd, "notes") || null, lines, actorId: user.id });
    await audit({ actorId: user.id, action: "po.create", entity: "PurchaseOrder", entityId: po.id, summary: po.number });
    return done("Purchase order created", `/admin/inventory/purchases/${po.id}`);
  });
}

export async function poStatusAction(poId: string, to: "SENT" | "CANCELLED", _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    assertKitchen(user, po.kitchenId);
    const reason = to === "CANCELLED" ? reasonOf(fd) : null;
    await setPurchaseStatus(poId, to);
    await audit({ actorId: user.id, action: `po.${to.toLowerCase()}`, entity: "PurchaseOrder", entityId: poId, summary: po.number, reason });
    revalidatePath(`/admin/inventory/purchases/${poId}`);
    return done(to === "SENT" ? "Marked as sent to supplier" : "Cancelled");
  });
}

export async function receiveAction(poId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    assertKitchen(user, po.kitchenId);
    const rows = po.lines.map((l) => {
      const c = s(fd, `cost_${l.id}`);
      return { lineId: l.id, quantity: parseFloat(s(fd, `qty_${l.id}`)) || 0, unitCost: c ? parseRupees(c) ?? undefined : undefined, expiresOn: isValidISODate(s(fd, `exp_${l.id}`)) ? s(fd, `exp_${l.id}`) : null };
    });
    const r = await receivePurchase(poId, user.id, rows);
    await audit({ actorId: user.id, action: "po.receive", entity: "PurchaseOrder", entityId: poId, summary: `${po.number} → ${r.status}`, after: rows.filter((x) => x.quantity > 0) });
    revalidatePath(`/admin/inventory/purchases/${poId}`);
    return done(r.status === "RECEIVED" ? "All received — stock updated" : "Partly received — stock updated");
  });
}
