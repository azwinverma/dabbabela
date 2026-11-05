import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, dateOnly, todayKTM } from "@/lib/dates";
import { advanceBatch } from "@/server/kitchen";
import {
  STANDARD_CONVERSIONS,
  convertQty,
  createPurchaseOrder,
  expiringLotAlerts,
  inventoryAlerts,
  lateDeliveryAlerts,
  lowStockAlerts,
  moveLot,
  postBatchStock,
  receivePurchase,
  recordMovement,
  returnToSupplier,
  saveConversion,
  saveLocation,
  scaleRecipe,
  setPurchaseStatus,
  stockDiscrepancyAlerts,
  stockOnHand,
  stockValuation,
  toBaseUnits,
  transferStock,
  listTransfers,
  type InvActor,
} from "@/server/inventory";

let owner: InvActor;
let kA: string;
let kB: string;
let supplierId: string;
const today = todayKTM();

async function ingredient(name: string, extra: Partial<{ unit: "KG" | "G" | "L" | "ML" | "PC" | "PACK"; costPerUnit: number; purchaseUnit: "PACK" | "KG" | null; purchaseFactor: number; reorderPoint: number | null; safetyStock: number }> = {}) {
  return db.ingredient.create({ data: { name, unit: "KG", costPerUnit: 10000, allergenCodes: [], ...extra } });
}
const onHand = async (k: string, id: string) => (await stockOnHand(k, [id])).get(id) ?? 0;
const lotsOf = (k: string, id: string) => db.stockLot.findMany({ where: { kitchenId: k, ingredientId: id }, orderBy: { receivedAt: "asc" } });

beforeAll(async () => {
  const o = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
  owner = { id: o.id, role: o.role, kitchenIds: null };
  kA = (await db.kitchen.findFirstOrThrow({ where: { code: "KTM-1" } })).id;
  kB = (await db.kitchen.create({ data: { name: "WP08 Patan kitchen", code: "WP08-B" } })).id;
  supplierId = (await db.supplier.findFirstOrThrow()).id;
});

describe("unit conversions", () => {
  it("converts through chains and inverses; refuses unknown pairs", () => {
    const edges = [{ fromUnit: "PACK" as const, toUnit: "KG" as const, factor: 25 }, ...STANDARD_CONVERSIONS];
    expect(convertQty(2, "PACK", "KG", edges)).toBe(50);
    expect(convertQty(1, "PACK", "G", edges)).toBe(25000);
    expect(convertQty(500, "G", "KG", edges)).toBeCloseTo(0.5, 9);
    expect(convertQty(12.5, "KG", "PACK", edges)).toBeCloseTo(0.5, 9);
    expect(() => convertQty(1, "PC", "KG", edges)).toThrow(/No conversion/);
  });

  it("buys in sacks, stores in kg: PO + receipt convert quantity and cost", async () => {
    const rice = await ingredient("WP08 Rice", { purchaseUnit: "PACK", purchaseFactor: 25, costPerUnit: 9000 });
    expect((await toBaseUnits(rice.id, 3, "PACK")).qty).toBe(75);
    expect((await toBaseUnits(rice.id, 2000, "G")).qty).toBe(2);
    // a per-ingredient DB conversion takes part too
    await saveConversion(owner, { ingredientId: rice.id, fromUnit: "PC", toUnit: "KG", factor: 1 });
    expect((await toBaseUnits(rice.id, 4, "PC")).qty).toBe(4);

    const po = await createPurchaseOrder({ supplierId, kitchenId: kA, lines: [{ ingredientId: rice.id, quantity: 2, unit: "PACK", unitCost: 250000 }], actorId: owner.id });
    expect(po.total).toBe(500000);
    const line = await db.purchaseOrderLine.findFirstOrThrow({ where: { poId: po.id } });
    expect(line.quantity).toBe(50);
    expect(line.unitCost).toBe(10000); // Rs 2500 per sack = Rs 100 per kg
    await setPurchaseStatus(po.id, "SENT");
    const r = await receivePurchase(po.id, owner.id, [{ lineId: line.id, quantity: 1, unit: "PACK", unitCost: 260000, expiresOn: addDays(today, 90) }]);
    expect(r.status).toBe("PARTIAL");
    expect(await onHand(kA, rice.id)).toBe(25);
    const [lot] = await lotsOf(kA, rice.id);
    expect(lot).toMatchObject({ receivedQty: 25, remainingQty: 25, unitCost: 10400, poLineId: line.id });
    await expect(receivePurchase(po.id, owner.id, [{ lineId: line.id, quantity: 2, unit: "PACK" }])).rejects.toThrow(/Only 25/);
  });
});

