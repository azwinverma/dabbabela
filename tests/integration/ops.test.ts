import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dateOnly } from "@/lib/dates";
import { placeCartOrder, setOrderStatus } from "@/server/orders";
import { bomNeed, forecast, planBatches, advanceBatch, requirements, suggestQty, recordPacking } from "@/server/kitchen";
import { createPurchaseOrder, receivePurchase, recordMovement, setPurchaseStatus, stockOnHand, usageVariance } from "@/server/inventory";
import { assignOrders, createRoute, deliverStop, failStop, otpMatches, resolveFailed, startRoute } from "@/server/dispatch";
import { saveSettings } from "@/lib/settings";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

const B = "customer.b@demo.dabbabela.local";

async function order(date: string, qty = 1, method: "CASH" | "WALLET" = "CASH") {
  const user = await loadUser(B);
  const box = await primaryBoxOn(date);
  const res = await placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date, qty }], addressId: user.addresses[0].id, method });
  return { order: res.orders[0], box };
}

describe("kitchen maths", () => {
  it("scales a BOM and grosses up for trim waste", () => {
    expect(bomNeed([{ quantity: 1, wastePct: 0 }], 10, 5)).toEqual([0.5]);
    expect(bomNeed([{ quantity: 0.9, wastePct: 10 }], 10, 10)[0]).toBeCloseTo(1.0, 6);
    expect(suggestQty(3.2, 10)).toBe(10);
    expect(suggestQty(0, 10)).toBe(0);
    expect(suggestQty(1.23, 0)).toBe(1.3);
  });

  it("forecasts portions per dish from order snapshots and turns them into ingredients", async () => {
    const date = serviceDay(11, 0);
    const kitchen = await db.kitchen.findFirstOrThrow();
    const before = await forecast(kitchen.id, date, 10); // other test files may share this day
    const { order: o, box } = await order(date, 3);
    const f = await forecast(o.kitchenId, date, 10);
    expect(f.meals - before.meals).toBe(3);
    const items = await db.boxItem.findMany({ where: { boxId: box.id } });
    for (const it of items) {
      const now = f.dishes.find((d) => d.menuItemId === it.menuItemId)!;
      const was = before.dishes.find((d) => d.menuItemId === it.menuItemId)?.portions ?? 0;
      expect(now.portions - was).toBe(3 * it.quantity);
      expect(now.buffer).toBe(Math.ceil((now.portions * 10) / 100));
    }
    const req = await requirements(o.kitchenId, f.dishes.map((d) => ({ menuItemId: d.menuItemId, name: d.name, total: d.total })));
    expect(req.rows.length).toBeGreaterThan(0);
    expect(req.rows.every((r) => r.need > 0)).toBe(true);
  });
});

describe("production batches", () => {
  it("posts ingredient usage exactly once, even if DONE is sent twice", async () => {
    const date = serviceDay(13, 0);
    const { order: o } = await order(date, 2);
    await planBatches(o.kitchenId, date, 0);
    const batch = await db.productionBatch.findFirstOrThrow({ where: { kitchenId: o.kitchenId, date: dateOnly(date) }, include: { menuItem: { include: { recipe: { include: { currentVersion: { include: { ingredients: true } } } } } } } });
    const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
    const v = batch.menuItem.recipe!.currentVersion!;
    const ingredientId = v.ingredients[0].ingredientId;
    const before = (await stockOnHand(o.kitchenId, [ingredientId])).get(ingredientId) ?? 0;
    await advanceBatch(batch.id, "COOKING", owner.id);
    await expect(advanceBatch(batch.id, "PLANNED" as never, owner.id)).rejects.toThrow();
    await advanceBatch(batch.id, "DONE", owner.id, { actualPortions: 2, wastePortions: 0 });
    await advanceBatch(batch.id, "DONE", owner.id, { actualPortions: 2, wastePortions: 0 });
    const after = (await stockOnHand(o.kitchenId, [ingredientId])).get(ingredientId) ?? 0;
    const expected = bomNeed([v.ingredients[0]], v.yieldPortions, 2)[0];
    expect(before - after).toBeCloseTo(expected, 2);
    const rows = await db.stockMovement.count({ where: { reference: `batch:${batch.id}`, ingredientId } });
    expect(rows).toBe(1);
    const variance = await usageVariance(o.kitchenId, date, date);
    void variance;
  });
});

