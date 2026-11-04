import type { Prisma, PurchaseStatus, StockMovementType } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dateOnly, todayKTM } from "@/lib/dates";
import { randomCode } from "@/lib/utils";

type Tx = Prisma.TransactionClient;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export class InventoryError extends Error {}

/** Quantity on hand per ingredient in a kitchen = SUM of its stock movements. */
export async function stockOnHand(kitchenId: string, ingredientIds?: string[], client: Tx | typeof db = db) {
  const rows = await client.stockMovement.groupBy({
    by: ["ingredientId"],
    where: { kitchenId, ...(ingredientIds ? { ingredientId: { in: ingredientIds } } : {}) },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.ingredientId, round3(r._sum.quantity ?? 0)]));
}

export async function stockList(kitchenId: string) {
  const [ingredients, onHand] = await Promise.all([
    db.ingredient.findMany({ where: { isActive: true }, include: { supplier: { select: { name: true } } }, orderBy: { name: "asc" } }),
    stockOnHand(kitchenId),
  ]);
  return ingredients.map((i) => {
    const qty = onHand.get(i.id) ?? 0;
    return { ...i, onHand: qty, value: Math.round(Math.max(0, qty) * i.costPerUnit), low: qty < i.safetyStock };
  });
}

const SIGN: Record<StockMovementType, 1 | -1 | 0> = { RECEIPT: 1, RETURN: -1, USAGE: -1, WASTE: -1, ADJUSTMENT: 0, TRANSFER_OUT: -1, TRANSFER_IN: 1 };

/**
 * Append a stock movement. Quantities are entered positive; the sign comes from the type
 * (ADJUSTMENT keeps the sign the user typed). Adjustments, waste and returns need a note.
 * Movements are never edited or deleted — corrections are new rows.
 */
export async function recordMovement(input: { ingredientId: string; kitchenId: string; type: StockMovementType; quantity: number; unitCost?: number | null; note?: string | null; reference?: string | null; expiresOn?: string | null; actorId: string }) {
  if (!Number.isFinite(input.quantity) || input.quantity === 0) throw new InventoryError("Enter a quantity");
  if (input.type !== "ADJUSTMENT" && input.quantity < 0) throw new InventoryError("Enter a positive quantity — the type decides the direction");
  if (["ADJUSTMENT", "WASTE", "RETURN"].includes(input.type) && !input.note?.trim()) throw new InventoryError("Give a reason for this movement");
  const sign = SIGN[input.type];
  const qty = sign === 0 ? input.quantity : sign * Math.abs(input.quantity);
  return db.stockMovement.create({
    data: {
      ingredientId: input.ingredientId,
      kitchenId: input.kitchenId,
      type: input.type,
      quantity: round3(qty),
      unitCost: input.unitCost ?? null,
      note: input.note?.trim() || null,
      reference: input.reference ?? null,
      expiresOn: input.expiresOn ? dateOnly(input.expiresOn) : null,
      actorId: input.actorId,
    },
  });
}

export async function reorderAlerts(kitchenId: string) {
  return (await stockList(kitchenId)).filter((i) => i.low);
}

/** Receipts with an expiry date within `days` (or past) whose ingredient still has stock. */
export async function expiringStock(kitchenId: string, days = 3) {
  const limit = dateOnly(addDays(todayKTM(), days));
  const rows = await db.stockMovement.findMany({
    where: { kitchenId, type: "RECEIPT", expiresOn: { not: null, lte: limit } },
    include: { ingredient: true },
    orderBy: { expiresOn: "asc" },
    take: 100,
  });
  const onHand = await stockOnHand(kitchenId, [...new Set(rows.map((r) => r.ingredientId))]);
  return rows.filter((r) => (onHand.get(r.ingredientId) ?? 0) > 0).map((r) => ({ ...r, onHand: onHand.get(r.ingredientId) ?? 0, expired: r.expiresOn! < dateOnly(todayKTM()) }));
}

// ───────────── purchase orders ─────────────

export function poNumber() {
  return `PO-${todayKTM().slice(2).replace(/-/g, "")}-${randomCode(4)}`;
}

export async function createPurchaseOrder(input: { supplierId: string; kitchenId: string; expectedOn?: string | null; notes?: string | null; lines: { ingredientId: string; quantity: number; unitCost: number }[]; actorId: string }) {
  const lines = input.lines.filter((l) => l.ingredientId && l.quantity > 0);
  if (!lines.length) throw new InventoryError("Add at least one line");
  if (lines.some((l) => l.unitCost < 0)) throw new InventoryError("Unit cost can't be negative");
  const total = Math.round(lines.reduce((a, l) => a + l.quantity * l.unitCost, 0));
  return db.purchaseOrder.create({
    data: {
      number: poNumber(),
      supplierId: input.supplierId,
      kitchenId: input.kitchenId,
      expectedOn: input.expectedOn ? dateOnly(input.expectedOn) : null,
      notes: input.notes || null,
      total,
      createdById: input.actorId,
      lines: { create: lines.map((l) => ({ ingredientId: l.ingredientId, quantity: round3(l.quantity), unitCost: Math.round(l.unitCost) })) },
    },
  });
}

const PO_NEXT: Record<PurchaseStatus, PurchaseStatus[]> = { DRAFT: ["SENT", "CANCELLED"], SENT: ["PARTIAL", "RECEIVED", "CANCELLED"], PARTIAL: ["RECEIVED", "CANCELLED"], RECEIVED: [], CANCELLED: [] };

