import type { Prisma, PurchaseStatus, Role, StockMovementType, StockUnit } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { addDays, dateOnly, isoDate, todayKTM } from "@/lib/dates";
import { randomCode } from "@/lib/utils";

/**
 * Inventory (WP-08). The stock ledger (`StockMovement`) is append-only: quantity on hand is always the SUM of
 * movements in the ingredient's base unit (`Ingredient.unit`). Lots (`StockLot`) track what is left of each
 * receipt (cost + expiry) and are consumed first-expiry-first-out. Stock that pre-dates lots (or came in through
 * a positive adjustment) is "unlotted" = on hand − Σ lot remaining, valued at the ingredient's latest cost.
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 1e-9;

export class InventoryError extends Error {}

export const STOCK_UNITS: StockUnit[] = ["KG", "G", "L", "ML", "PC", "PACK"];

// ───────────── actor, permission and kitchen scope ─────────────

/** Anyone acting on inventory: a CurrentUser fits. kitchenIds null/undefined (and no kitchenId) = all kitchens. */
export type InvActor = { id: string; role: Role | string; customGrants?: readonly string[] | null; kitchenIds?: string[] | null; kitchenId?: string | null };

function scopeOf(actor: Pick<InvActor, "kitchenIds" | "kitchenId">): string[] | null {
  if (actor.kitchenIds !== undefined) return actor.kitchenIds;
  return actor.kitchenId ? [actor.kitchenId] : null;
}

export function requireInventory(actor: InvActor, perm: "inventory.view" | "inventory.edit" | "inventory.export" = "inventory.edit") {
  if (!can(actor, perm)) throw new InventoryError("You don't have permission to do that in inventory");
}

export function requireKitchenScope(actor: Pick<InvActor, "kitchenIds" | "kitchenId">, kitchenId: string) {
  const ids = scopeOf(actor);
  if (ids && !ids.includes(kitchenId)) throw new InventoryError("That kitchen isn't in your scope");
}

/** Kitchen ids this actor may read (null = every kitchen). */
export function inventoryScope(actor: Pick<InvActor, "kitchenIds" | "kitchenId">) {
  return scopeOf(actor);
}

async function resolveKitchens(kitchenIds: string[] | null, client: Client = db) {
  if (kitchenIds) return kitchenIds;
  return (await client.kitchen.findMany({ where: { isActive: true }, select: { id: true } })).map((k) => k.id);
}

// ───────────── units ─────────────

export type ConversionEdge = { fromUnit: StockUnit; toUnit: StockUnit; factor: number };
/** Always-true conversions; DB rows (global or per ingredient) add to these. */
export const STANDARD_CONVERSIONS: ConversionEdge[] = [
  { fromUnit: "KG", toUnit: "G", factor: 1000 },
  { fromUnit: "L", toUnit: "ML", factor: 1000 },
];

/**
 * Convert a quantity between units using the given edges (each edge works both ways). Finds the shortest chain,
 * e.g. PACK → KG (25, the rice sack) → G (1000). Throws when no chain exists.
 */
export function convertQty(qty: number, from: StockUnit, to: StockUnit, edges: ConversionEdge[]): number {
  if (from === to) return qty;
  const adj = new Map<StockUnit, { to: StockUnit; f: number }[]>();
  const add = (a: StockUnit, b: StockUnit, f: number) => adj.set(a, [...(adj.get(a) ?? []), { to: b, f }]);
  for (const e of edges) {
    if (!(e.factor > 0) || e.fromUnit === e.toUnit) continue;
    add(e.fromUnit, e.toUnit, e.factor);
    add(e.toUnit, e.fromUnit, 1 / e.factor);
  }
  const seen = new Map<StockUnit, number>([[from, 1]]);
  const queue: StockUnit[] = [from];
  while (queue.length) {
    const u = queue.shift()!;
    for (const n of adj.get(u) ?? []) {
      if (seen.has(n.to)) continue;
      seen.set(n.to, seen.get(u)! * n.f);
      if (n.to === to) return qty * seen.get(n.to)!;
      queue.push(n.to);
    }
  }
  throw new InventoryError(`No conversion from ${from.toLowerCase()} to ${to.toLowerCase()} — add one on the ingredient`);
}

/** Every conversion edge that applies to an ingredient: its own rows and purchase unit first, then global rows, then standard. */
export async function conversionEdges(ingredientId: string, client: Client = db) {
  const [ing, rows] = await Promise.all([
    client.ingredient.findUniqueOrThrow({ where: { id: ingredientId }, select: { unit: true, purchaseUnit: true, purchaseFactor: true } }),
    client.unitConversion.findMany({ where: { OR: [{ ingredientId }, { ingredientId: null }] } }),
  ]);
  const own = rows.filter((r) => r.ingredientId === ingredientId);
  const global = rows.filter((r) => r.ingredientId === null);
  const purchase: ConversionEdge[] = ing.purchaseUnit && ing.purchaseUnit !== ing.unit && ing.purchaseFactor > 0 ? [{ fromUnit: ing.purchaseUnit, toUnit: ing.unit, factor: ing.purchaseFactor }] : [];
  return { base: ing.unit, purchaseUnit: ing.purchaseUnit, purchaseFactor: ing.purchaseFactor, edges: [...own, ...purchase, ...global, ...STANDARD_CONVERSIONS] as ConversionEdge[] };
}

/** Quantity in the ingredient's base unit, plus the factor used (base units per 1 `unit`). */
export async function toBaseUnits(ingredientId: string, qty: number, unit: StockUnit | null | undefined, client: Client = db) {
  const c = await conversionEdges(ingredientId, client);
  if (!unit || unit === c.base) return { qty, factor: 1, base: c.base };
  const factor = convertQty(1, unit, c.base, c.edges);
  return { qty: qty * factor, factor, base: c.base };
}

/** "12.5 kg (0.5 sack)" style helper: the base quantity also expressed in the purchase unit. */
export function inPurchaseUnits(qtyBase: number, ing: { purchaseUnit: StockUnit | null; purchaseFactor: number; unit: StockUnit }) {
  if (!ing.purchaseUnit || ing.purchaseUnit === ing.unit || !(ing.purchaseFactor > 0)) return null;
  return { qty: round3(qtyBase / ing.purchaseFactor), unit: ing.purchaseUnit };
}