describe("lots and FEFO", () => {
  it("consumes the earliest expiry first across lots, then unlotted stock, and records a shortage", async () => {
    const paneer = await ingredient("WP08 Paneer", { costPerUnit: 50000 });
    await recordMovement({ ingredientId: paneer.id, kitchenId: kA, type: "RECEIPT", quantity: 5, unitCost: 60000, expiresOn: addDays(today, 10), actorId: owner.id });
    await recordMovement({ ingredientId: paneer.id, kitchenId: kA, type: "RECEIPT", quantity: 3, unitCost: 55000, expiresOn: addDays(today, 2), actorId: owner.id });
    await recordMovement({ ingredientId: paneer.id, kitchenId: kA, type: "RECEIPT", quantity: 4, unitCost: 50000, actorId: owner.id });
    await recordMovement({ ingredientId: paneer.id, kitchenId: kA, type: "ADJUSTMENT", quantity: 1, note: "count found an extra kg", actorId: owner.id }); // unlotted
    expect(await onHand(kA, paneer.id)).toBe(13);

    const use = await recordMovement({ ingredientId: paneer.id, kitchenId: kA, type: "USAGE", quantity: 6, actorId: owner.id });
    expect(use.quantity).toBe(-6);
    expect(use.movements.map((m) => m.quantity)).toEqual([-3, -3]);
    const lots = await lotsOf(kA, paneer.id);
    const byExp = (d: number | null) => lots.find((l) => (d == null ? l.expiresOn == null : l.expiresOn?.getTime() === dateOnly(addDays(today, d)).getTime()))!;
    expect(byExp(2).remainingQty).toBe(0); // earliest expiry emptied first
    expect(byExp(10).remainingQty).toBe(2);
    expect(byExp(null).remainingQty).toBe(4); // no-expiry lot last

    // 2 + 4 in lots + 1 unlotted = 7 on hand; taking 9 leaves a recorded 2 kg shortage
    const big = await recordMovement({ ingredientId: paneer.id, kitchenId: kA, type: "USAGE", quantity: 9, actorId: owner.id });
    expect(big.shortage).toBe(2);
    expect(big.movements.map((m) => m.quantity)).toEqual([-2, -4, -3]);
    expect(big.movements[2].lotId).toBeNull();
    expect(big.movements[2].note).toMatch(/SHORTAGE: 2 kg/);
    expect(await onHand(kA, paneer.id)).toBe(-2);
    expect((await lotsOf(kA, paneer.id)).every((l) => l.remainingQty >= 0)).toBe(true);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "stock.shortage", entityId: big.movements[0].id } });
    expect(log.after).toMatchObject({ shortage: 2 });
    const disc = await stockDiscrepancyAlerts([kA]);
    expect(disc.some((a) => a.type === "STOCK_SHORTAGE" && a.entityId === paneer.id)).toBe(true);
  });

  it("batch production consumes lots FEFO, flags shortage, and stays idempotent per batch", async () => {
    const dal = await ingredient("WP08 Dal", { costPerUnit: 15000 });
    const salt = await ingredient("WP08 Salt", { costPerUnit: 2000 });
    await recordMovement({ ingredientId: dal.id, kitchenId: kA, type: "RECEIPT", quantity: 1, unitCost: 16000, expiresOn: addDays(today, 30), actorId: owner.id });
    await recordMovement({ ingredientId: dal.id, kitchenId: kA, type: "RECEIPT", quantity: 1, unitCost: 14000, expiresOn: addDays(today, 5), actorId: owner.id });
    const item = await db.menuItem.create({ data: { name: "WP08 Dal tadka", category: "MAIN" } });
    const recipe = await db.recipe.create({ data: { menuItemId: item.id } });
    // 10 portions use 1.2 kg dal (10% trim → 1.333 gross) and 0.05 kg salt
    const v = await db.recipeVersion.create({ data: { recipeId: recipe.id, version: 1, yieldPortions: 10, ingredients: { create: [{ ingredientId: dal.id, quantity: 1.2, wastePct: 10 }, { ingredientId: salt.id, quantity: 0.05 }] } } });
    await db.recipe.update({ where: { id: recipe.id }, data: { currentVersionId: v.id } });

    const scaled = scaleRecipe([{ ingredientId: dal.id, quantity: 1.2, wastePct: 10 }], 10, 15);
    expect(scaled[0].net).toBeCloseTo(1.8, 9);
    expect(scaled[0].gross).toBeCloseTo(2, 9);

    const batch = await db.productionBatch.create({ data: { kitchenId: kA, date: dateOnly(addDays(today, 40)), menuItemId: item.id, plannedPortions: 15, recipeVersionId: v.id } });
    await advanceBatch(batch.id, "COOKING", owner.id);
    await advanceBatch(batch.id, "DONE", owner.id, { actualPortions: 15, wastePortions: 0 });
    // retry / double tap: no new rows
    await advanceBatch(batch.id, "DONE", owner.id, { actualPortions: 15, wastePortions: 0 });
    const again = await db.$transaction((tx) => postBatchStock(tx, batch.id, owner.id));
    expect(again.rows).toBe(0);

    const dalRows = await db.stockMovement.findMany({ where: { reference: `batch:${batch.id}`, ingredientId: dal.id }, orderBy: { idempotencyKey: "asc" } });
    expect(dalRows.map((r) => r.idempotencyKey)).toEqual([`batch:${batch.id}:usage:${dal.id}`, `batch:${batch.id}:usage:${dal.id}:2`]);
    expect(dalRows.map((r) => r.unitCost)).toEqual([14000, 16000]); // the day-5 lot went first
    expect(dalRows.reduce((a, r) => a + r.quantity, 0)).toBeCloseTo(-2, 3);
    expect((await lotsOf(kA, dal.id)).map((l) => l.remainingQty)).toEqual([0, 0]);

    const saltRows = await db.stockMovement.findMany({ where: { reference: `batch:${batch.id}`, ingredientId: salt.id } });
    expect(saltRows).toHaveLength(1);
    expect(saltRows[0].note).toMatch(/SHORTAGE/);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "stock.shortage", entityId: batch.id } });
    expect((log.after as { shortages: { ingredientId: string }[] }).shortages.map((s) => s.ingredientId)).toEqual([salt.id]);
    expect((await db.productionBatch.findUniqueOrThrow({ where: { id: batch.id } })).stockPosted).toBe(true);
  });
});