export async function setPurchaseStatus(poId: string, to: "SENT" | "CANCELLED") {
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  if (!PO_NEXT[po.status].includes(to)) throw new InventoryError(`A ${po.status.toLowerCase()} order can't be marked ${to.toLowerCase()}`);
  return db.purchaseOrder.update({ where: { id: poId }, data: { status: to } });
}

/**
 * Receive goods against a PO. Each received quantity posts a RECEIPT movement (with unit cost and
 * optional expiry) and updates the ingredient's latest cost. Status becomes PARTIAL or RECEIVED.
 */
export async function receivePurchase(poId: string, actorId: string, received: { lineId: string; quantity: number; unitCost?: number; expiresOn?: string | null }[]) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`po:${poId}`}))`;
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    if (!["SENT", "PARTIAL", "DRAFT"].includes(po.status)) throw new InventoryError(`This order is ${po.status.toLowerCase()}`);
    let posted = 0;
    for (const r of received) {
      if (!(r.quantity > 0)) continue;
      const line = po.lines.find((l) => l.id === r.lineId);
      if (!line) throw new InventoryError("Line not found");
      const remaining = round3(line.quantity - line.receivedQty);
      if (r.quantity > remaining + 1e-9) throw new InventoryError(`Only ${remaining} left to receive on that line`);
      const unitCost = r.unitCost != null && r.unitCost >= 0 ? Math.round(r.unitCost) : line.unitCost;
      await tx.stockMovement.create({
        data: { ingredientId: line.ingredientId, kitchenId: po.kitchenId, type: "RECEIPT", quantity: round3(r.quantity), unitCost, reference: po.number, expiresOn: r.expiresOn ? dateOnly(r.expiresOn) : null, actorId, note: `Received on ${po.number}` },
      });
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: round3(line.receivedQty + r.quantity), unitCost } });
      await tx.ingredient.update({ where: { id: line.ingredientId }, data: { costPerUnit: unitCost } });
      posted++;
    }
    if (!posted) throw new InventoryError("Enter what arrived");
    const lines = await tx.purchaseOrderLine.findMany({ where: { poId } });
    const done = lines.every((l) => l.receivedQty + 1e-9 >= l.quantity);
    const total = Math.round(lines.reduce((a, l) => a + l.quantity * l.unitCost, 0));
    return tx.purchaseOrder.update({ where: { id: poId }, data: { status: done ? "RECEIVED" : "PARTIAL", total } });
  });
}

// ───────────── theoretical vs actual ─────────────

/**
 * For a date range: theoretical use = finished batches' actual portions × recipe BOM (incl. waste%);
 * actual = USAGE + WASTE movements. The gap is unexplained loss (or recipe quantities to fix).
 */
export async function usageVariance(kitchenId: string, from: string, to: string) {
  const batches = await db.productionBatch.findMany({
    where: { kitchenId, status: "DONE", date: { gte: dateOnly(from), lte: dateOnly(to) } },
    select: { menuItemId: true, actualPortions: true, recipeVersionId: true },
  });
  const versionIds = [...new Set(batches.map((b) => b.recipeVersionId).filter(Boolean) as string[])];
  const versions = await db.recipeVersion.findMany({ where: { id: { in: versionIds } }, include: { ingredients: true } });
  const vmap = new Map(versions.map((v) => [v.id, v]));
  const theo = new Map<string, number>();
  for (const b of batches) {
    const v = b.recipeVersionId ? vmap.get(b.recipeVersionId) : null;
    if (!v || !b.actualPortions) continue;
    for (const l of v.ingredients) {
      const q = ((l.quantity / Math.max(1, v.yieldPortions)) * b.actualPortions) / (1 - Math.min(90, l.wastePct) / 100);
      theo.set(l.ingredientId, (theo.get(l.ingredientId) ?? 0) + q);
    }
  }
  const end = new Date(dateOnly(addDays(to, 1)));
  const actualRows = await db.stockMovement.groupBy({
    by: ["ingredientId", "type"],
    where: { kitchenId, type: { in: ["USAGE", "WASTE"] }, createdAt: { gte: dateOnly(from), lt: end } },
    _sum: { quantity: true },
  });
  const actual = new Map<string, { usage: number; waste: number }>();
  for (const r of actualRows) {
    const a = actual.get(r.ingredientId) ?? { usage: 0, waste: 0 };
    if (r.type === "USAGE") a.usage += -(r._sum.quantity ?? 0);
    else a.waste += -(r._sum.quantity ?? 0);
    actual.set(r.ingredientId, a);
  }
  const ids = [...new Set([...theo.keys(), ...actual.keys()])];
  const ingredients = await db.ingredient.findMany({ where: { id: { in: ids } } });
  return ingredients
    .map((i) => {
      const t = round3(theo.get(i.id) ?? 0);
      const a = actual.get(i.id) ?? { usage: 0, waste: 0 };
      const act = round3(a.usage + a.waste);
      return { ingredientId: i.id, name: i.name, unit: i.unit, theoretical: t, usage: round3(a.usage), waste: round3(a.waste), actual: act, variance: round3(act - t), variancePct: t ? Math.round(((act - t) / t) * 1000) / 10 : null, varianceCost: Math.round((act - t) * i.costPerUnit) };
    })
    .sort((a, b) => Math.abs(b.varianceCost) - Math.abs(a.varianceCost));
}