export async function saveConversion(actor: InvActor, input: { ingredientId?: string | null; fromUnit: StockUnit; toUnit: StockUnit; factor: number }) {
  requireInventory(actor);
  if (!STOCK_UNITS.includes(input.fromUnit) || !STOCK_UNITS.includes(input.toUnit)) throw new InventoryError("Pick both units");
  if (input.fromUnit === input.toUnit) throw new InventoryError("Pick two different units");
  if (!(input.factor > 0) || !Number.isFinite(input.factor)) throw new InventoryError("The factor must be a positive number");
  const ingredientId = input.ingredientId || null;
  const existing = await db.unitConversion.findFirst({ where: { ingredientId, fromUnit: input.fromUnit, toUnit: input.toUnit } });
  const row = existing
    ? await db.unitConversion.update({ where: { id: existing.id }, data: { factor: input.factor } })
    : await db.unitConversion.create({ data: { ingredientId, fromUnit: input.fromUnit, toUnit: input.toUnit, factor: input.factor } });
  await audit({ actorId: actor.id, action: existing ? "unit-conversion.update" : "unit-conversion.create", entity: "UnitConversion", entityId: row.id, summary: `1 ${input.fromUnit} = ${input.factor} ${input.toUnit}`, before: existing, after: row });
  return row;
}

export async function deleteConversion(actor: InvActor, id: string) {
  requireInventory(actor);
  const row = await db.unitConversion.findUnique({ where: { id } });
  if (!row) throw new InventoryError("Conversion not found");
  await db.unitConversion.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "unit-conversion.delete", entity: "UnitConversion", entityId: id, before: row });
}

// ───────────── on hand, lots, valuation ─────────────

/** Quantity on hand per ingredient in a kitchen = SUM of its stock movements. */
export async function stockOnHand(kitchenId: string, ingredientIds?: string[], client: Client = db) {
  const rows = await client.stockMovement.groupBy({
    by: ["ingredientId"],
    where: { kitchenId, ...(ingredientIds ? { ingredientId: { in: ingredientIds } } : {}) },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.ingredientId, round3(r._sum.quantity ?? 0)]));
}

export type ValuationRow = { kitchenId: string; ingredientId: string; onHand: number; lotQty: number; lotValue: number; unlottedQty: number; unlottedValue: number; value: number };

/**
 * Inventory valuation (lot cost): Σ lot remainingQty × lot unitCost, plus unlotted stock (on hand − lots, never
 * below 0) at the ingredient's latest cost. Negative on-hand (recorded shortages) is valued at 0.
 */
export async function stockValuation(kitchenIds: string[] | null, client: Client = db) {
  const kitchens = await resolveKitchens(kitchenIds, client);
  const [moves, lots, ings] = await Promise.all([
    client.stockMovement.groupBy({ by: ["kitchenId", "ingredientId"], where: { kitchenId: { in: kitchens } }, _sum: { quantity: true } }),
    client.stockLot.findMany({ where: { kitchenId: { in: kitchens }, remainingQty: { gt: 0 } }, select: { kitchenId: true, ingredientId: true, remainingQty: true, unitCost: true } }),
    client.ingredient.findMany({ select: { id: true, costPerUnit: true } }),
  ]);
  const cost = new Map(ings.map((i) => [i.id, i.costPerUnit]));
  const rows = new Map<string, ValuationRow>();
  const row = (k: string, i: string) => {
    const key = `${k}|${i}`;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { kitchenId: k, ingredientId: i, onHand: 0, lotQty: 0, lotValue: 0, unlottedQty: 0, unlottedValue: 0, value: 0 }));
    return r;
  };
  for (const m of moves) row(m.kitchenId, m.ingredientId).onHand = round3(m._sum.quantity ?? 0);
  for (const l of lots) {
    const r = row(l.kitchenId, l.ingredientId);
    r.lotQty += l.remainingQty;
    r.lotValue += l.remainingQty * l.unitCost;
  }
  for (const r of rows.values()) {
    r.lotQty = round3(r.lotQty);
    r.lotValue = Math.round(r.lotValue);
    r.unlottedQty = round3(Math.max(0, r.onHand - r.lotQty));
    r.unlottedValue = Math.round(r.unlottedQty * (cost.get(r.ingredientId) ?? 0));
    r.value = r.lotValue + r.unlottedValue;
  }
  const list = [...rows.values()];
  return { rows: list, total: list.reduce((a, r) => a + r.value, 0) };
}

export async function stockList(kitchenId: string) {
  const [ingredients, onHand, valuation] = await Promise.all([
    db.ingredient.findMany({ where: { isActive: true }, include: { supplier: { select: { name: true } } }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    stockOnHand(kitchenId),
    stockValuation([kitchenId]),
  ]);
  const val = new Map(valuation.rows.map((r) => [r.ingredientId, r]));
  return ingredients.map((i) => {
    const qty = onHand.get(i.id) ?? 0;
    const v = val.get(i.id);
    const reorder = i.reorderPoint != null && qty <= i.reorderPoint;
    return { ...i, onHand: qty, lotQty: v?.lotQty ?? 0, value: v?.value ?? 0, low: qty < i.safetyStock || reorder, reorder, short: qty < 0, purchase: inPurchaseUnits(qty, i) };
  });
}

export async function reorderAlerts(kitchenId: string) {
  return (await stockList(kitchenId)).filter((i) => i.low);
}

export function lotCode(prefix = "L") {
  return `${prefix}-${todayKTM().slice(2).replace(/-/g, "")}-${randomCode(5)}`;
}

export async function lotsFor(kitchenId: string, opts: { ingredientId?: string; includeEmpty?: boolean; expiringWithinDays?: number } = {}) {
  const limit = opts.expiringWithinDays != null ? dateOnly(addDays(todayKTM(), opts.expiringWithinDays)) : null;
  return db.stockLot.findMany({
    where: { kitchenId, ...(opts.ingredientId ? { ingredientId: opts.ingredientId } : {}), ...(opts.includeEmpty ? {} : { remainingQty: { gt: 0 } }), ...(limit ? { expiresOn: { not: null, lte: limit } } : {}) },
    include: { ingredient: { select: { name: true, unit: true } }, location: { select: { name: true } } },
    orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }],
    take: 500,
  });
}

/** Lock an ingredient's stock in a kitchen for the rest of the transaction (all lot mutations go through here). */
async function lockStock(tx: Tx, kitchenId: string, ingredientId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock:${kitchenId}:${ingredientId}`}))`;
}

