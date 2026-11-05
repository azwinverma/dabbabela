"use server";

import type { StockMovementType, StockUnit } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { parseRupees } from "@/lib/money";
import { isValidISODate } from "@/lib/dates";
import {
  STOCK_UNITS,
  createPurchaseOrder,
  deleteConversion,
  moveLot,
  receivePurchase,
  recordMovement,
  returnToSupplier,
  saveConversion,
  saveLocation,
  setPurchaseStatus,
  transferStock,
} from "@/server/inventory";
import { assertKitchen, guard, reasonOf } from "@/components/admin/ops/scope";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => {
  const v = parseFloat(s(fd, k));
  return Number.isFinite(v) ? v : 0;
};
const unitOf = (v: string): StockUnit | null => (STOCK_UNITS.includes(v as StockUnit) ? (v as StockUnit) : null);

export async function saveIngredientAction(id: string | null, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const name = s(fd, "name");
    if (!name) return fail("Name is required", { name: "Required" });
    const unit = unitOf(s(fd, "unit"));
    if (!unit) return fail("Pick a unit");
    const cost = parseRupees(s(fd, "cost"));
    if (cost == null || cost < 0) return fail("Enter the cost per unit in rupees", { cost: "e.g. 95 or 12.50" });
    const purchaseUnit = unitOf(s(fd, "purchaseUnit"));
    const purchaseFactor = s(fd, "purchaseFactor") ? n(fd, "purchaseFactor") : 1;
    if (purchaseUnit && purchaseUnit !== unit && !(purchaseFactor > 0)) return fail("How many base units are in one purchase unit?", { purchaseFactor: "e.g. 25 for a 25 kg sack" });
    const data = {
      name,
      nameNe: s(fd, "nameNe") || null,
      category: s(fd, "category").slice(0, 40) || null,
      unit,
      purchaseUnit: purchaseUnit && purchaseUnit !== unit ? purchaseUnit : null,
      purchaseFactor: purchaseUnit && purchaseUnit !== unit ? purchaseFactor : 1,
      costPerUnit: cost,
      safetyStock: Math.max(0, n(fd, "safety")),
      reorderPoint: s(fd, "reorderPoint") ? Math.max(0, n(fd, "reorderPoint")) : null,
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
    const unit = unitOf(s(fd, "unit"));
    const cost = s(fd, "unitCost") ? parseRupees(s(fd, "unitCost")) : null;
    const expiresOn = s(fd, "expiresOn");
    // recordMovement audits adjustments / waste / returns / shortages itself (with on-hand before/after)
    const m = await recordMovement({ ingredientId: s(fd, "ingredientId"), kitchenId, type, quantity: qty, unit, unitCost: cost, note: s(fd, "note"), expiresOn: expiresOn && isValidISODate(expiresOn) ? expiresOn : null, locationId: s(fd, "locationId") || null, actorId: user.id });
    if (type === "RECEIPT" && cost != null && m.unitCost != null) await db.ingredient.update({ where: { id: m.ingredientId }, data: { costPerUnit: m.unitCost } });
    revalidatePath("/admin/inventory");
    return done(m.shortage > 0 ? `Recorded — ${m.shortage} more than was in stock (shortage flagged)` : "Movement recorded");
  });
}

export async function saveSupplierAction(id: string | null, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const name = s(fd, "name");
    if (!name) return fail("Name is required");
    const data = { name, contact: s(fd, "contact") || null, phone: s(fd, "phone") || null, email: s(fd, "email") || null, address: s(fd, "address") || null, panVat: s(fd, "panVat") || null, notes: s(fd, "notes") || null, isActive: id ? fd.get("isActive") !== null : true };
    const before = id ? await db.supplier.findUnique({ where: { id } }) : null;
    const row = id ? await db.supplier.update({ where: { id }, data }) : await db.supplier.create({ data });
    await audit({ actorId: user.id, action: id ? "supplier.update" : "supplier.create", entity: "Supplier", entityId: row.id, summary: row.name, before, after: data });
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
    const units = fd.getAll("line_unit").map((v) => unitOf(String(v)));
    const lines = ing.map((ingredientId, i) => ({ ingredientId, quantity: qty[i], unitCost: cost[i] ?? -1, unit: units[i] ?? null })).filter((l) => l.ingredientId && l.quantity > 0);
    if (lines.some((l) => l.unitCost < 0)) return fail("Every line needs a unit cost");
    const po = await createPurchaseOrder({ supplierId: s(fd, "supplierId"), kitchenId, expectedOn: s(fd, "expectedOn") || null, notes: s(fd, "notes") || null, lines, actorId: user.id });
    await audit({ actorId: user.id, action: "po.create", entity: "PurchaseOrder", entityId: po.id, summary: po.number, after: { lines, total: po.total } });
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
    await audit({ actorId: user.id, action: `po.${to.toLowerCase()}`, entity: "PurchaseOrder", entityId: poId, summary: po.number, reason, before: { status: po.status }, after: { status: to } });
    revalidatePath(`/admin/inventory/purchases/${poId}`);
    return done(to === "SENT" ? "Marked as sent to supplier" : "Cancelled");
  });
}

