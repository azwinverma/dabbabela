import type { BatchStatus, Diet, OrderStatus, Role, StockUnit, Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can, isStaffRole, type Permission } from "@/lib/permissions";
import { addDays, dateOnly, isoDate, isValidISODate, ktmNow, todayKTM } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { COOK_STATUSES, LIVE_STATUSES } from "./transitions";
import { setOrderStatus } from "./orders";
import { postBatchStock, scaleRecipe, stockOnHand } from "./inventory";
import { dayCapacity, kitchenOrderProblem, mealsBooked, type KitchenStatus } from "./capacity";
import { setScopes, type Actor as AccessActor } from "./access";
import { getOffersForDates } from "./menu";

/** Orders the kitchen plans for (paid/secured + already cooking). PENDING_PAYMENT is shown separately. */
export const KITCHEN_STATUSES = [...COOK_STATUSES];

export class KitchenError extends Error {}

export type Component = { menuItemId: string; name: string; qty: number; diet?: Diet; station?: string | null; allergens?: string[]; recipeVersionId?: string | null };

function components(json: unknown): Component[] {
  return Array.isArray(json) ? (json as Component[]).filter((c) => c && typeof c.menuItemId === "string") : [];
}

// ───────────── actor, permission and kitchen scope (WP-07) ─────────────

/** Anyone acting on a kitchen: a CurrentUser fits. kitchenIds null/undefined (and no kitchenId) = all kitchens. */
export type KitchenActor = { id: string; role: Role | string; customGrants?: readonly string[] | null; kitchenIds?: string[] | null; kitchenId?: string | null };

export function kitchenScopeOf(actor: Pick<KitchenActor, "kitchenIds" | "kitchenId">): string[] | null {
  if (actor.kitchenIds !== undefined) return actor.kitchenIds;
  return actor.kitchenId ? [actor.kitchenId] : null;
}

function requirePerm(actor: KitchenActor, ...perms: Permission[]) {
  if (!perms.some((p) => can(actor, p))) throw new KitchenError("You don't have permission to do that");
}

export function requireKitchenInScope(actor: Pick<KitchenActor, "kitchenIds" | "kitchenId">, kitchenId: string) {
  const ids = kitchenScopeOf(actor);
  if (ids && !ids.includes(kitchenId)) throw new KitchenError("That kitchen isn't in your scope");
}

// ───────────── orders and forecast ─────────────

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

/**
 * Ingredient quantity needed for `portions` of a recipe version (waste% grosses the quantity up).
 * @deprecated kept for callers/tests; it is `scaleRecipe(...).gross` from inventory.ts.
 */
export function bomNeed(lines: { quantity: number; wastePct: number }[], yieldPortions: number, portions: number) {
  return scaleRecipe(lines.map((l, i) => ({ ...l, ingredientId: String(i) })), yieldPortions, portions).map((l) => l.gross);
}

/** Current recipe version for each dish. */
async function recipeVersions(menuItemIds: string[]) {
  const recipes = await db.recipe.findMany({
    where: { menuItemId: { in: menuItemIds } },
    include: { currentVersion: { include: { ingredients: { include: { ingredient: true } } } } },
  });
  return new Map(recipes.filter((r) => r.currentVersion).map((r) => [r.menuItemId, r.currentVersion!]));
}

export type Requirement = { ingredientId: string; name: string; unit: StockUnit; need: number; onHand: number; short: number; reorderQty: number; costPerUnit: number; supplierId: string | null; supplierName: string | null; noRecipe?: boolean };
export type DishRequirement = { menuItemId: string; name: string; portions: number; yieldPortions: number | null; lines: { ingredientId: string; name: string; unit: StockUnit; net: number; gross: number }[] };

/**
 * Ingredient requirement for a set of dish portions vs stock on hand in this kitchen. Scaling is
 * inventory.ts `scaleRecipe` (the same maths `postBatchStock` and `recipeForProduction` use), so the plan,
 * the recipe page and the stock that is finally consumed agree.
 */