/** Open lots in FEFO order, row-locked (SELECT … FOR UPDATE). */
async function openLotsLocked(tx: Tx, kitchenId: string, ingredientId: string) {
  const ids = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "StockLot" WHERE "kitchenId" = ${kitchenId} AND "ingredientId" = ${ingredientId} AND "remainingQty" > 0 FOR UPDATE`;
  if (!ids.length) return [];
  return tx.stockLot.findMany({ where: { id: { in: ids.map((r) => r.id) } }, orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }] });
}

export type Draw = { lotId: string | null; qty: number; unitCost: number; expiresOn: Date | null; locationId: string | null; shortage: number };

/**
 * Take `qty` (base units) out of a kitchen's stock: FEFO across lots (preferred lots first), then unlotted stock,
 * then — only when `allowShortage` — a recorded shortage (the movement is still written; on hand goes below 0 and
 * the shortage is returned so callers flag it). Without `allowShortage` a draw beyond stock is refused.
 * Must run inside a transaction; lots are decremented with a guard so they can never go negative.
 */
export async function drawStock(tx: Tx, input: { kitchenId: string; ingredientId: string; qty: number; lotId?: string | null; preferLotIds?: string[]; allowShortage: boolean }) {
  const want = round3(input.qty);
  if (!(want > 0)) throw new InventoryError("Enter a quantity");
  await lockStock(tx, input.kitchenId, input.ingredientId);
  const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: input.ingredientId }, select: { name: true, unit: true, costPerUnit: true } });
  let lots = await openLotsLocked(tx, input.kitchenId, input.ingredientId);
  const onHand = (await stockOnHand(input.kitchenId, [input.ingredientId], tx)).get(input.ingredientId) ?? 0;
  const lotTotal = lots.reduce((a, l) => a + l.remainingQty, 0);
  let unlotted = input.lotId ? 0 : Math.max(0, round3(onHand - lotTotal));
  if (input.lotId) {
    lots = lots.filter((l) => l.id === input.lotId);
    if (!lots.length) throw new InventoryError("That lot is empty or belongs to another kitchen");
  } else if (input.preferLotIds?.length) {
    const pref = new Set(input.preferLotIds);
    lots = [...lots.filter((l) => pref.has(l.id)), ...lots.filter((l) => !pref.has(l.id))];
  }
  const draws: Draw[] = [];
  let left = want;
  for (const l of lots) {
    if (left <= EPS) break;
    const take = round3(Math.min(left, l.remainingQty));
    if (take <= 0) continue;
    const r = await tx.stockLot.updateMany({ where: { id: l.id, remainingQty: { gte: take - EPS } }, data: { remainingQty: round3(l.remainingQty - take) } });
    if (r.count !== 1) throw new InventoryError("Stock changed while saving — try again");
    draws.push({ lotId: l.id, qty: take, unitCost: l.unitCost, expiresOn: l.expiresOn, locationId: l.locationId, shortage: 0 });
    left = round3(left - take);
  }
  if (left > EPS) {
    const fromUnlotted = round3(Math.min(left, unlotted));
    const shortage = round3(left - fromUnlotted);
    unlotted = round3(unlotted - fromUnlotted);
    if (shortage > EPS && !input.allowShortage) {
      const available = round3(want - shortage);
      throw new InventoryError(`Only ${available} ${ing.unit.toLowerCase()} of ${ing.name} ${input.lotId ? "in that lot" : "in stock"}`);
    }
    draws.push({ lotId: null, qty: left, unitCost: ing.costPerUnit, expiresOn: null, locationId: null, shortage: shortage > EPS ? shortage : 0 });
  }
  return { draws, shortage: draws.reduce((a, d) => a + d.shortage, 0), unit: ing.unit, name: ing.name };
}

/** Write one negative movement per draw. The first row carries `idempotencyKey`; further rows get `:2`, `:3`… */
async function postDraws(tx: Tx, draws: Draw[], base: { ingredientId: string; kitchenId: string; type: StockMovementType; reference?: string | null; note?: string | null; actorId: string | null; idempotencyKey?: string | null; transferId?: string | null; unit: StockUnit }) {
  const rows = [];
  for (const [n, d] of draws.entries()) {
    const shortNote = d.shortage > 0 ? `SHORTAGE: ${round3(d.shortage)} ${base.unit.toLowerCase()} not in stock` : null;
    rows.push(
      await tx.stockMovement.create({
        data: {
          ingredientId: base.ingredientId,
          kitchenId: base.kitchenId,
          type: base.type,
          quantity: -round3(d.qty),
          unitCost: d.unitCost,
          reference: base.reference ?? null,
          idempotencyKey: base.idempotencyKey ? (n === 0 ? base.idempotencyKey : `${base.idempotencyKey}:${n + 1}`) : null,
          note: [base.note, shortNote].filter(Boolean).join(" — ") || null,
          actorId: base.actorId,
          lotId: d.lotId,
          locationId: d.locationId,
          transferId: base.transferId ?? null,
          expiresOn: d.expiresOn,
        },
      }),
    );
  }
  return rows;
}

async function createLot(tx: Tx, input: { ingredientId: string; kitchenId: string; qty: number; unitCost: number; expiresOn?: Date | null; locationId?: string | null; poLineId?: string | null; code?: string | null; prefix?: string }) {
  if (input.locationId) await assertLocation(tx, input.locationId, input.kitchenId);
  return tx.stockLot.create({
    data: { ingredientId: input.ingredientId, kitchenId: input.kitchenId, code: input.code?.trim() || lotCode(input.prefix), receivedQty: round3(input.qty), remainingQty: round3(input.qty), unitCost: Math.max(0, Math.round(input.unitCost)), expiresOn: input.expiresOn ?? null, locationId: input.locationId ?? null, poLineId: input.poLineId ?? null },
  });
}

const SIGN: Record<StockMovementType, 1 | -1 | 0> = { RECEIPT: 1, RETURN: -1, USAGE: -1, WASTE: -1, ADJUSTMENT: 0, TRANSFER_OUT: -1, TRANSFER_IN: 1 };

/**
 * Append a stock movement. Quantities are entered positive; the sign comes from the type (ADJUSTMENT keeps the
 * sign typed). `unit` converts to the base unit. A RECEIPT opens a lot; outgoing movements draw FEFO from lots
 * (split into one row per lot) and record any shortage instead of hiding it. Adjustments, waste and returns need
 * a note and are audited with on-hand before/after. Movements are never edited or deleted.
 */
export async function recordMovement(input: { ingredientId: string; kitchenId: string; type: StockMovementType; quantity: number; unit?: StockUnit | null; unitCost?: number | null; note?: string | null; reference?: string | null; expiresOn?: string | null; locationId?: string | null; lotId?: string | null; actorId: string }) {
  if (!Number.isFinite(input.quantity) || input.quantity === 0) throw new InventoryError("Enter a quantity");
  if (input.type !== "ADJUSTMENT" && input.quantity < 0) throw new InventoryError("Enter a positive quantity — the type decides the direction");
  if (["ADJUSTMENT", "WASTE", "RETURN"].includes(input.type) && !input.note?.trim()) throw new InventoryError("Give a reason for this movement");
  if (input.type === "TRANSFER_IN" || input.type === "TRANSFER_OUT") throw new InventoryError("Use a stock transfer to move stock between kitchens");
  const conv = await toBaseUnits(input.ingredientId, Math.abs(input.quantity), input.unit);
  const qtyBase = round3(conv.qty);
  if (!(qtyBase > 0)) throw new InventoryError("Enter a quantity");
  const sign = SIGN[input.type] === 0 ? Math.sign(input.quantity) : SIGN[input.type];
  const note = input.note?.trim() || null;
  const result = await db.$transaction(async (tx) => {
    const before = (await stockOnHand(input.kitchenId, [input.ingredientId], tx)).get(input.ingredientId) ?? 0;
    let rows;
    let shortage = 0;
    if (sign > 0) {
      await lockStock(tx, input.kitchenId, input.ingredientId);
      const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: input.ingredientId }, select: { costPerUnit: true } });
      const unitCost = input.unitCost != null ? Math.round(input.unitCost / conv.factor) : ing.costPerUnit;
      if (input.locationId) await assertLocation(tx, input.locationId, input.kitchenId);
      const lot = input.type === "RECEIPT" ? await createLot(tx, { ingredientId: input.ingredientId, kitchenId: input.kitchenId, qty: qtyBase, unitCost, expiresOn: input.expiresOn ? dateOnly(input.expiresOn) : null, locationId: input.locationId }) : null;
      rows = [
        await tx.stockMovement.create({
          data: { ingredientId: input.ingredientId, kitchenId: input.kitchenId, type: input.type, quantity: qtyBase, unitCost, note, reference: input.reference ?? null, expiresOn: input.expiresOn ? dateOnly(input.expiresOn) : null, actorId: input.actorId, lotId: lot?.id ?? null, locationId: input.locationId ?? null },
        }),
      ];
    } else {
      const d = await drawStock(tx, { kitchenId: input.kitchenId, ingredientId: input.ingredientId, qty: qtyBase, lotId: input.lotId, allowShortage: !input.lotId });
      shortage = d.shortage;
      rows = await postDraws(tx, d.draws, { ingredientId: input.ingredientId, kitchenId: input.kitchenId, type: input.type, reference: input.reference, note, actorId: input.actorId, unit: d.unit });
    }
    return { rows, before, after: round3(before + sign * qtyBase), shortage };
  });
  const total = round3(result.rows.reduce((a, r) => a + r.quantity, 0));
  if (["ADJUSTMENT", "WASTE", "RETURN"].includes(input.type) || result.shortage > 0) {
    await audit({
      actorId: input.actorId,
      action: result.shortage > 0 && !["ADJUSTMENT", "WASTE", "RETURN"].includes(input.type) ? "stock.shortage" : `stock.${input.type.toLowerCase()}`,
      entity: "StockMovement",
      entityId: result.rows[0].id,
      summary: `${total} ${conv.base.toLowerCase()}${result.shortage > 0 ? ` (shortage ${round3(result.shortage)})` : ""}`,
      reason: note,
      before: { onHand: result.before },
      after: { onHand: result.after, movements: result.rows.map((r) => r.id), shortage: result.shortage },
    });
  }
  return { ...result.rows[0], quantity: total, movements: result.rows, shortage: round3(result.shortage) };
}

/** Lots (with stock) whose expiry is within `days` (or past), FEFO order. */
export async function expiringStock(kitchenId: string, days = 3) {
  const today = dateOnly(todayKTM());
  const rows = await lotsFor(kitchenId, { expiringWithinDays: days });
  return rows.map((l) => ({ ...l, expired: l.expiresOn! < today }));
}

// ───────────── recipe scaling and batch consumption ─────────────

/**
 * Scale a recipe to a production volume. `net` is what ends up in the food; `gross` adds trim waste
 * (waste% capped at 90). Quantities are in the ingredient's base unit.
 */
export function scaleRecipe<T extends { ingredientId: string; quantity: number; wastePct: number }>(lines: T[], yieldPortions: number, portions: number) {
  const y = Math.max(1, yieldPortions);
  return lines.map((l) => {
    const net = (l.quantity / y) * portions;
    return { ...l, net, gross: net / (1 - Math.min(90, Math.max(0, l.wastePct)) / 100) };
  });
}

/** Ingredient plan for `portions` of a dish's current recipe in a kitchen: scaled need, on hand, shortage, purchase units. */
export async function recipeForProduction(menuItemId: string, portions: number, kitchenId?: string | null) {
  const recipe = await db.recipe.findUnique({ where: { menuItemId }, include: { menuItem: { select: { name: true } }, currentVersion: { include: { ingredients: { include: { ingredient: true } } } } } });
  const v = recipe?.currentVersion;
  if (!v) return null;
  const onHand = kitchenId ? await stockOnHand(kitchenId, v.ingredients.map((l) => l.ingredientId)) : new Map<string, number>();
  const scaled = scaleRecipe(v.ingredients, v.yieldPortions, Math.max(0, portions));
  return {
    dish: recipe!.menuItem.name,
    yieldPortions: v.yieldPortions,
    portions,
    lines: scaled.map((l) => {
      const have = onHand.get(l.ingredientId) ?? 0;
      return { ingredientId: l.ingredientId, name: l.ingredient.name, unit: l.ingredient.unit, net: round3(l.net), gross: round3(l.gross), wastePct: l.wastePct, purchase: inPurchaseUnits(l.gross, l.ingredient), onHand: have, short: round3(Math.max(0, l.gross - have)), cost: Math.round(l.gross * l.ingredient.costPerUnit) };
    }),
  };
}

/**
 * Write ingredient usage for a finished batch (moved here from kitchen.ts in WP-08). Consumes lots FEFO with row
 * locks; a shortage is still written (and returned + audited), never hidden. Idempotent per batch: the
 * `batch:<id>:<usage|waste>:<ingredientId>` key is unchanged; lot splits add `:2`, `:3`… in the same transaction.
 */
export async function postBatchStock(tx: Tx, batchId: string, actorId: string | null) {
  const b = await tx.productionBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (b.status !== "DONE" || b.actualPortions == null) return { posted: false, rows: 0, shortages: [] };
  const versionId = b.recipeVersionId ?? (await tx.recipe.findUnique({ where: { menuItemId: b.menuItemId } }))?.currentVersionId;
  if (!versionId) return { posted: false, rows: 0, shortages: [] };
  const v = await tx.recipeVersion.findUniqueOrThrow({ where: { id: versionId }, include: { ingredients: { include: { ingredient: true } } } });
  const used = scaleRecipe(v.ingredients, v.yieldPortions, b.actualPortions - (b.wastePortions ?? 0));
  const wasted = scaleRecipe(v.ingredients, v.yieldPortions, b.wastePortions ?? 0);
  let posted = 0;
  const shortages: { ingredientId: string; name: string; type: "USAGE" | "WASTE"; shortage: number }[] = [];
  for (const [i, l] of v.ingredients.entries()) {
    for (const [type, qty] of [["USAGE", used[i].gross], ["WASTE", wasted[i].gross]] as const) {
      if (round3(qty) <= 0) continue;
      const key = `batch:${b.id}:${type.toLowerCase()}:${l.ingredientId}`;
      const exists = await tx.stockMovement.findUnique({ where: { idempotencyKey: key } });
      if (exists) continue;
      const d = await drawStock(tx, { kitchenId: b.kitchenId, ingredientId: l.ingredientId, qty, allowShortage: true });
      const rows = await postDraws(tx, d.draws, { ingredientId: l.ingredientId, kitchenId: b.kitchenId, type, reference: `batch:${b.id}`, idempotencyKey: key, note: type === "WASTE" ? `Batch waste (${b.wastePortions} portions)` : `Batch of ${b.actualPortions} portions`, actorId, unit: d.unit });
      if (d.shortage > 0) shortages.push({ ingredientId: l.ingredientId, name: l.ingredient.name, type, shortage: round3(d.shortage) });
      posted += rows.length;
    }
  }
  await tx.productionBatch.update({ where: { id: b.id }, data: { stockPosted: true } });
  if (shortages.length) {
    await audit({ actorId, action: "stock.shortage", entity: "ProductionBatch", entityId: b.id, summary: `${shortages.length} ingredient(s) short`, after: { kitchenId: b.kitchenId, shortages } });
  }
  return { posted: posted > 0, rows: posted, shortages };
}

// ───────────── locations ─────────────

async function assertLocation(client: Client, locationId: string, kitchenId: string) {
  const loc = await client.inventoryLocation.findUnique({ where: { id: locationId } });
  if (!loc || loc.kitchenId !== kitchenId) throw new InventoryError("That location belongs to another kitchen");
  if (!loc.isActive) throw new InventoryError("That location is archived");
  return loc;
}

export async function listLocations(actor: InvActor, kitchenId: string, opts: { includeInactive?: boolean } = {}) {
  requireInventory(actor, "inventory.view");
  requireKitchenScope(actor, kitchenId);
  const [locs, lots] = await Promise.all([
    db.inventoryLocation.findMany({ where: { kitchenId, ...(opts.includeInactive ? {} : { isActive: true }) }, orderBy: { name: "asc" } }),
    db.stockLot.findMany({ where: { kitchenId, remainingQty: { gt: 0 } }, select: { locationId: true, remainingQty: true, unitCost: true } }),
  ]);
  const by = new Map<string | null, { lots: number; value: number }>();
  for (const l of lots) {
    const a = by.get(l.locationId) ?? { lots: 0, value: 0 };
    a.lots++;
    a.value += l.remainingQty * l.unitCost;
    by.set(l.locationId, a);
  }
  return {
    locations: locs.map((l) => ({ ...l, lots: by.get(l.id)?.lots ?? 0, value: Math.round(by.get(l.id)?.value ?? 0) })),
    unassigned: { lots: by.get(null)?.lots ?? 0, value: Math.round(by.get(null)?.value ?? 0) },
  };
}

export async function saveLocation(actor: InvActor, input: { id?: string | null; kitchenId: string; name: string; isActive?: boolean }) {
  requireInventory(actor);
  const name = input.name.trim().slice(0, 60);
  if (name.length < 2) throw new InventoryError("Name the location (e.g. Dry store)");
  const before = input.id ? await db.inventoryLocation.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new InventoryError("Location not found");
  const kitchenId = before?.kitchenId ?? input.kitchenId;
  requireKitchenScope(actor, kitchenId);
  const dupe = await db.inventoryLocation.findFirst({ where: { kitchenId, name, ...(input.id ? { id: { not: input.id } } : {}) } });
  if (dupe) throw new InventoryError("That kitchen already has a location with this name");
  if (before && input.isActive === false && before.isActive) {
    const stocked = await db.stockLot.count({ where: { locationId: before.id, remainingQty: { gt: 0 } } });
    if (stocked) throw new InventoryError(`${stocked} lot(s) still stored here — move them first`);
  }
  const data = { name, isActive: input.isActive ?? true };
  const row = before ? await db.inventoryLocation.update({ where: { id: before.id }, data }) : await db.inventoryLocation.create({ data: { ...data, kitchenId } });
  await audit({ actorId: actor.id, action: before ? "inventory-location.update" : "inventory-location.create", entity: "InventoryLocation", entityId: row.id, summary: row.name, before, after: data });
  return row;
}

/** Re-shelve a lot within its kitchen. The lot keeps its history; the change is audited. */
export async function moveLot(actor: InvActor, lotId: string, locationId: string | null) {
  requireInventory(actor);
  const lot = await db.stockLot.findUnique({ where: { id: lotId } });
  if (!lot) throw new InventoryError("Lot not found");
  requireKitchenScope(actor, lot.kitchenId);
  if (locationId) await assertLocation(db, locationId, lot.kitchenId);
  const row = await db.stockLot.update({ where: { id: lotId }, data: { locationId } });
  await audit({ actorId: actor.id, action: "stock-lot.move", entity: "StockLot", entityId: lotId, summary: lot.code, before: { locationId: lot.locationId }, after: { locationId } });
  return row;
}

// ───────────── transfers between kitchens ─────────────

export function transferNumber() {
  return `TR-${todayKTM().slice(2).replace(/-/g, "")}-${randomCode(4)}`;
}

/**
 * Move stock from one kitchen to another in ONE transaction: TRANSFER_OUT rows (FEFO from the source lots) and
 * matching TRANSFER_IN rows that open lots at the destination with the same cost and expiry. The actor must have
 * both kitchens in scope; a transfer can't take more than is in stock.
 */
export async function transferStock(actor: InvActor, input: { fromKitchenId: string; toKitchenId: string; lines: { ingredientId: string; quantity: number; unit?: StockUnit | null }[]; note?: string | null; toLocationId?: string | null }) {
  requireInventory(actor);
  if (!input.fromKitchenId || !input.toKitchenId) throw new InventoryError("Pick both kitchens");
  if (input.fromKitchenId === input.toKitchenId) throw new InventoryError("Pick two different kitchens");
  requireKitchenScope(actor, input.fromKitchenId);
  requireKitchenScope(actor, input.toKitchenId);
  const lines: { ingredientId: string; quantity: number }[] = [];
  for (const l of input.lines.filter((x) => x.ingredientId && x.quantity > 0)) lines.push({ ingredientId: l.ingredientId, quantity: round3((await toBaseUnits(l.ingredientId, l.quantity, l.unit)).qty) });
  if (!lines.length) throw new InventoryError("Add at least one line");
  if (new Set(lines.map((l) => l.ingredientId)).size !== lines.length) throw new InventoryError("Each ingredient once per transfer");
  const ids = lines.map((l) => l.ingredientId);
  const result = await db.$transaction(async (tx) => {
    const [from, to] = await Promise.all([tx.kitchen.findUnique({ where: { id: input.fromKitchenId } }), tx.kitchen.findUnique({ where: { id: input.toKitchenId } })]);
    if (!from || !to) throw new InventoryError("Kitchen not found");
    if (input.toLocationId) await assertLocation(tx, input.toLocationId, to.id);
    const beforeFrom = await stockOnHand(from.id, ids, tx);
    const beforeTo = await stockOnHand(to.id, ids, tx);
    const transfer = await tx.stockTransfer.create({
      data: { number: transferNumber(), fromKitchenId: from.id, toKitchenId: to.id, status: "RECEIVED", note: input.note?.trim() || null, createdById: actor.id, lines: { create: lines.map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity, receivedQty: l.quantity })) } },
    });
    let value = 0;
    // sorted ingredient order keeps lock acquisition consistent across concurrent transfers
    for (const l of [...lines].sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))) {
      const d = await drawStock(tx, { kitchenId: from.id, ingredientId: l.ingredientId, qty: l.quantity, allowShortage: false });
      await postDraws(tx, d.draws, { ingredientId: l.ingredientId, kitchenId: from.id, type: "TRANSFER_OUT", reference: transfer.number, note: `To ${to.name}`, actorId: actor.id, transferId: transfer.id, unit: d.unit });
      for (const [n, dr] of d.draws.entries()) {
        const lot = await createLot(tx, { ingredientId: l.ingredientId, kitchenId: to.id, qty: dr.qty, unitCost: dr.unitCost, expiresOn: dr.expiresOn, locationId: input.toLocationId, code: `${transfer.number}-${l.ingredientId.slice(-4)}-${n + 1}` });
        await tx.stockMovement.create({ data: { ingredientId: l.ingredientId, kitchenId: to.id, type: "TRANSFER_IN", quantity: dr.qty, unitCost: dr.unitCost, reference: transfer.number, note: `From ${from.name}`, actorId: actor.id, lotId: lot.id, locationId: input.toLocationId ?? null, transferId: transfer.id, expiresOn: dr.expiresOn } });
        value += dr.qty * dr.unitCost;
      }
    }
    const afterFrom = await stockOnHand(from.id, ids, tx);
    const afterTo = await stockOnHand(to.id, ids, tx);
    const snap = (m: Map<string, number>) => Object.fromEntries(ids.map((i) => [i, m.get(i) ?? 0]));
    return { transfer, value: Math.round(value), from, to, before: { [from.code]: snap(beforeFrom), [to.code]: snap(beforeTo) }, after: { [from.code]: snap(afterFrom), [to.code]: snap(afterTo) } };
  });
  await audit({ actorId: actor.id, action: "stock.transfer", entity: "StockTransfer", entityId: result.transfer.id, summary: `${result.transfer.number}: ${result.from.name} → ${result.to.name} (${lines.length} line(s))`, reason: input.note?.trim() || null, before: result.before, after: { ...result.after, value: result.value } });
  return { ...result.transfer, value: result.value };
}

/** Transfers touching any kitchen in scope (either end). */
export async function listTransfers(actor: InvActor, opts: { kitchenId?: string; take?: number } = {}) {
  requireInventory(actor, "inventory.view");
  const ids = scopeOf(actor);
  if (opts.kitchenId) requireKitchenScope(actor, opts.kitchenId);
  const k = opts.kitchenId ? [opts.kitchenId] : ids;
  return db.stockTransfer.findMany({
    where: k ? { OR: [{ fromKitchenId: { in: k } }, { toKitchenId: { in: k } }] } : {},
    include: { fromKitchen: { select: { name: true } }, toKitchen: { select: { name: true } }, lines: { include: { ingredient: { select: { name: true, unit: true } } } } },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 100,
  });
}

// ───────────── purchase orders ─────────────

export function poNumber() {
  return `PO-${todayKTM().slice(2).replace(/-/g, "")}-${randomCode(4)}`;
}

/**
 * Create a PO. A line may be entered in a purchase unit (`unit`, e.g. PACK for a 25 kg sack); it's stored in the
 * ingredient's base unit with the cost converted to paisa per base unit.
 */
export async function createPurchaseOrder(input: { supplierId: string; kitchenId: string; expectedOn?: string | null; notes?: string | null; lines: { ingredientId: string; quantity: number; unitCost: number; unit?: StockUnit | null }[]; actorId: string }) {
  const raw = input.lines.filter((l) => l.ingredientId && l.quantity > 0);
  if (!raw.length) throw new InventoryError("Add at least one line");
  if (raw.some((l) => l.unitCost < 0)) throw new InventoryError("Unit cost can't be negative");
  const lines: { ingredientId: string; quantity: number; unitCost: number; lineTotal: number }[] = [];
  for (const l of raw) {
    const c = await toBaseUnits(l.ingredientId, l.quantity, l.unit);
    lines.push({ ingredientId: l.ingredientId, quantity: round3(c.qty), unitCost: Math.round(l.unitCost / c.factor), lineTotal: l.quantity * l.unitCost });
  }
  const total = Math.round(lines.reduce((a, l) => a + l.lineTotal, 0));
  return db.purchaseOrder.create({
    data: {
      number: poNumber(),
      supplierId: input.supplierId,
      kitchenId: input.kitchenId,
      expectedOn: input.expectedOn ? dateOnly(input.expectedOn) : null,
      notes: input.notes || null,
      total,
      createdById: input.actorId,
      lines: { create: lines.map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity, unitCost: l.unitCost })) },
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
 * Receive goods against a PO. Each received quantity (optionally in a purchase unit, converted to base) opens a
 * lot (cost, expiry, location, PO line) and posts a RECEIPT movement linked to it; the ingredient's latest cost is
 * updated. Status becomes PARTIAL or RECEIVED.
 */
export async function receivePurchase(poId: string, actorId: string, received: { lineId: string; quantity: number; unit?: StockUnit | null; unitCost?: number; expiresOn?: string | null; locationId?: string | null; lotCode?: string | null }[]) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`po:${poId}`}))`;
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    if (!["SENT", "PARTIAL", "DRAFT"].includes(po.status)) throw new InventoryError(`This order is ${po.status.toLowerCase()}`);
    let posted = 0;
    for (const r of received) {
      if (!(r.quantity > 0)) continue;
      const line = po.lines.find((l) => l.id === r.lineId);
      if (!line) throw new InventoryError("Line not found");
      const c = await toBaseUnits(line.ingredientId, r.quantity, r.unit, tx);
      const qty = round3(c.qty);
      const remaining = round3(line.quantity - line.receivedQty);
      if (qty > remaining + 1e-9) throw new InventoryError(`Only ${remaining} left to receive on that line`);
      const unitCost = r.unitCost != null && r.unitCost >= 0 ? Math.round(r.unitCost / c.factor) : line.unitCost;
      const expiresOn = r.expiresOn ? dateOnly(r.expiresOn) : null;
      await lockStock(tx, po.kitchenId, line.ingredientId);
      const lot = await createLot(tx, { ingredientId: line.ingredientId, kitchenId: po.kitchenId, qty, unitCost, expiresOn, locationId: r.locationId, poLineId: line.id, code: r.lotCode });
      await tx.stockMovement.create({
        data: { ingredientId: line.ingredientId, kitchenId: po.kitchenId, type: "RECEIPT", quantity: qty, unitCost, reference: po.number, expiresOn, actorId, note: `Received on ${po.number}`, lotId: lot.id, locationId: r.locationId ?? null },
      });
      line.receivedQty = round3(line.receivedQty + qty);
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: line.receivedQty, unitCost } });
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

