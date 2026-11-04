import type { BatchStatus, Diet, Prisma, StockUnit } from "@prisma/client";
import { db } from "@/lib/db";
import { dateOnly } from "@/lib/dates";
import { COOK_STATUSES } from "./transitions";
import { setOrderStatus } from "./orders";
import { stockOnHand } from "./inventory";

type Tx = Prisma.TransactionClient;

/** Orders the kitchen plans for (paid/secured + already cooking). PENDING_PAYMENT is shown separately. */
export const KITCHEN_STATUSES = [...COOK_STATUSES];

export type Component = { menuItemId: string; name: string; qty: number; diet?: Diet; station?: string | null; allergens?: string[]; recipeVersionId?: string | null };

function components(json: unknown): Component[] {
  return Array.isArray(json) ? (json as Component[]).filter((c) => c && typeof c.menuItemId === "string") : [];
}

export async function kitchenOrders(kitchenId: string, date: string, opts: { includePending?: boolean } = {}) {
  return db.order.findMany({
    where: {
      kitchenId,
      deliveryDate: dateOnly(date),
      status: { in: opts.includePending ? [...KITCHEN_STATUSES, "PENDING_PAYMENT"] : KITCHEN_STATUSES },
    },
    include: { items: { include: { customizations: true } }, ticket: true, packing: { orderBy: { createdAt: "desc" }, take: 1 }, user: { select: { name: true } } },
    orderBy: [{ slotLabel: "asc" }, { area: "asc" }, { placeName: "asc" }],
  });
}

/**
 * Demand for one kitchen-day: meals by box, portions by dish (from immutable order snapshots, so
 * Build-a-Dabba and substitutions count correctly), diet and allergen counts.
 */
export async function forecast(kitchenId: string, date: string, bufferPct = 5) {
  const orders = await kitchenOrders(kitchenId, date);
  const pending = await db.order.count({ where: { kitchenId, deliveryDate: dateOnly(date), status: "PENDING_PAYMENT" } });
  const boxes = new Map<string, { name: string; meals: number }>();
  const dishes = new Map<string, { menuItemId: string; name: string; station: string; portions: number; recipeVersionId: string | null }>();
  const diets = new Map<string, number>();
  const allergens = new Map<string, number>();
  let meals = 0;
  let flagged = 0;
  for (const o of orders) {
    if (o.allergenNote) flagged++;
    for (const it of o.items) {
      meals += it.quantity;
      const key = it.boxId ?? `custom:${it.name}`;
      const b = boxes.get(key) ?? { name: it.boxId ? it.name : `Build-a-Dabba: ${it.name}`, meals: 0 };
      b.meals += it.quantity;
      boxes.set(key, b);
      diets.set(it.diet, (diets.get(it.diet) ?? 0) + it.quantity);
      const seen = new Set<string>();
      for (const c of components(it.components)) {
        const d = dishes.get(c.menuItemId) ?? { menuItemId: c.menuItemId, name: c.name, station: c.station || "General", portions: 0, recipeVersionId: c.recipeVersionId ?? null };
        d.portions += (c.qty || 1) * it.quantity;
        dishes.set(c.menuItemId, d);
        for (const a of c.allergens ?? []) seen.add(a);
      }
      for (const a of seen) allergens.set(a, (allergens.get(a) ?? 0) + it.quantity);
    }
  }
  const dishRows = [...dishes.values()]
    .map((d) => ({ ...d, buffer: Math.ceil((d.portions * bufferPct) / 100), total: d.portions + Math.ceil((d.portions * bufferPct) / 100) }))
    .sort((a, b) => a.station.localeCompare(b.station) || b.portions - a.portions);
  return {
    orders: orders.length,
    meals,
    pendingPayment: pending,
    allergenFlagged: flagged,
    bufferPct,
    boxes: [...boxes.values()].sort((a, b) => b.meals - a.meals),
    dishes: dishRows,
    diets: [...diets.entries()].map(([diet, n]) => ({ diet: diet as Diet, meals: n })).sort((a, b) => b.meals - a.meals),
    allergens: [...allergens.entries()].map(([code, n]) => ({ code, meals: n })).sort((a, b) => b.meals - a.meals),
  };
}

/** Ingredient quantity needed for `portions` of a recipe version (waste% grosses the quantity up). */
export function bomNeed(lines: { quantity: number; wastePct: number }[], yieldPortions: number, portions: number) {
  const y = Math.max(1, yieldPortions);
  return lines.map((l) => (l.quantity / y) * portions / (1 - Math.min(90, Math.max(0, l.wastePct)) / 100));
}

/** Current recipe version for each dish (falls back to the snapshot's version if the dish has none). */
async function recipeVersions(menuItemIds: string[]) {
  const recipes = await db.recipe.findMany({
    where: { menuItemId: { in: menuItemIds } },
    include: { currentVersion: { include: { ingredients: { include: { ingredient: true } } } } },
  });
  return new Map(recipes.filter((r) => r.currentVersion).map((r) => [r.menuItemId, r.currentVersion!]));
}