describe("locations and transfers", () => {
  it("moves stock between kitchens atomically with matching OUT/IN, lots and cost", async () => {
    const oil = await ingredient("WP08 Oil", { unit: "L", costPerUnit: 30000 });
    const loc = await saveLocation(owner, { kitchenId: kB, name: "WP08 Dry store" });
    await expect(saveLocation(owner, { kitchenId: kB, name: "WP08 Dry store" })).rejects.toThrow(/already/);
    await recordMovement({ ingredientId: oil.id, kitchenId: kA, type: "RECEIPT", quantity: 4, unitCost: 32000, expiresOn: addDays(today, 60), actorId: owner.id });
    await recordMovement({ ingredientId: oil.id, kitchenId: kA, type: "RECEIPT", quantity: 6, unitCost: 31000, expiresOn: addDays(today, 20), actorId: owner.id });

    const t = await transferStock(owner, { fromKitchenId: kA, toKitchenId: kB, lines: [{ ingredientId: oil.id, quantity: 7 }], note: "Patan short on oil", toLocationId: loc.id });
    expect(t.status).toBe("RECEIVED");
    expect(t.value).toBe(6 * 31000 + 1 * 32000);
    const moves = await db.stockMovement.findMany({ where: { transferId: t.id } });
    const out = moves.filter((m) => m.type === "TRANSFER_OUT");
    const inn = moves.filter((m) => m.type === "TRANSFER_IN");
    expect(out.every((m) => m.kitchenId === kA) && inn.every((m) => m.kitchenId === kB)).toBe(true);
    expect(out.reduce((a, m) => a + m.quantity, 0) + inn.reduce((a, m) => a + m.quantity, 0)).toBeCloseTo(0, 6);
    expect(await onHand(kA, oil.id)).toBe(3);
    expect(await onHand(kB, oil.id)).toBe(7);
    const destLots = await lotsOf(kB, oil.id);
    expect(destLots.map((l) => [l.remainingQty, l.unitCost, l.locationId])).toEqual(expect.arrayContaining([[6, 31000, loc.id], [1, 32000, loc.id]]));

    // too much → whole transfer refused, nothing written
    const countBefore = await db.stockMovement.count({ where: { ingredientId: oil.id } });
    await expect(transferStock(owner, { fromKitchenId: kA, toKitchenId: kB, lines: [{ ingredientId: oil.id, quantity: 5 }] })).rejects.toThrow(/Only 3 l/);
    expect(await db.stockMovement.count({ where: { ingredientId: oil.id } })).toBe(countBefore);
    expect(await db.stockTransfer.count({ where: { lines: { some: { ingredientId: oil.id } } } })).toBe(1);

    // concurrent transfers of the same 3 l: exactly one wins, lots never go negative
    const results = await Promise.allSettled([
      transferStock(owner, { fromKitchenId: kA, toKitchenId: kB, lines: [{ ingredientId: oil.id, quantity: 2 }] }),
      transferStock(owner, { fromKitchenId: kA, toKitchenId: kB, lines: [{ ingredientId: oil.id, quantity: 2 }] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await onHand(kA, oil.id)).toBe(1);
    expect((await lotsOf(kA, oil.id)).every((l) => l.remainingQty >= 0)).toBe(true);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "stock.transfer", entityId: t.id } });
    expect(audit.reason).toBe("Patan short on oil");
    expect(audit.before).toBeTruthy();
  });

  it("refuses transfers and actions outside the actor's kitchen scope or permission", async () => {
    const flour = await ingredient("WP08 Flour");
    await recordMovement({ ingredientId: flour.id, kitchenId: kA, type: "RECEIPT", quantity: 10, actorId: owner.id });
    const u = await db.user.create({ data: { name: "WP08 store keeper B", email: "wp08-stores-b@test.local", role: "INVENTORY_MANAGER", kitchenId: kB } });
    const scoped: InvActor = { id: u.id, role: "INVENTORY_MANAGER", kitchenIds: [kB] };
    await expect(transferStock(scoped, { fromKitchenId: kA, toKitchenId: kB, lines: [{ ingredientId: flour.id, quantity: 1 }] })).rejects.toThrow(/scope/);
    await expect(saveLocation(scoped, { kitchenId: kA, name: "Sneaky shelf" })).rejects.toThrow(/scope/);
    const lot = (await lotsOf(kA, flour.id))[0];
    await expect(moveLot(scoped, lot.id, null)).rejects.toThrow(/scope/);
    const support: InvActor = { id: u.id, role: "SUPPORT", kitchenIds: null };
    await expect(transferStock(support, { fromKitchenId: kA, toKitchenId: kB, lines: [{ ingredientId: flour.id, quantity: 1 }] })).rejects.toThrow(/permission/);
    expect(await onHand(kA, flour.id)).toBe(10);
    // listing only shows transfers touching kitchen B
    const list = await listTransfers(scoped);
    expect(list.every((t) => t.fromKitchenId === kB || t.toKitchenId === kB)).toBe(true);
    await expect(listTransfers(scoped, { kitchenId: kA })).rejects.toThrow(/scope/);
  });
});