export async function requirements(kitchenId: string, dishPortions: { menuItemId: string; name: string; total: number }[]) {
  const versions = await recipeVersions(dishPortions.map((d) => d.menuItemId));
  const need = new Map<string, number>();
  const ingredients = new Map<string, { name: string; unit: StockUnit; reorderQty: number; costPerUnit: number; supplierId: string | null }>();
  const missingRecipe: string[] = [];
  const byDish: DishRequirement[] = [];
  for (const d of dishPortions) {
    const v = versions.get(d.menuItemId);
    if (!v || !v.ingredients.length) {
      missingRecipe.push(d.name);
      byDish.push({ menuItemId: d.menuItemId, name: d.name, portions: d.total, yieldPortions: null, lines: [] });
      continue;
    }
    const scaled = scaleRecipe(v.ingredients, v.yieldPortions, d.total);
    for (const l of scaled) {
      need.set(l.ingredientId, (need.get(l.ingredientId) ?? 0) + l.gross);
      ingredients.set(l.ingredientId, { name: l.ingredient.name, unit: l.ingredient.unit, reorderQty: l.ingredient.reorderQty, costPerUnit: l.ingredient.costPerUnit, supplierId: l.ingredient.supplierId });
    }
    byDish.push({ menuItemId: d.menuItemId, name: d.name, portions: d.total, yieldPortions: v.yieldPortions, lines: scaled.map((l) => ({ ingredientId: l.ingredientId, name: l.ingredient.name, unit: l.ingredient.unit, net: round3(l.net), gross: round3(l.gross) })) });
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
  return { rows, byDish, missingRecipe, estimatedCost: Math.round(rows.reduce((a, r) => a + r.need * r.costPerUnit, 0)) };
}

/** Requirements over the next `days` days (planning horizon): per-day demand plus the combined ingredient need. */
export async function requirementsHorizon(kitchenId: string, from: string, days: number, bufferPct = 5) {
  const n = Math.max(1, Math.min(14, Math.floor(days)));
  const perDay: { date: string; orders: number; meals: number; pendingPayment: number }[] = [];
  const dishTotals = new Map<string, { menuItemId: string; name: string; total: number }>();
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    const f = await forecast(kitchenId, date, bufferPct);
    perDay.push({ date, orders: f.orders, meals: f.meals, pendingPayment: f.pendingPayment });
    for (const d of f.dishes) {
      const t = dishTotals.get(d.menuItemId) ?? { menuItemId: d.menuItemId, name: d.name, total: 0 };
      t.total += d.total;
      dishTotals.set(d.menuItemId, t);
    }
  }
  const req = await requirements(kitchenId, [...dishTotals.values()]);
  return { from, to: addDays(from, n - 1), days: n, perDay, ...req };
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

const BATCH_NEXT: Record<BatchStatus, BatchStatus[]> = { PLANNED: ["COOKING", "CANCELLED"], COOKING: ["DONE", "CANCELLED"], DONE: [], CANCELLED: [] };

export type BatchShortage = { ingredientId: string; name: string; type: "USAGE" | "WASTE"; shortage: number };

/**
 * Move a batch along. DONE records actual + waste portions and posts USAGE (and WASTE) to the stock
 * ledger exactly once (unique idempotency keys), so a double tap or retry never double-deducts.
 * Returns the ingredients that weren't in stock when the batch was posted (recorded, never hidden).
 */
export async function advanceBatch(batchId: string, to: BatchStatus, actorId: string, data: { actualPortions?: number; wastePortions?: number; assignedTo?: string; notes?: string } = {}): Promise<{ shortages: BatchShortage[] }> {
  const b = await db.productionBatch.findUniqueOrThrow({ where: { id: batchId }, include: { menuItem: true } });
  if (b.status !== to && !BATCH_NEXT[b.status].includes(to)) throw new KitchenError(`Batch is ${b.status.toLowerCase()} — can't move to ${to.toLowerCase()}`);
  if (to === "CANCELLED" && b.status !== "CANCELLED" && !data.notes?.trim()) throw new KitchenError("Say why the batch is cancelled");
  if (to === "DONE") {
    const actual = data.actualPortions ?? b.plannedPortions + b.bufferPortions;
    const waste = data.wastePortions ?? 0;
    if (actual < 0 || waste < 0 || waste > actual) throw new KitchenError("Check the portion counts");
    const r = await db.$transaction(async (tx) => {
      if (b.status !== "DONE") await tx.productionBatch.update({ where: { id: b.id }, data: { status: "DONE", actualPortions: actual, wastePortions: waste, completedAt: b.completedAt ?? new Date(), notes: data.notes ?? b.notes } });
      return postBatchStock(tx, b.id, actorId);
    });
    return { shortages: r.shortages };
  }
  await db.productionBatch.update({
    where: { id: b.id },
    data: { status: to, startedAt: to === "COOKING" ? b.startedAt ?? new Date() : b.startedAt, assignedTo: data.assignedTo ?? b.assignedTo, notes: data.notes ?? b.notes },
  });
  if (to === "CANCELLED" && b.status !== "CANCELLED") await audit({ actorId, action: "kitchen.batch_cancel", entity: "ProductionBatch", entityId: b.id, summary: `${b.menuItem.name} (${b.plannedPortions + b.bufferPortions} portions)`, reason: data.notes ?? null, before: { status: b.status }, after: { status: to } });
  return { shortages: [] };
}

/** Moved to inventory.ts in WP-08 (FEFO lot consumption); re-exported so existing imports keep working. */
export { postBatchStock };

/** Shortages recorded on the stock ledger by finished batches of a kitchen-day (SHORTAGE notes on USAGE/WASTE rows). */
export async function batchShortages(kitchenId: string, date: string) {
  const batches = await db.productionBatch.findMany({ where: { kitchenId, date: dateOnly(date) }, select: { id: true, menuItem: { select: { name: true } } } });
  if (!batches.length) return [];
  const dish = new Map(batches.map((b) => [`batch:${b.id}`, { batchId: b.id, dish: b.menuItem.name }]));
  const rows = await db.stockMovement.findMany({
    where: { kitchenId, reference: { in: [...dish.keys()] }, note: { contains: "SHORTAGE:" } },
    include: { ingredient: { select: { name: true, unit: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => {
    const qty = Number(/SHORTAGE: ([\d.]+)/.exec(m.note ?? "")?.[1] ?? 0);
    const d = dish.get(m.reference!)!;
    return { batchId: d.batchId, dish: d.dish, ingredientId: m.ingredientId, name: m.ingredient.name, unit: m.ingredient.unit, type: m.type as "USAGE" | "WASTE", shortage: qty, at: m.createdAt };
  });
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

// ───────────── production dashboard (WP-07) ─────────────

const PACKED_OR_LATER: OrderStatus[] = ["PACKED", "OUT_FOR_DELIVERY", "DELIVERED"];
const NOT_STARTED: OrderStatus[] = ["SCHEDULED", "CONFIRMED"];

export type ProductionIssue = { severity: "critical" | "warning" | "info"; message: string; href?: string };

/**
 * Everything the kitchen needs for one day in one read: meals by delivery slot, dishes grouped by recipe with
 * their batch, ingredient requirements (scaled recipes vs stock), batch progress, packing, ready for dispatch,
 * shortages (forecast + recorded on finished batches) and production issues, plus the cut-off and capacity.
 * Counts come from the same `kitchenOrders` set as the board, so they match booked orders.
 */
export async function productionDashboard(kitchenId: string, date: string, opts: { bufferPct?: number } = {}) {
  const bufferPct = opts.bufferPct ?? 5;
  const [settings, kitchen, lock, f, orders, batches, qcFails, offers, cap, booked, recorded] = await Promise.all([
    getSettings(),
    db.kitchen.findUniqueOrThrow({ where: { id: kitchenId }, select: { id: true, name: true, isActive: true, status: true, statusNote: true, workingDays: true, openTime: true, closeTime: true } }),
    db.dayLock.findUnique({ where: { kitchenId_date: { kitchenId, date: dateOnly(date) } } }),
    forecast(kitchenId, date, bufferPct),
    kitchenOrders(kitchenId, date),
    db.productionBatch.findMany({ where: { kitchenId, date: dateOnly(date) }, include: { menuItem: { select: { name: true } } }, orderBy: [{ station: "asc" }, { plannedPortions: "desc" }] }),
    db.qcLog.findMany({ where: { kitchenId, date: dateOnly(date), result: "FAIL" }, orderBy: { createdAt: "desc" } }),
    getOffersForDates([date], kitchenId).catch(() => new Map()),
    dayCapacity(kitchenId, date),
    mealsBooked(kitchenId, date),
    batchShortages(kitchenId, date),
  ]);
  const req = await requirements(kitchenId, f.dishes.map((d) => ({ menuItemId: d.menuItemId, name: d.name, total: d.total })));

  // cut-off: the menu day's override (if any) or the global one; earliest wins
  const offerCutoff: string | null = (offers.get(date) as { cutoff?: string | null } | undefined)?.cutoff ?? null;
  const cutoff = offerCutoff && offerCutoff < settings.orderCutoff ? offerCutoff : settings.orderCutoff;
  const now = ktmNow();
  const afterCutoff = date < now.date || (date === now.date && now.time >= cutoff);

  // meals by delivery slot
  const slots = new Map<string, { slot: string; orders: number; meals: number; notStarted: number; preparing: number; packed: number; ready: number; dispatched: number }>();
  for (const o of orders) {
    const key = o.slotLabel ?? "Any time";
    const s = slots.get(key) ?? { slot: key, orders: 0, meals: 0, notStarted: 0, preparing: 0, packed: 0, ready: 0, dispatched: 0 };
    s.orders++;
    s.meals += o.items.reduce((a, i) => a + i.quantity, 0);
    if (NOT_STARTED.includes(o.status)) s.notStarted++;
    if (o.status === "PREPARING") s.preparing++;
    if (PACKED_OR_LATER.includes(o.status)) s.packed++;
    if (o.status === "PACKED") s.ready++;
    if (o.status === "OUT_FOR_DELIVERY" || o.status === "DELIVERED") s.dispatched++;
    slots.set(key, s);
  }

  // batches + preparation progress (cancelled batches don't count)
  const live = batches.filter((b) => b.status !== "CANCELLED");
  const plannedPortions = live.reduce((a, b) => a + b.plannedPortions + b.bufferPortions, 0);
  const donePortions = live.filter((b) => b.status === "DONE").reduce((a, b) => a + b.plannedPortions + b.bufferPortions, 0);
  const batchOf = new Map(batches.map((b) => [b.menuItemId, b]));
  const missing = new Set(req.missingRecipe);
  const dishes = f.dishes.map((d) => {
    const b = batchOf.get(d.menuItemId);
    const r = req.byDish.find((x) => x.menuItemId === d.menuItemId);
    return { ...d, hasRecipe: !missing.has(d.name), batch: b ? { id: b.id, status: b.status, planned: b.plannedPortions + b.bufferPortions, actual: b.actualPortions, waste: b.wastePortions, stale: b.status === "PLANNED" && b.plannedPortions !== d.portions } : null, lines: r?.lines ?? [] };
  });

  // packing
  const packed = orders.filter((o) => PACKED_OR_LATER.includes(o.status)).length;
  const failedChecks = orders.filter((o) => !PACKED_OR_LATER.includes(o.status) && o.packing[0] && !(o.packing[0].itemsOk && o.packing[0].labelOk && o.packing[0].allergenOk && o.packing[0].sealedOk));
  const ready = orders.filter((o) => o.status === "PACKED");
  const unprinted = orders.filter((o) => !o.ticket?.printedAt).length;

  const forecastShort = req.rows.filter((r) => r.short > 0);
  const issues: ProductionIssue[] = [];
  const gate = kitchenOrderProblem(kitchen, date);
  if (gate) issues.push({ severity: "warning", message: `${gate} — existing orders below still need cooking.` });
  if (booked > cap) issues.push({ severity: "critical", message: `Over capacity: ${booked} meals booked, limit ${cap}.` });
  if (forecastShort.length) issues.push({ severity: "critical", message: `${forecastShort.length} ingredient(s) short for this day: ${forecastShort.slice(0, 4).map((r) => r.name).join(", ")}${forecastShort.length > 4 ? "…" : ""}`, href: `/admin/kitchen/requirements?kitchen=${kitchenId}&date=${date}` });
  if (recorded.length) issues.push({ severity: "critical", message: `Finished batches used stock that wasn't there: ${[...new Set(recorded.map((r) => r.name))].join(", ")} — count and correct the stock.` });
  if (req.missingRecipe.length) issues.push({ severity: "warning", message: `No recipe for ${req.missingRecipe.join(", ")} — ingredients not planned or deducted.` });
  if (f.pendingPayment) issues.push({ severity: "info", message: `${f.pendingPayment} order(s) still awaiting payment (not counted).` });
  if (afterCutoff && !lock && f.orders) issues.push({ severity: "warning", message: `Cut-off ${cutoff} has passed and the day isn't locked.` });
  if (lock && live.length === 0 && f.meals) issues.push({ severity: "warning", message: "Day locked but no batches planned." });
  if (dishes.some((d) => d.batch?.stale)) issues.push({ severity: "info", message: "Some planned batches no longer match the orders — refresh the plan." });
  if (dishes.some((d) => !d.batch) && live.length) issues.push({ severity: "warning", message: "Some dishes have no batch — refresh the plan." });
  for (const q of qcFails) issues.push({ severity: "critical", message: `QC failed (${q.type.toLowerCase()}): ${q.note ?? ""}`, href: `/admin/kitchen/qc?kitchen=${kitchenId}&date=${date}` });
  if (failedChecks.length) issues.push({ severity: "warning", message: `${failedChecks.length} order(s) failed their last packing check.` });
  if (lock && unprinted) issues.push({ severity: "info", message: `${unprinted} ticket(s) not printed yet.`, href: `/admin/kitchen/tickets?kitchen=${kitchenId}&date=${date}` });
  for (const b of batches.filter((x) => x.status === "CANCELLED")) issues.push({ severity: "warning", message: `Batch cancelled: ${b.menuItem.name}${b.notes ? ` — ${b.notes}` : ""}` });

  return {
    kitchen,
    date,
    bufferPct,
    cutoff,
    afterCutoff,
    lock,
    capacity: { limit: cap, booked, left: Math.max(0, cap - booked) },
    forecast: f,
    totals: { orders: orders.length, meals: f.meals },
    orders,
    bySlot: [...slots.values()],
    dishes,
    requirements: req,
    batches,
    progress: {
      batches: live.length,
      planned: live.filter((b) => b.status === "PLANNED").length,
      cooking: live.filter((b) => b.status === "COOKING").length,
      done: live.filter((b) => b.status === "DONE").length,
      cancelled: batches.length - live.length,
      plannedPortions,
      donePortions,
      pct: plannedPortions ? Math.round((donePortions / plannedPortions) * 100) : 0,
    },
    packing: { total: orders.length, packed, notStarted: orders.filter((o) => NOT_STARTED.includes(o.status)).length, preparing: orders.filter((o) => o.status === "PREPARING").length, failedChecks: failedChecks.length, pct: orders.length ? Math.round((packed / orders.length) * 100) : 0 },
    readyForDispatch: ready.map((o) => ({ id: o.id, code: o.code, number: o.number, slot: o.slotLabel, area: o.area })),
    tickets: { total: orders.length, printed: orders.length - unprinted, unprinted },
    shortages: { forecast: forecastShort, recorded },
    issues,
  };
}

// ───────────── kitchen profile, status, manager, staff (WP-07) ─────────────

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Upcoming orders still to cook at a kitchen (today onward). */
export async function upcomingOrders(kitchenId: string) {
  return db.order.count({ where: { kitchenId, deliveryDate: { gte: dateOnly(todayKTM()) }, status: { in: ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING"] } } });
}

/**
 * Open, pause or shut down a kitchen. PAUSED/CLOSED stop new orders (enforced in capacity.assertDayCapacity);
 * existing orders are kept and counted so staff can move or cancel them. Pausing/reopening a pause needs
 * kitchen.approve or rules.edit; shutting down or reopening a shutdown needs rules.edit. Always audited.
 */
export async function setKitchenStatus(actor: KitchenActor, kitchenId: string, status: KitchenStatus, reason?: string | null) {
  if (!["OPEN", "PAUSED", "CLOSED"].includes(status)) throw new KitchenError("Unknown kitchen status");
  const k = await db.kitchen.findUnique({ where: { id: kitchenId }, select: { id: true, name: true, status: true, statusNote: true } });
  if (!k) throw new KitchenError("Kitchen not found");
  if (status === "CLOSED" || k.status === "CLOSED") requirePerm(actor, "rules.edit");
  else requirePerm(actor, "rules.edit", "kitchen.approve");
  requireKitchenInScope(actor, kitchenId);
  const note = reason?.trim().slice(0, 300) || null;
  if (status !== "OPEN" && (!note || note.length < 3)) throw new KitchenError("Give a reason — customers and the audit log see it");
  if (k.status === status && (k.statusNote ?? null) === (status === "OPEN" ? null : note)) return { changed: false, upcoming: await upcomingOrders(kitchenId) };
  await db.kitchen.update({ where: { id: kitchenId }, data: { status, statusNote: status === "OPEN" ? null : note } });
  const upcoming = await upcomingOrders(kitchenId);
  const action = status === "OPEN" ? "kitchen.reopen" : status === "PAUSED" ? "kitchen.pause" : "kitchen.shutdown";
  await audit({ actorId: actor.id, action, entity: "Kitchen", entityId: kitchenId, summary: `${k.name}: ${k.status} → ${status}${upcoming ? ` (${upcoming} upcoming orders kept)` : ""}`, before: { status: k.status, statusNote: k.statusNote }, after: { status, statusNote: status === "OPEN" ? null : note, upcomingOrders: upcoming }, reason: note });
  return { changed: true, upcoming };
}

/** Working hours and days (audited). Empty workingDays = every service day. */
export async function saveKitchenHours(actor: KitchenActor, kitchenId: string, input: { openTime?: string | null; closeTime?: string | null; workingDays: Weekday[] }) {
  requirePerm(actor, "rules.edit");
  requireKitchenInScope(actor, kitchenId);
  const openTime = input.openTime?.trim() || null;
  const closeTime = input.closeTime?.trim() || null;
  if ((openTime && !TIME.test(openTime)) || (closeTime && !TIME.test(closeTime))) throw new KitchenError("Times must be HH:MM (24h)");
  if (openTime && closeTime && closeTime <= openTime) throw new KitchenError("Closing time must be after opening time");
  const workingDays = WEEKDAYS.filter((d) => input.workingDays.includes(d));
  const before = await db.kitchen.findUniqueOrThrow({ where: { id: kitchenId }, select: { openTime: true, closeTime: true, workingDays: true } });
  const after = { openTime, closeTime, workingDays };
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  await db.kitchen.update({ where: { id: kitchenId }, data: after });
  await audit({ actorId: actor.id, action: "kitchen.hours", entity: "Kitchen", entityId: kitchenId, summary: `${openTime ?? "—"}–${closeTime ?? "—"} · ${workingDays.length ? workingDays.join(" ") : "every service day"}`, before, after });
  return true;
}

/** Staff linked to a kitchen: primary kitchen (User.kitchenId) or an extra StaffScope row. */
export async function kitchenStaff(kitchenId: string) {
  const users = await db.user.findMany({
    where: { role: { notIn: ["CUSTOMER"] }, OR: [{ kitchenId }, { scopes: { some: { kitchenId } } }] },
    select: { id: true, name: true, email: true, role: true, kitchenId: true, isActive: true, staffRole: { select: { name: true } }, scopes: { select: { kitchenId: true } } },
    orderBy: { name: "asc" },
  });
  return users.filter((u) => isStaffRole(u.role)).map((u) => ({ ...u, primary: u.kitchenId === kitchenId, kitchens: new Set([u.kitchenId, ...u.scopes.map((s) => s.kitchenId)].filter(Boolean)).size }));
}

/** Kitchen manager (must be a staff member who can work in this kitchen). Audited before/after. */
export async function assignKitchenManager(actor: KitchenActor, kitchenId: string, managerId: string | null) {
  requirePerm(actor, "rules.edit");
  requireKitchenInScope(actor, kitchenId);
  const k = await db.kitchen.findUniqueOrThrow({ where: { id: kitchenId }, select: { name: true, managerId: true } });
  if ((k.managerId ?? null) === (managerId ?? null)) return false;
  let manager: { id: string; name: string; email: string } | null = null;
  if (managerId) {
    const u = await db.user.findUnique({ where: { id: managerId }, include: { scopes: { select: { kitchenId: true } } } });
    if (!u || !isStaffRole(u.role)) throw new KitchenError("The manager must be a staff member");
    if (!u.isActive) throw new KitchenError("That account is disabled");
    const scope = [u.kitchenId, ...u.scopes.map((s) => s.kitchenId)].filter(Boolean) as string[];
    if (scope.length && !scope.includes(kitchenId)) throw new KitchenError(`${u.name} can't access this kitchen — assign them to it first`);
    manager = { id: u.id, name: u.name, email: u.email };
  }
  const before = k.managerId ? await db.user.findUnique({ where: { id: k.managerId }, select: { id: true, name: true } }) : null;
  await db.kitchen.update({ where: { id: kitchenId }, data: { managerId: manager?.id ?? null } });
  await audit({ actorId: actor.id, action: "kitchen.manager", entity: "Kitchen", entityId: kitchenId, summary: `${k.name}: ${before?.name ?? "none"} → ${manager?.name ?? "none"}`, before: { managerId: before?.id ?? null, name: before?.name ?? null }, after: { managerId: manager?.id ?? null, name: manager?.name ?? null } });
  return true;
}

async function currentScopes(userId: string) {
  const rows = await db.staffScope.findMany({ where: { userId }, select: { kitchenId: true, companyId: true } });
  return { kitchenIds: rows.map((r) => r.kitchenId).filter(Boolean) as string[], companyIds: rows.map((r) => r.companyId).filter(Boolean) as string[] };
}

/**
 * Add a staff member to a kitchen (an extra StaffScope row through access.setScopes, which checks staff.edit,
 * escalation and audits `staff.scope`). Note: a staff member with no scope sees every kitchen; once assigned they
 * see only their assigned kitchens.
 */
export async function assignStaffToKitchen(actor: KitchenActor & { role: Role }, kitchenId: string, userId: string) {
  requireKitchenInScope(actor, kitchenId);
  const u = await db.user.findUnique({ where: { id: userId }, select: { kitchenId: true } });
  if (!u) throw new KitchenError("Staff member not found");
  if (u.kitchenId === kitchenId) return false;
  const s = await currentScopes(userId);
  if (s.kitchenIds.includes(kitchenId)) return false;
  await setScopes(actor as AccessActor, userId, { kitchenIds: [...s.kitchenIds, kitchenId], companyIds: s.companyIds });
  return true;
}

/** Remove a kitchen scope row. Refuses to remove someone's primary kitchen or their last kitchen (that would mean "all kitchens"). */
export async function removeStaffFromKitchen(actor: KitchenActor & { role: Role }, kitchenId: string, userId: string) {
  requireKitchenInScope(actor, kitchenId);
  const u = await db.user.findUnique({ where: { id: userId }, select: { kitchenId: true } });
  if (!u) throw new KitchenError("Staff member not found");
  if (u.kitchenId === kitchenId) throw new KitchenError("This is their primary kitchen — change it on the staff page");
  const s = await currentScopes(userId);
  if (!s.kitchenIds.includes(kitchenId)) return false;
  const rest = s.kitchenIds.filter((k) => k !== kitchenId);
  if (!rest.length && !u.kitchenId) throw new KitchenError("This is their only kitchen — removing it would give them every kitchen. Change it on the staff page.");
  await setScopes(actor as AccessActor, userId, { kitchenIds: rest, companyIds: s.companyIds });
  return true;
}

// ───────────── performance and operating costs (WP-07) ─────────────

/** Paisa of ingredients per portion of each dish's current recipe (gross, with trim waste). */
export async function dishCostPerPortion(menuItemIds: string[]) {
  const versions = await recipeVersions(menuItemIds);
  const out = new Map<string, number>();
  for (const [id, v] of versions) {
    if (!v.ingredients.length) continue;
    out.set(id, scaleRecipe(v.ingredients, v.yieldPortions, 1).reduce((a, l) => a + l.gross * l.ingredient.costPerUnit, 0));
  }
  return out;
}

/** Kathmandu wall-clock (date + HH:MM) → instant. */
function ktmInstant(date: string, time: string) {
  return new Date(`${date}T${time}:00+05:45`);
}

/**
 * Per-kitchen KPIs for [from, to] (delivery dates; stock movements by day), all computed from records:
 * - on-time packing: first PACKED event at or before the order's delivery-window start (orders with a window);
 *   not packed by then (and still unpacked) counts as late;
 * - QC pass rate from QcLog; waste % = WASTE cost / (USAGE + WASTE) cost on the stock ledger (+ batch portions);
 * - recipe cost per meal = Σ order components × current recipe cost per portion ÷ meals; actual = ledger cost ÷ meals;
 * - operating costs = approved/paid Expense rows for the kitchen (read-only; amounts before tax, paisa).
 */
export async function kitchenPerformance(kitchenId: string, from: string, to: string, opts: { now?: Date } = {}) {
  if (!isValidISODate(from) || !isValidISODate(to) || to < from) throw new KitchenError("Pick a valid date range");
  const range = { gte: dateOnly(from), lte: dateOnly(to) };
  const moved = { gte: dateOnly(from), lt: dateOnly(addDays(to, 1)) };
  const now = opts.now ?? new Date();
  const [orders, qc, movements, batches, expenses] = await Promise.all([
    db.order.findMany({
      where: { kitchenId, deliveryDate: range, status: { in: COOK_STATUSES } },
      select: { id: true, status: true, deliveryDate: true, slot: { select: { startTime: true } }, items: { select: { quantity: true, components: true } }, events: { where: { toStatus: "PACKED" }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } } },
    }),
    db.qcLog.groupBy({ by: ["result"], where: { kitchenId, date: range }, _count: { _all: true } }),
    db.stockMovement.findMany({ where: { kitchenId, type: { in: ["USAGE", "WASTE"] }, createdAt: moved }, select: { type: true, quantity: true, unitCost: true, ingredient: { select: { costPerUnit: true } } } }),
    db.productionBatch.findMany({ where: { kitchenId, date: range, status: "DONE" }, select: { actualPortions: true, wastePortions: true } }),
    db.expense.findMany({ where: { kitchenId, date: range, status: { in: ["APPROVED", "PAID"] } }, select: { amount: true, tax: true, category: { select: { key: true, name: true } } } }),
  ]);

  let meals = 0;
  let onTime = 0,
    late = 0,
    notPacked = 0;
  const dishQty = new Map<string, number>();
  for (const o of orders) {
    for (const it of o.items) {
      meals += it.quantity;
      for (const c of components(it.components)) dishQty.set(c.menuItemId, (dishQty.get(c.menuItemId) ?? 0) + (c.qty || 1) * it.quantity);
    }
    if (!o.slot?.startTime) continue;
    const deadline = ktmInstant(isoDate(o.deliveryDate), o.slot.startTime);
    const packedAt = o.events[0]?.createdAt;
    if (packedAt) {
      if (packedAt <= deadline) onTime++;
      else late++;
    } else if (deadline < now && !PACKED_OR_LATER.includes(o.status)) notPacked++;
  }
  const measured = onTime + late + notPacked;

  const pass = qc.find((r) => r.result === "PASS")?._count._all ?? 0;
  const fail = qc.find((r) => r.result === "FAIL")?._count._all ?? 0;

  let usageCost = 0,
    wasteCost = 0;
  for (const m of movements) {
    const cost = Math.abs(m.quantity) * (m.unitCost ?? m.ingredient.costPerUnit);
    if (m.type === "WASTE") wasteCost += cost;
    else usageCost += cost;
  }
  const cooked = batches.reduce((a, b) => a + (b.actualPortions ?? 0), 0);
  const wastedPortions = batches.reduce((a, b) => a + (b.wastePortions ?? 0), 0);

  const costs = await dishCostPerPortion([...dishQty.keys()]);
  let recipeCost = 0;
  const uncosted: string[] = [];
  for (const [id, q] of dishQty) {
    const c = costs.get(id);
    if (c == null) uncosted.push(id);
    else recipeCost += c * q;
  }

  const byCategory = new Map<string, { key: string; name: string; amount: number }>();
  for (const e of expenses) {
    const c = byCategory.get(e.category.key) ?? { key: e.category.key, name: e.category.name, amount: 0 };
    c.amount += e.amount;
    byCategory.set(e.category.key, c);
  }
  const opex = expenses.reduce((a, e) => a + e.amount, 0);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

  return {
    from,
    to,
    orders: orders.length,
    meals,
    onTimePacking: { onTime, late, notPacked, measured, pct: pct(onTime, measured) },
    qc: { pass, fail, total: pass + fail, passPct: pct(pass, pass + fail) },
    waste: { usageCost: Math.round(usageCost), wasteCost: Math.round(wasteCost), costPct: pct(wasteCost, usageCost + wasteCost), cookedPortions: cooked, wastedPortions, portionPct: pct(wastedPortions, cooked) },
    costPerMeal: { recipe: meals ? Math.round(recipeCost / meals) : null, recipeTotal: Math.round(recipeCost), actual: meals ? Math.round((usageCost + wasteCost) / meals) : null, uncostedDishes: uncosted.length },
    operatingCosts: { total: opex, perMeal: meals ? Math.round(opex / meals) : null, byCategory: [...byCategory.values()].sort((a, b) => b.amount - a.amount), count: expenses.length },
  };
}

/** Upcoming meals per day for the next `days` days (forecast strip on the kitchen pages). */
export async function mealsAhead(kitchenId: string, from: string, days = 7) {
  const to = addDays(from, Math.max(1, days) - 1);
  const rows = await db.orderItem.groupBy({ by: ["orderId"], where: { order: { kitchenId, deliveryDate: { gte: dateOnly(from), lte: dateOnly(to) }, status: { in: LIVE_STATUSES } } }, _sum: { quantity: true } });
  const ids = rows.map((r) => r.orderId);
  const orders = ids.length ? await db.order.findMany({ where: { id: { in: ids } }, select: { id: true, deliveryDate: true, status: true } }) : [];
  const byId = new Map(orders.map((o) => [o.id, o]));
  const out = new Map<string, { date: string; meals: number; pending: number }>();
  for (let i = 0; i < Math.max(1, days); i++) out.set(addDays(from, i), { date: addDays(from, i), meals: 0, pending: 0 });
  for (const r of rows) {
    const o = byId.get(r.orderId);
    if (!o) continue;
    const d = out.get(isoDate(o.deliveryDate));
    if (!d) continue;
    if (o.status === "PENDING_PAYMENT") d.pending += r._sum.quantity ?? 0;
    else d.meals += r._sum.quantity ?? 0;
  }
  return [...out.values()];
}