const returnRef = (poNumber: string, lineId: string) => `${poNumber}#return:${lineId}`;

/** Quantity already returned per PO line (base units, positive). */
export async function returnedByLine(po: { number: string; lines: { id: string }[] }, client: Client = db) {
  const rows = await client.stockMovement.groupBy({ by: ["reference"], where: { type: "RETURN", reference: { in: po.lines.map((l) => returnRef(po.number, l.id)) } }, _sum: { quantity: true } });
  const out = new Map<string, number>();
  for (const l of po.lines) out.set(l.id, round3(-(rows.find((r) => r.reference === returnRef(po.number, l.id))?._sum.quantity ?? 0)));
  return out;
}

/**
 * Return received goods to the supplier. Posts RETURN movements drawn from that PO line's lots first (or the given
 * lot), never more than was received minus already returned, never more than is in stock. Audited with on-hand
 * before/after, the reason and the credit value (Σ qty × lot cost) for the supplier invoice (WP-09).
 */
export async function returnToSupplier(actor: InvActor, input: { poId: string; reason: string; lines: { lineId: string; quantity: number; unit?: StockUnit | null; lotId?: string | null }[] }) {
  requireInventory(actor);
  const reason = input.reason?.trim();
  if (!reason || reason.length < 3) throw new InventoryError("Give a reason for the return");
  const po0 = await db.purchaseOrder.findUnique({ where: { id: input.poId }, select: { kitchenId: true } });
  if (!po0) throw new InventoryError("Purchase order not found");
  requireKitchenScope(actor, po0.kitchenId);
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`po:${input.poId}`}))`;
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: input.poId }, include: { lines: { include: { ingredient: { select: { name: true } } } } } });
    const returned = await returnedByLine(po, tx);
    const ids = po.lines.map((l) => l.ingredientId);
    const before = await stockOnHand(po.kitchenId, ids, tx);
    let credit = 0;
    const done: { lineId: string; ingredient: string; quantity: number; credit: number }[] = [];
    for (const r of input.lines) {
      if (!(r.quantity > 0)) continue;
      const line = po.lines.find((l) => l.id === r.lineId);
      if (!line) throw new InventoryError("Line not found");
      const qty = round3((await toBaseUnits(line.ingredientId, r.quantity, r.unit, tx)).qty);
      const canReturn = round3(line.receivedQty - (returned.get(line.id) ?? 0));
      if (qty > canReturn + 1e-9) throw new InventoryError(`Only ${canReturn} of ${line.ingredient.name} can be returned on this order`);
      const lineLots = await tx.stockLot.findMany({ where: { poLineId: line.id }, select: { id: true } });
      const d = await drawStock(tx, { kitchenId: po.kitchenId, ingredientId: line.ingredientId, qty, lotId: r.lotId, preferLotIds: lineLots.map((l) => l.id), allowShortage: false });
      await postDraws(tx, d.draws, { ingredientId: line.ingredientId, kitchenId: po.kitchenId, type: "RETURN", reference: returnRef(po.number, line.id), note: `Returned to supplier: ${reason}`, actorId: actor.id, unit: d.unit });
      const c = Math.round(d.draws.reduce((a, x) => a + x.qty * x.unitCost, 0));
      credit += c;
      returned.set(line.id, round3((returned.get(line.id) ?? 0) + qty));
      done.push({ lineId: line.id, ingredient: line.ingredient.name, quantity: qty, credit: c });
    }
    if (!done.length) throw new InventoryError("Enter what goes back");
    const after = await stockOnHand(po.kitchenId, ids, tx);
    const snap = (m: Map<string, number>) => Object.fromEntries(ids.map((i) => [i, m.get(i) ?? 0]));
    return { po, credit, lines: done, before: snap(before), after: snap(after) };
  });
  await audit({ actorId: actor.id, action: "po.return", entity: "PurchaseOrder", entityId: result.po.id, summary: `${result.po.number}: ${result.lines.length} line(s) returned, credit ${result.credit} paisa`, reason, before: { onHand: result.before }, after: { onHand: result.after, lines: result.lines, credit: result.credit } });
  return { credit: result.credit, lines: result.lines };
}

/** Returns posted against a PO (for the PO page and for WP-09 supplier credit). */
export async function purchaseReturns(poId: string) {
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
  const rows = await db.stockMovement.findMany({ where: { type: "RETURN", reference: { startsWith: `${po.number}#return:` } }, include: { ingredient: { select: { name: true, unit: true } } }, orderBy: { createdAt: "desc" } });
  return { rows: rows.map((r) => ({ ...r, value: Math.round(-r.quantity * (r.unitCost ?? 0)) })), credit: rows.reduce((a, r) => a + Math.round(-r.quantity * (r.unitCost ?? 0)), 0) };
}