describe("purchase returns", () => {
  it("returns from the PO line's lots, caps at received minus returned, and audits the credit", async () => {
    const tomato = await ingredient("WP08 Tomato", { costPerUnit: 8000 });
    const po = await createPurchaseOrder({ supplierId, kitchenId: kA, lines: [{ ingredientId: tomato.id, quantity: 10, unitCost: 9000 }], actorId: owner.id });
    await setPurchaseStatus(po.id, "SENT");
    const line = await db.purchaseOrderLine.findFirstOrThrow({ where: { poId: po.id } });
    await recordMovement({ ingredientId: tomato.id, kitchenId: kA, type: "RECEIPT", quantity: 5, unitCost: 7000, expiresOn: addDays(today, 1), actorId: owner.id }); // market run, expires sooner
    await receivePurchase(po.id, owner.id, [{ lineId: line.id, quantity: 10, expiresOn: addDays(today, 4) }]);
    await expect(returnToSupplier(owner, { poId: po.id, reason: "", lines: [{ lineId: line.id, quantity: 1 }] })).rejects.toThrow(/reason/);

    const r = await returnToSupplier(owner, { poId: po.id, reason: "Bruised crate", lines: [{ lineId: line.id, quantity: 3 }] });
    expect(r.credit).toBe(3 * 9000); // drawn from the PO's lot, not the earlier-expiring market lot
    const lots = await lotsOf(kA, tomato.id);
    expect(lots.find((l) => l.poLineId === line.id)!.remainingQty).toBe(7);
    expect(lots.find((l) => l.poLineId == null)!.remainingQty).toBe(5);
    expect(await onHand(kA, tomato.id)).toBe(12);
    await expect(returnToSupplier(owner, { poId: po.id, reason: "More bruised", lines: [{ lineId: line.id, quantity: 8 }] })).rejects.toThrow(/Only 7/);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "po.return", entityId: po.id } });
    expect(log.reason).toBe("Bruised crate");
    expect(log.before).toMatchObject({ onHand: { [tomato.id]: 15 } });
    expect(log.after).toMatchObject({ onHand: { [tomato.id]: 12 }, credit: 27000 });
  });
});