export async function receiveAction(poId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    assertKitchen(user, po.kitchenId);
    const locationId = s(fd, "locationId") || null;
    const rows = po.lines.map((l) => {
      const c = s(fd, `cost_${l.id}`);
      return { lineId: l.id, quantity: parseFloat(s(fd, `qty_${l.id}`)) || 0, unit: unitOf(s(fd, `unit_${l.id}`)), unitCost: c ? parseRupees(c) ?? undefined : undefined, expiresOn: isValidISODate(s(fd, `exp_${l.id}`)) ? s(fd, `exp_${l.id}`) : null, lotCode: s(fd, `lot_${l.id}`) || null, locationId };
    });
    const r = await receivePurchase(poId, user.id, rows);
    await audit({ actorId: user.id, action: "po.receive", entity: "PurchaseOrder", entityId: poId, summary: `${po.number} → ${r.status}`, before: { status: po.status }, after: rows.filter((x) => x.quantity > 0) });
    revalidatePath(`/admin/inventory/purchases/${poId}`);
    return done(r.status === "RECEIVED" ? "All received — stock updated" : "Partly received — stock updated");
  });
}

/** Purchase return; the service checks permission + kitchen scope and writes the audit (before/after + reason). */
export async function returnAction(poId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    const lines = po.lines.map((l) => ({ lineId: l.id, quantity: parseFloat(s(fd, `ret_${l.id}`)) || 0, unit: unitOf(s(fd, `retunit_${l.id}`)) }));
    const r = await returnToSupplier(user, { poId, reason: reasonOf(fd), lines });
    revalidatePath(`/admin/inventory/purchases/${poId}`);
    return done(`Returned ${r.lines.length} line(s) — supplier credit ${(r.credit / 100).toFixed(2)} Rs`);
  });
}

export async function transferAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const ing = fd.getAll("line_ingredient").map(String);
    const qty = fd.getAll("line_qty").map((v) => parseFloat(String(v)));
    const units = fd.getAll("line_unit").map((v) => unitOf(String(v)));
    const t = await transferStock(user, {
      fromKitchenId: s(fd, "fromKitchenId"),
      toKitchenId: s(fd, "toKitchenId"),
      lines: ing.map((ingredientId, i) => ({ ingredientId, quantity: qty[i], unit: units[i] ?? null })),
      note: s(fd, "note") || null,
      toLocationId: s(fd, "toLocationId") || null,
    });
    revalidatePath("/admin/inventory/transfers");
    return done(`Transfer ${t.number} done — both kitchens updated`);
  });
}

export async function saveLocationAction(id: string | null, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    await saveLocation(user, { id, kitchenId: s(fd, "kitchenId"), name: s(fd, "name"), isActive: id ? fd.get("isActive") !== null : true });
    revalidatePath("/admin/inventory/locations");
    return done(id ? "Location saved" : "Location added");
  });
}

export async function moveLotAction(lotId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    await moveLot(user, lotId, s(fd, "locationId") || null);
    revalidatePath("/admin/inventory/lots");
    return done("Lot moved");
  });
}

export async function saveConversionAction(ingredientId: string | null, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    const from = unitOf(s(fd, "fromUnit"));
    const to = unitOf(s(fd, "toUnit"));
    if (!from || !to) return fail("Pick both units");
    await saveConversion(user, { ingredientId, fromUnit: from, toUnit: to, factor: n(fd, "factor") });
    revalidatePath("/admin/inventory/ingredients");
    return done("Conversion saved");
  });
}

export async function deleteConversionAction(id: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("inventory.edit");
    await deleteConversion(user, id);
    revalidatePath("/admin/inventory/ingredients");
    return done("Conversion removed");
  });
}