/** Supplier invoices (WP-09's model) recorded against a PO — read only here. */
export async function supplierInvoicesForPO(poId: string) {
  return db.supplierInvoice.findMany({ where: { poId }, orderBy: { date: "desc" }, select: { id: true, number: true, date: true, total: true, paidAmount: true, status: true } });
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
    for (const l of scaleRecipe(v.ingredients, v.yieldPortions, b.actualPortions)) theo.set(l.ingredientId, (theo.get(l.ingredientId) ?? 0) + l.gross);
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

// ───────────── alert data (read functions for WP-16) ─────────────

export type InventoryAlert = {
  type: "LOW_STOCK" | "EXPIRING_STOCK" | "EXPIRED_STOCK" | "UNEXPECTED_CONSUMPTION" | "STOCK_DISCREPANCY" | "STOCK_SHORTAGE" | "LATE_SUPPLIER_DELIVERY";
  severity: "info" | "warning" | "critical";
  kitchenId: string;
  entity: "Ingredient" | "StockLot" | "PurchaseOrder";
  entityId: string;
  /** Stable key for Alert.dedupeKey. */
  dedupeKey: string;
  message: string;
  data: Record<string, unknown>;
};

/** Ingredients at/below their reorder point (or below safety stock when no reorder point is set). */
export async function lowStockAlerts(kitchenIds: string[] | null): Promise<InventoryAlert[]> {
  const out: InventoryAlert[] = [];
  const ings = await db.ingredient.findMany({ where: { isActive: true }, select: { id: true, name: true, unit: true, safetyStock: true, reorderPoint: true, reorderQty: true } });
  for (const k of await resolveKitchens(kitchenIds)) {
    const onHand = await stockOnHand(k);
    for (const i of ings) {
      const qty = onHand.get(i.id) ?? 0;
      const point = i.reorderPoint ?? i.safetyStock;
      const low = i.reorderPoint != null ? qty <= i.reorderPoint : i.safetyStock > 0 && qty < i.safetyStock;
      if (!low) continue;
      out.push({ type: "LOW_STOCK", severity: qty <= 0 ? "critical" : "warning", kitchenId: k, entity: "Ingredient", entityId: i.id, dedupeKey: `low-stock:${k}:${i.id}`, message: `${i.name}: ${qty} ${i.unit.toLowerCase()} on hand (reorder at ${point})`, data: { onHand: qty, reorderPoint: point, reorderQty: i.reorderQty } });
    }
  }
  return out;
}

/** Lots with stock expiring within `days` (EXPIRING) or already past expiry (EXPIRED). */
export async function expiringLotAlerts(kitchenIds: string[] | null, days = 3): Promise<InventoryAlert[]> {
  const kitchens = await resolveKitchens(kitchenIds);
  const today = dateOnly(todayKTM());
  const lots = await db.stockLot.findMany({ where: { kitchenId: { in: kitchens }, remainingQty: { gt: 0 }, expiresOn: { not: null, lte: dateOnly(addDays(todayKTM(), days)) } }, include: { ingredient: { select: { name: true, unit: true } } }, orderBy: { expiresOn: "asc" } });
  return lots.map((l) => {
    const expired = l.expiresOn! < today;
    return { type: expired ? "EXPIRED_STOCK" : "EXPIRING_STOCK", severity: expired ? "critical" : "warning", kitchenId: l.kitchenId, entity: "StockLot", entityId: l.id, dedupeKey: `${expired ? "expired" : "expiring"}:${l.id}`, message: `${l.ingredient.name} lot ${l.code}: ${round3(l.remainingQty)} ${l.ingredient.unit.toLowerCase()} ${expired ? "expired" : "expires"} ${isoDate(l.expiresOn!)}`, data: { expiresOn: isoDate(l.expiresOn!), remainingQty: l.remainingQty, value: Math.round(l.remainingQty * l.unitCost) } } satisfies InventoryAlert;
  });
}

/** Actual usage + waste above the recipe theory by more than `thresholdPct` (and a minimum cost) over a date range. */
export async function unexpectedConsumptionAlerts(kitchenIds: string[] | null, from: string, to: string, thresholdPct = 15, minCost = 10_000): Promise<InventoryAlert[]> {
  const out: InventoryAlert[] = [];
  for (const k of await resolveKitchens(kitchenIds)) {
    for (const v of await usageVariance(k, from, to)) {
      const over = v.theoretical > 0 ? (v.variancePct ?? 0) > thresholdPct : v.actual > 0;
      if (!over || v.varianceCost < minCost) continue;
      out.push({ type: "UNEXPECTED_CONSUMPTION", severity: v.variancePct != null && v.variancePct > thresholdPct * 2 ? "critical" : "warning", kitchenId: k, entity: "Ingredient", entityId: v.ingredientId, dedupeKey: `consumption:${k}:${v.ingredientId}:${from}:${to}`, message: `${v.name}: used ${v.actual} vs ${v.theoretical} ${v.unit.toLowerCase()} expected${v.variancePct != null ? ` (+${v.variancePct}%)` : ""}`, data: { ...v, from, to } });
    }
  }
  return out;
}

/**
 * Ledger vs lots: negative on-hand (a recorded shortage still open) and lots holding more than the ledger says
 * (drift from movements posted outside lots). Both need a stock count.
 */
export async function stockDiscrepancyAlerts(kitchenIds: string[] | null): Promise<InventoryAlert[]> {
  const v = await stockValuation(kitchenIds);
  const names = new Map((await db.ingredient.findMany({ select: { id: true, name: true, unit: true } })).map((i) => [i.id, i]));
  const out: InventoryAlert[] = [];
  for (const r of v.rows) {
    const i = names.get(r.ingredientId);
    if (r.onHand < -EPS) out.push({ type: "STOCK_SHORTAGE", severity: "critical", kitchenId: r.kitchenId, entity: "Ingredient", entityId: r.ingredientId, dedupeKey: `shortage:${r.kitchenId}:${r.ingredientId}`, message: `${i?.name}: on hand is ${r.onHand} ${i?.unit.toLowerCase()} — consumption was recorded beyond stock`, data: { onHand: r.onHand } });
    if (r.lotQty - Math.max(0, r.onHand) > 0.001) out.push({ type: "STOCK_DISCREPANCY", severity: "warning", kitchenId: r.kitchenId, entity: "Ingredient", entityId: r.ingredientId, dedupeKey: `lot-drift:${r.kitchenId}:${r.ingredientId}`, message: `${i?.name}: lots hold ${r.lotQty} but the ledger shows ${r.onHand} — count and adjust`, data: { onHand: r.onHand, lotQty: r.lotQty } });
  }
  return out;
}

/** POs sent (or part-received) whose expected date has passed. */
export async function lateDeliveryAlerts(kitchenIds: string[] | null, asOf = todayKTM()): Promise<InventoryAlert[]> {
  const kitchens = await resolveKitchens(kitchenIds);
  const pos = await db.purchaseOrder.findMany({ where: { kitchenId: { in: kitchens }, status: { in: ["SENT", "PARTIAL"] }, expectedOn: { not: null, lt: dateOnly(asOf) } }, include: { supplier: { select: { name: true } } }, orderBy: { expectedOn: "asc" } });
  return pos.map((p) => {
    const late = Math.round((dateOnly(asOf).getTime() - p.expectedOn!.getTime()) / 86_400_000);
    return { type: "LATE_SUPPLIER_DELIVERY", severity: late > 2 ? "critical" : "warning", kitchenId: p.kitchenId, entity: "PurchaseOrder", entityId: p.id, dedupeKey: `late-po:${p.id}`, message: `${p.number} from ${p.supplier.name} is ${late} day(s) late`, data: { supplierId: p.supplierId, expectedOn: isoDate(p.expectedOn!), daysLate: late, status: p.status } } satisfies InventoryAlert;
  });
}

/** Every inventory alert for the given kitchens (null = all). Consumption is checked over the last `consumptionDays`. */
export async function inventoryAlerts(kitchenIds: string[] | null, opts: { expiringDays?: number; consumptionDays?: number; thresholdPct?: number } = {}) {
  const to = todayKTM();
  const from = addDays(to, -(opts.consumptionDays ?? 7));
  const groups = await Promise.all([lowStockAlerts(kitchenIds), expiringLotAlerts(kitchenIds, opts.expiringDays ?? 3), unexpectedConsumptionAlerts(kitchenIds, from, to, opts.thresholdPct ?? 15), stockDiscrepancyAlerts(kitchenIds), lateDeliveryAlerts(kitchenIds, to)]);
  return groups.flat();
}