describe("valuation and alert data", () => {
  it("values stock at lot cost plus unlotted stock at latest cost", async () => {
    const ghee = await ingredient("WP08 Ghee", { costPerUnit: 100000 });
    await recordMovement({ ingredientId: ghee.id, kitchenId: kB, type: "RECEIPT", quantity: 2, unitCost: 90000, actorId: owner.id });
    await recordMovement({ ingredientId: ghee.id, kitchenId: kB, type: "RECEIPT", quantity: 1, unitCost: 95000, actorId: owner.id });
    await recordMovement({ ingredientId: ghee.id, kitchenId: kB, type: "ADJUSTMENT", quantity: 0.5, note: "opening count", actorId: owner.id });
    await recordMovement({ ingredientId: ghee.id, kitchenId: kB, type: "WASTE", quantity: 1.5, note: "spilt", actorId: owner.id }); // FIFO/FEFO: 1.5 from the first lot
    const v = await stockValuation([kB]);
    const row = v.rows.find((r) => r.ingredientId === ghee.id)!;
    expect(row.onHand).toBe(2);
    expect(row.lotQty).toBe(1.5);
    expect(row.lotValue).toBe(0.5 * 90000 + 1 * 95000);
    expect(row.unlottedValue).toBe(0.5 * 100000);
    expect(row.value).toBe(190000);
    const waste = await db.auditLog.findFirstOrThrow({ where: { action: "stock.waste", reason: "spilt" } });
    expect(waste.before).toMatchObject({ onHand: 3.5 });
    expect(waste.after).toMatchObject({ onHand: 2 });
  });

  it("exposes low-stock, expiring, late-delivery and combined alert data, scoped by kitchen", async () => {
    const cumin = await ingredient("WP08 Cumin", { reorderPoint: 2 });
    await recordMovement({ ingredientId: cumin.id, kitchenId: kB, type: "RECEIPT", quantity: 1.5, unitCost: 10000, expiresOn: addDays(today, 1), actorId: owner.id });
    const low = await lowStockAlerts([kB]);
    expect(low.find((a) => a.entityId === cumin.id)).toMatchObject({ type: "LOW_STOCK", kitchenId: kB, dedupeKey: `low-stock:${kB}:${cumin.id}` });
    expect((await lowStockAlerts([kA])).some((a) => a.entityId === cumin.id && a.kitchenId === kB)).toBe(false);
    const exp = await expiringLotAlerts([kB], 3);
    expect(exp.some((a) => a.type === "EXPIRING_STOCK" && a.data.remainingQty === 1.5)).toBe(true);

    const po = await createPurchaseOrder({ supplierId, kitchenId: kB, expectedOn: addDays(today, -3), lines: [{ ingredientId: cumin.id, quantity: 5, unitCost: 10000 }], actorId: owner.id });
    await setPurchaseStatus(po.id, "SENT");
    const late = await lateDeliveryAlerts([kB]);
    expect(late.find((a) => a.entityId === po.id)).toMatchObject({ type: "LATE_SUPPLIER_DELIVERY", data: { daysLate: 3 } });
    const all = await inventoryAlerts([kB]);
    expect(all.every((a) => a.kitchenId === kB)).toBe(true);
    expect(all.some((a) => a.type === "LATE_SUPPLIER_DELIVERY") && all.some((a) => a.type === "LOW_STOCK")).toBe(true);
  });
});