describe("inventory", () => {
  it("receives a purchase order, posts stock and updates cost; can't over-receive", async () => {
    const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
    const kitchen = await db.kitchen.findFirstOrThrow();
    const supplier = await db.supplier.findFirstOrThrow();
    const ing = await db.ingredient.findFirstOrThrow({ where: { name: "Potato" } });
    const before = (await stockOnHand(kitchen.id, [ing.id])).get(ing.id) ?? 0;
    const po = await createPurchaseOrder({ supplierId: supplier.id, kitchenId: kitchen.id, lines: [{ ingredientId: ing.id, quantity: 20, unitCost: 6500 }], actorId: owner.id });
    expect(po.total).toBe(130000);
    await setPurchaseStatus(po.id, "SENT");
    const line = await db.purchaseOrderLine.findFirstOrThrow({ where: { poId: po.id } });
    const p1 = await receivePurchase(po.id, owner.id, [{ lineId: line.id, quantity: 12, unitCost: 7000 }]);
    expect(p1.status).toBe("PARTIAL");
    await expect(receivePurchase(po.id, owner.id, [{ lineId: line.id, quantity: 9 }])).rejects.toThrow(/Only 8/);
    const p2 = await receivePurchase(po.id, owner.id, [{ lineId: line.id, quantity: 8 }]);
    expect(p2.status).toBe("RECEIVED");
    expect((await stockOnHand(kitchen.id, [ing.id])).get(ing.id)).toBeCloseTo(before + 20, 3);
    expect((await db.ingredient.findUniqueOrThrow({ where: { id: ing.id } })).costPerUnit).toBe(7000);
  });

  it("requires a reason for adjustments and signs movements by type", async () => {
    const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
    const kitchen = await db.kitchen.findFirstOrThrow();
    const ing = await db.ingredient.findFirstOrThrow({ where: { name: "Onion" } });
    await expect(recordMovement({ ingredientId: ing.id, kitchenId: kitchen.id, type: "ADJUSTMENT", quantity: -1, actorId: owner.id })).rejects.toThrow(/reason/);
    const w = await recordMovement({ ingredientId: ing.id, kitchenId: kitchen.id, type: "WASTE", quantity: 2, note: "Rotten sack", actorId: owner.id });
    expect(w.quantity).toBe(-2);
  });
});

describe("dispatch & hand-off", () => {
  it("checks the customer's code and records cash before marking delivered", async () => {
    await saveSettings({ flags: { deliveryOtp: true } as never });
    const date = serviceDay(14, 0);
    const { order: o } = await order(date, 1, "CASH");
    const rider = await db.user.findUniqueOrThrow({ where: { email: "rider@demo.dabbabela.local" } });
    const dispatcher = await db.user.findUniqueOrThrow({ where: { email: "dispatch@demo.dabbabela.local" } });
    await setOrderStatus([o.id], "PREPARING", dispatcher.id);
    await setOrderStatus([o.id], "PACKED", dispatcher.id);
    const route = await createRoute({ kitchenId: o.kitchenId, date, name: "Route A", riderId: rider.id });
    await assignOrders(route.id, [o.id]);
    const s = await startRoute(route.id, dispatcher.id);
    expect(s.out).toBe(1);
    const fresh = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    const me = { id: rider.id, isStaff: false };
    await expect(deliverStop(o.id, me, { otp: "0000" === fresh.deliveryOtp ? "1111" : "0000", cashCollected: fresh.customerShare })).rejects.toThrow(/doesn't match/);
    await expect(deliverStop(o.id, me, { otp: fresh.deliveryOtp! })).rejects.toThrow(/Collect cash/);
    await expect(deliverStop(o.id, me, { otp: fresh.deliveryOtp!, cashCollected: fresh.customerShare - 100 })).rejects.toThrow(/exactly/);
    await deliverStop(o.id, me, { otp: fresh.deliveryOtp!, cashCollected: fresh.customerShare });
    const done = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(done.status).toBe("DELIVERED");
    expect(done.paymentStatus).toBe("PAID");
    expect((await db.deliveryRoute.findUniqueOrThrow({ where: { id: route.id } })).cashCollected).toBe(fresh.customerShare);
    expect(otpMatches("0420", " 04-20 ")).toBe(true);
  });

  it("only lets a rider act on their own route and supports retry after a failed delivery", async () => {
    const date = serviceDay(15, 0);
    const { order: o } = await order(date, 1, "CASH");
    const rider = await db.user.findUniqueOrThrow({ where: { email: "rider@demo.dabbabela.local" } });
    const other = await db.user.findUniqueOrThrow({ where: { email: "chef@demo.dabbabela.local" } });
    await setOrderStatus([o.id], "PREPARING", null);
    await setOrderStatus([o.id], "PACKED", null);
    const route = await createRoute({ kitchenId: o.kitchenId, date, name: "Route B", riderId: rider.id });
    await assignOrders(route.id, [o.id]);
    await startRoute(route.id, other.id);
    await expect(failStop(o.id, { id: other.id, isStaff: false }, "no answer")).rejects.toThrow(/isn't on your route/);
    await failStop(o.id, { id: rider.id, isStaff: false }, "Office closed");
    await resolveFailed(o.id, other.id, "RETRY", "Called customer, back at 2pm");
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("OUT_FOR_DELIVERY");
  });

  it("packing check moves an order to PACKED only when everything passes", async () => {
    const date = serviceDay(16, 0);
    const { order: o } = await order(date, 1);
    const chef = await db.user.findUniqueOrThrow({ where: { email: "chef@demo.dabbabela.local" } });
    const bad = await recordPacking(o.id, chef.id, { itemsOk: true, labelOk: true, allergenOk: false, sealedOk: true });
    expect(bad.packed).toBe(false);
    const ok = await recordPacking(o.id, chef.id, { itemsOk: true, labelOk: true, allergenOk: true, sealedOk: true });
    expect(ok.packed).toBe(true);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PACKED");
  });
});