export type Requirement = { ingredientId: string; name: string; unit: StockUnit; need: number; onHand: number; short: number; reorderQty: number; costPerUnit: number; supplierId: string | null; supplierName: string | null; noRecipe?: boolean };

/** Ingredient requirement for a set of dish portions vs stock on hand in this kitchen. */
export async function requirements(kitchenId: string, dishPortions: { menuItemId: string; name: string; total: number }[]) {
  const versions = await recipeVersions(dishPortions.map((d) => d.menuItemId));
  const need = new Map<string, number>();
  const ingredients = new Map<string, { name: string; unit: StockUnit; reorderQty: number; costPerUnit: number; supplierId: string | null }>();
  const missingRecipe: string[] = [];
  for (const d of dishPortions) {
    const v = versions.get(d.menuItemId);
    if (!v || !v.ingredients.length) {
      missingRecipe.push(d.name);
      continue;
    }
    const q = bomNeed(v.ingredients, v.yieldPortions, d.total);
    v.ingredients.forEach((l, i) => {
      need.set(l.ingredientId, (need.get(l.ingredientId) ?? 0) + q[i]);
      ingredients.set(l.ingredientId, { name: l.ingredient.name, unit: l.ingredient.unit, reorderQty: l.ingredient.reorderQty, costPerUnit: l.ingredient.costPerUnit, supplierId: l.ingredient.supplierId });
    });
  }
  const onHand = await stockOnHand(kitchenId, [...need.keys()]);
  const suppliers = await db.supplier.findMany({ where: { id: { in: [...ingredients.values()].map((i) => i.supplierId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const supName = new Map(suppliers.map((s) => [s.id, s.name]));
  const rows: Requirement[] = [...need.entries()].map(([id, n]) => {
    const meta = ingredients.get(id)!;
    const have = onHand.get(id) ?? 0;
    return { ingredientId: id, name: meta.name, unit: meta.unit, need: round3(n), onHand: round3(have), short: round3(Math.max(0, n - have)), reorderQty: meta.reorderQty, costPerUnit: meta.costPerUnit, supplierId: meta.supplierId, supplierName: meta.supplierId ? supName.get(meta.supplierId) ?? null : null };
  });
  rows.sort((a, b) => b.short - a.short || a.name.localeCompare(b.name));
  return { rows, missingRecipe, estimatedCost: Math.round(rows.reduce((a, r) => a + r.need * r.costPerUnit, 0)) };
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Purchase suggestion: buy the shortage, rounded up to the reorder quantity when one is set. */
export function suggestQty(short: number, reorderQty: number) {
  if (short <= 0) return 0;
  if (reorderQty > 0) return Math.ceil(short / reorderQty) * reorderQty;
  return Math.ceil(short * 10) / 10;
}

// ───────────── production batches ─────────────

/** Create/refresh PLANNED batches from the forecast. Batches already cooking/done keep their numbers. */
export async function planBatches(kitchenId: string, date: string, bufferPct: number) {
  const f = await forecast(kitchenId, date, bufferPct);
  const versions = await recipeVersions(f.dishes.map((d) => d.menuItemId));
  let created = 0,
    updated = 0;
  for (const d of f.dishes) {
    const existing = await db.productionBatch.findUnique({ where: { kitchenId_date_menuItemId: { kitchenId, date: dateOnly(date), menuItemId: d.menuItemId } } });
    if (existing && existing.status !== "PLANNED") continue;
    if (existing) {
      await db.productionBatch.update({ where: { id: existing.id }, data: { plannedPortions: d.portions, bufferPortions: d.buffer, station: d.station, recipeVersionId: versions.get(d.menuItemId)?.id ?? existing.recipeVersionId } });
      updated++;
    } else {
      await db.productionBatch.create({ data: { kitchenId, date: dateOnly(date), menuItemId: d.menuItemId, station: d.station, plannedPortions: d.portions, bufferPortions: d.buffer, recipeVersionId: versions.get(d.menuItemId)?.id ?? null } });
      created++;
    }
  }
  return { created, updated };
}

export class KitchenError extends Error {}

const BATCH_NEXT: Record<BatchStatus, BatchStatus[]> = { PLANNED: ["COOKING", "CANCELLED"], COOKING: ["DONE", "CANCELLED"], DONE: [], CANCELLED: [] };

/**
 * Move a batch along. DONE records actual + waste portions and posts USAGE (and WASTE) to the stock
 * ledger exactly once (unique idempotency keys), so a double tap or retry never double-deducts.
 */
export async function advanceBatch(batchId: string, to: BatchStatus, actorId: string, data: { actualPortions?: number; wastePortions?: number; assignedTo?: string; notes?: string } = {}) {
  const b = await db.productionBatch.findUniqueOrThrow({ where: { id: batchId }, include: { menuItem: true } });
  if (b.status !== to && !BATCH_NEXT[b.status].includes(to)) throw new KitchenError(`Batch is ${b.status.toLowerCase()} — can't move to ${to.toLowerCase()}`);
  if (to === "DONE") {
    const actual = data.actualPortions ?? b.plannedPortions + b.bufferPortions;
    const waste = data.wastePortions ?? 0;
    if (actual < 0 || waste < 0 || waste > actual) throw new KitchenError("Check the portion counts");
    await db.$transaction(async (tx) => {
      await tx.productionBatch.update({ where: { id: b.id }, data: { status: "DONE", actualPortions: actual, wastePortions: waste, completedAt: b.completedAt ?? new Date(), notes: data.notes ?? b.notes } });
      await postBatchStock(tx, b.id, actorId);
    });
    return;
  }
  await db.productionBatch.update({
    where: { id: b.id },
    data: { status: to, startedAt: to === "COOKING" ? b.startedAt ?? new Date() : b.startedAt, assignedTo: data.assignedTo ?? b.assignedTo, notes: data.notes ?? b.notes },
  });
}

/** Write ingredient usage for a finished batch. Idempotent per batch via StockMovement.idempotencyKey. */
export async function postBatchStock(tx: Tx, batchId: string, actorId: string | null) {
  const b = await tx.productionBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (b.status !== "DONE" || b.actualPortions == null) return { posted: false };
  const versionId = b.recipeVersionId ?? (await tx.recipe.findUnique({ where: { menuItemId: b.menuItemId } }))?.currentVersionId;
  if (!versionId) return { posted: false };
  const v = await tx.recipeVersion.findUniqueOrThrow({ where: { id: versionId }, include: { ingredients: { include: { ingredient: true } } } });
  const used = bomNeed(v.ingredients, v.yieldPortions, b.actualPortions - (b.wastePortions ?? 0));
  const wasted = bomNeed(v.ingredients, v.yieldPortions, b.wastePortions ?? 0);
  let posted = 0;
  for (const [i, l] of v.ingredients.entries()) {
    for (const [type, qty] of [["USAGE", used[i]], ["WASTE", wasted[i]]] as const) {
      if (qty <= 0) continue;
      const key = `batch:${b.id}:${type.toLowerCase()}:${l.ingredientId}`;
      const exists = await tx.stockMovement.findUnique({ where: { idempotencyKey: key } });
      if (exists) continue;
      await tx.stockMovement.create({
        data: { ingredientId: l.ingredientId, kitchenId: b.kitchenId, type, quantity: -round3(qty), unitCost: l.ingredient.costPerUnit, reference: `batch:${b.id}`, idempotencyKey: key, note: type === "WASTE" ? `Batch waste (${b.wastePortions} portions)` : `Batch of ${b.actualPortions} portions`, actorId },
      });
      posted++;
    }
  }
  await tx.productionBatch.update({ where: { id: b.id }, data: { stockPosted: true } });
  return { posted: posted > 0, rows: posted };
}

// ───────────── tickets, labels, packing ─────────────

export async function markTicketsPrinted(orderIds: string[]) {
  for (const id of orderIds) {
    const t = await db.kitchenTicket.findUnique({ where: { orderId: id } });
    if (t) await db.kitchenTicket.update({ where: { orderId: id }, data: { printedAt: new Date(), reprintCount: t.printedAt ? { increment: 1 } : undefined } });
    else await db.kitchenTicket.create({ data: { orderId: id, printedAt: new Date() } });
  }
}

/** Packing check; a fully passed check moves the order to PACKED (via the state machine). */
export async function recordPacking(orderId: string, actorId: string, check: { itemsOk: boolean; labelOk: boolean; allergenOk: boolean; sealedOk: boolean; note?: string }) {
  await db.packingCheck.create({ data: { orderId, checkedById: actorId, ...check, note: check.note || null } });
  const ok = check.itemsOk && check.labelOk && check.allergenOk && check.sealedOk;
  if (!ok) return { packed: false };
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
  if (o.status === "SCHEDULED" || o.status === "CONFIRMED") await setOrderStatus([orderId], "PREPARING", actorId, "Packing started");
  const r = await setOrderStatus([orderId], "PACKED", actorId, "Packing check passed");
  return { packed: r.changed.length > 0 || o.status === "PACKED", rejected: r.rejected };
}

export function allergenWarning(order: { allergenNote: string | null; items: { components: unknown }[] }) {
  const codes = new Set<string>();
  for (const it of order.items) for (const c of components(it.components)) for (const a of c.allergens ?? []) codes.add(a);
  return { contains: [...codes].sort(), customerNote: order.allergenNote };
}
