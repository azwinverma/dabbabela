import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, dateOnly, todayKTM, weekdayOf } from "@/lib/dates";
import type { CurrentUser } from "@/lib/auth";
import { placeCartOrder } from "@/server/orders";
import { recipeForProduction } from "@/server/inventory";
import { clearCapacityOverride, kitchenOrderProblem, mealsBooked, setCapacityOverride, setDailyCapacity } from "@/server/capacity";
import {
  KITCHEN_STATUSES,
  advanceBatch,
  assignKitchenManager,
  assignStaffToKitchen,
  batchShortages,
  kitchenPerformance,
  kitchenStaff,
  productionDashboard,
  removeStaffFromKitchen,
  requirementsHorizon,
  saveKitchenHours,
  setKitchenStatus,
  type KitchenActor,
} from "@/server/kitchen";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

const B = "customer.b@demo.dabbabela.local";
const C = "wp07.customer@test.local";
let owner: CurrentUser;
let kA: string; // the seeded kitchen (never modified here — other files rely on it)
let kO: string; // our own kitchen with a zone + customer, for ordering, capacity and dashboard tests
let kB: string; // an empty kitchen for exact metrics

async function order(date: string, qty = 1) {
  const user = await loadUser(C);
  const box = await primaryBoxOn(date);
  const res = await placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date, qty }], addressId: user.addresses[0].id, method: "CASH" });
  return res.orders[0];
}

beforeAll(async () => {
  owner = await loadUser("owner@test.local");
  const b = await loadUser(B);
  kA = b.addresses[0].zone!.kitchenId;
  kO = (await db.kitchen.create({ data: { name: "WP07 Bhaktapur kitchen", code: "WP07-O", dailyCapacity: 300 } })).id;
  const zone = await db.deliveryZone.create({ data: { name: "WP07 zone", areas: ["WP07 tole"], wards: [], kitchenId: kO } });
  const cust = await db.user.create({ data: { name: "WP07 Customer", email: C, emailVerified: true } });
  await db.address.create({ data: { userId: cust.id, label: "Office", recipientName: "WP07 Customer", phone: "+9779800000077", line1: "Sample building", area: "WP07 tole", zoneId: zone.id, isDefault: true } });
  kB = (await db.kitchen.create({ data: { name: "WP07 Lalitpur kitchen", code: "WP07-B", dailyCapacity: 50 } })).id;
});

afterAll(async () => {
  // leave our kitchens archived so later files' "any active kitchen" lookups ignore them
  await db.kitchen.updateMany({ where: { id: { in: [kO, kB] } }, data: { isActive: false } });
});

describe("kitchen status", () => {
  it("shutdown blocks new orders at that kitchen (audited with reason); reopen restores ordering", async () => {
    const date = serviceDay(17, 0);
    await expect(setKitchenStatus(owner, kO, "CLOSED", "")).rejects.toThrow(/reason/);
    const r = await setKitchenStatus(owner, kO, "CLOSED", "Gas line repair");
    expect(r.changed).toBe(true);
    await expect(order(date)).rejects.toThrow(/shut down/);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "kitchen.shutdown", entityId: kO }, orderBy: { createdAt: "desc" } });
    expect(log.reason).toBe("Gas line repair");
    expect(log.before).toMatchObject({ status: "OPEN" });
    expect(log.after).toMatchObject({ status: "CLOSED", statusNote: "Gas line repair" });

    await setKitchenStatus(owner, kO, "PAUSED", "Short staffed today");
    await expect(order(date)).rejects.toThrow(/paused/);

    await setKitchenStatus(owner, kO, "OPEN");
    const o = await order(date);
    expect(o.kitchenId).toBe(kO);
    expect(await db.auditLog.count({ where: { action: "kitchen.reopen", entityId: kO } })).toBeGreaterThan(0);
    expect((await db.kitchen.findUniqueOrThrow({ where: { id: kO } })).statusNote).toBeNull();
  });

  it("working days refuse other weekdays; hours are validated and audited", async () => {
    const date = serviceDay(18, 0);
    const wd = weekdayOf(date);
    const others = (["SUN", "MON", "TUE", "WED", "THU", "FRI"] as const).filter((d) => d !== wd);
    await expect(saveKitchenHours(owner, kO, { openTime: "15:00", closeTime: "06:00", workingDays: [] })).rejects.toThrow(/after opening/);
    await saveKitchenHours(owner, kO, { openTime: "06:00", closeTime: "15:00", workingDays: [...others] });
    expect(await db.auditLog.count({ where: { action: "kitchen.hours", entityId: kO } })).toBeGreaterThan(0);
    await expect(order(date)).rejects.toThrow(/doesn't cook on/);
    await saveKitchenHours(owner, kO, { openTime: "06:00", closeTime: "15:00", workingDays: [] });
    await expect(order(date)).resolves.toBeTruthy();
    expect(kitchenOrderProblem({ name: "K", isActive: true, status: "OPEN", statusNote: null, workingDays: [] }, date)).toBeNull();
  });
});

describe("capacity", () => {
  it("a per-day override is respected by ordering, audited, and clearing restores the default", async () => {
    const date = serviceDay(19, 0);
    const booked = await mealsBooked(kO, date);
    const { row } = await setCapacityOverride(owner, { kitchenId: kO, date, maxMeals: booked + 1, note: "Tihar — half staff" });
    await expect(order(date, 2)).rejects.toThrow(/fully booked/);
    await order(date, 1);
    await expect(order(date, 1)).rejects.toThrow(/fully booked/);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "capacity.set", entityId: kO }, orderBy: { createdAt: "desc" } });
    expect(log.after).toMatchObject({ date, maxMeals: booked + 1 });
    expect(log.reason).toBe("Tihar — half staff");
    await clearCapacityOverride(owner, row.id);
    await expect(order(date, 1)).resolves.toBeTruthy();

    expect(await setDailyCapacity(owner, kB, 60)).toBe(true);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "capacity.default", entityId: kB } })).before).toMatchObject({ dailyCapacity: 50 });
  });
});

describe("production dashboard", () => {
  it("totals equal booked orders and requirements equal scaled recipes", async () => {
    const date = serviceDay(26, 0);
    await order(date, 2);
    await order(date, 1);
    const dash = await productionDashboard(kO, date, { bufferPct: 10 });
    const items = await db.orderItem.findMany({ where: { order: { kitchenId: kO, deliveryDate: dateOnly(date), status: { in: KITCHEN_STATUSES } } } });
    const meals = items.reduce((a, i) => a + i.quantity, 0);
    expect(meals).toBeGreaterThanOrEqual(3);
    expect(dash.totals.meals).toBe(meals);
    expect(dash.totals.orders).toBe(await db.order.count({ where: { kitchenId: kO, deliveryDate: dateOnly(date), status: { in: KITCHEN_STATUSES } } }));
    expect(dash.bySlot.reduce((a, s) => a + s.meals, 0)).toBe(meals);
    expect(dash.bySlot.reduce((a, s) => a + s.orders, 0)).toBe(dash.totals.orders);
    expect(dash.packing.total).toBe(dash.totals.orders);
    expect(dash.cutoff).toMatch(/^\d\d:\d\d$/);

    // requirements = Σ recipeForProduction(dish, total).gross per ingredient
    const expected = new Map<string, number>();
    for (const d of dash.forecast.dishes) {
      const plan = await recipeForProduction(d.menuItemId, d.total, kO);
      for (const l of plan?.lines ?? []) expected.set(l.ingredientId, (expected.get(l.ingredientId) ?? 0) + l.gross);
    }
    expect(dash.requirements.rows.length).toBe(expected.size);
    expect(expected.size).toBeGreaterThan(0);
    for (const r of dash.requirements.rows) expect(r.need).toBeCloseTo(expected.get(r.ingredientId)!, 2);

    const horizon = await requirementsHorizon(kO, date, 2, 10);
    expect(horizon.perDay[0].meals).toBe(meals);
    for (const r of dash.requirements.rows) expect(horizon.rows.find((x) => x.ingredientId === r.ingredientId)!.need).toBeGreaterThanOrEqual(r.need - 0.01);
  });

  it("surfaces shortages recorded when a batch uses stock that isn't there", async () => {
    const date = addDays(todayKTM(), 45);
    const ghee = await db.ingredient.create({ data: { name: "WP07 Ghee", unit: "KG", costPerUnit: 90000, allergenCodes: [] } });
    const item = await db.menuItem.create({ data: { name: "WP07 Halwa", category: "MAIN" } });
    const recipe = await db.recipe.create({ data: { menuItemId: item.id } });
    const v = await db.recipeVersion.create({ data: { recipeId: recipe.id, version: 1, yieldPortions: 10, ingredients: { create: [{ ingredientId: ghee.id, quantity: 0.5 }] } } });
    await db.recipe.update({ where: { id: recipe.id }, data: { currentVersionId: v.id } });
    const batch = await db.productionBatch.create({ data: { kitchenId: kB, date: dateOnly(date), menuItemId: item.id, plannedPortions: 20, recipeVersionId: v.id } });
    await advanceBatch(batch.id, "COOKING", owner.id);
    const r = await advanceBatch(batch.id, "DONE", owner.id, { actualPortions: 20, wastePortions: 0 });
    expect(r.shortages).toEqual([{ ingredientId: ghee.id, name: "WP07 Ghee", type: "USAGE", shortage: 1 }]);
    const recorded = await batchShortages(kB, date);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ batchId: batch.id, ingredientId: ghee.id, shortage: 1, dish: "WP07 Halwa" });
    const dash = await productionDashboard(kB, date);
    expect(dash.shortages.recorded).toHaveLength(1);
    expect(dash.issues.some((i) => i.severity === "critical" && i.message.includes("WP07 Ghee"))).toBe(true);
    expect(dash.progress).toMatchObject({ batches: 1, done: 1, pct: 100 });
    // a retry posts nothing new and reports nothing new
    expect((await advanceBatch(batch.id, "DONE", owner.id, { actualPortions: 20 })).shortages).toEqual([]);
  });
});

describe("performance", () => {
  it("computes on-time packing, QC pass rate, waste %, cost per meal and operating costs from records", async () => {
    const day = addDays(todayKTM(), -3);
    const customer = await db.user.findUniqueOrThrow({ where: { email: B } });
    const slot = await db.deliverySlot.create({ data: { kitchenId: kB, label: "12:00 – 12:30", startTime: "12:00", endTime: "12:30" } });
    const ing = await db.ingredient.create({ data: { name: "WP07 Rice", unit: "KG", costPerUnit: 10000, allergenCodes: [] } });
    const dish = await db.menuItem.create({ data: { name: "WP07 Rice bowl", category: "MAIN" } });
    const recipe = await db.recipe.create({ data: { menuItemId: dish.id } });
    // 10 portions = 2 kg rice → Rs 20 (2000 paisa) per portion
    const v = await db.recipeVersion.create({ data: { recipeId: recipe.id, version: 1, yieldPortions: 10, ingredients: { create: [{ ingredientId: ing.id, quantity: 2 }] } } });
    await db.recipe.update({ where: { id: recipe.id }, data: { currentVersionId: v.id } });

    const mk = async (n: number, packedAt: string | null, status: "PACKED" | "DELIVERED" | "CONFIRMED") => {
      const o = await db.order.create({
        data: {
          number: `WP07-${n}-${Date.now()}`,
          code: `W${n}`,
          userId: customer.id,
          status,
          deliveryDate: dateOnly(day),
          kitchenId: kB,
          slotId: slot.id,
          slotLabel: slot.label,
          contactName: "x",
          contactPhone: "+9779800000002",
          addressLine: "x",
          area: "x",
          subtotal: 0,
          total: 0,
          items: { create: [{ name: "Rice bowl", components: [{ menuItemId: dish.id, name: dish.name, qty: 1 }], quantity: 2, unitPrice: 0, lineTotal: 0 }] },
        },
      });
      if (packedAt) await db.orderStatusEvent.create({ data: { orderId: o.id, toStatus: "PACKED", createdAt: new Date(`${day}T${packedAt}:00+05:45`) } });
      return o;
    };
    await mk(1, "11:30", "DELIVERED"); // on time
    await mk(2, "11:59", "PACKED"); // on time
    await mk(3, "12:20", "DELIVERED"); // late
    await mk(4, null, "CONFIRMED"); // never packed, window passed → late

    for (const result of ["PASS", "PASS", "PASS", "FAIL"]) await db.qcLog.create({ data: { kitchenId: kB, date: dateOnly(day), type: "TEMPERATURE", result } });
    const at = new Date(`${day}T08:00:00+05:45`);
    await db.stockMovement.create({ data: { kitchenId: kB, ingredientId: ing.id, type: "USAGE", quantity: -9, unitCost: 10000, createdAt: at } });
    await db.stockMovement.create({ data: { kitchenId: kB, ingredientId: ing.id, type: "WASTE", quantity: -1, unitCost: 10000, createdAt: at } });
    await db.productionBatch.create({ data: { kitchenId: kB, date: dateOnly(day), menuItemId: dish.id, plannedPortions: 40, actualPortions: 40, wastePortions: 4, status: "DONE" } });
    const rent = await db.expenseCategory.findUniqueOrThrow({ where: { key: "RENT" } });
    await db.expense.create({ data: { number: `WP07-E1-${Date.now()}`, date: dateOnly(day), categoryId: rent.id, kitchenId: kB, description: "Rent", amount: 400000, status: "APPROVED" } });
    await db.expense.create({ data: { number: `WP07-E2-${Date.now()}`, date: dateOnly(day), categoryId: rent.id, kitchenId: kB, description: "Draft", amount: 999999, status: "DRAFT" } });

    const p = await kitchenPerformance(kB, day, day);
    expect(p.orders).toBe(4);
    expect(p.meals).toBe(8);
    expect(p.onTimePacking).toMatchObject({ onTime: 2, late: 1, notPacked: 1, measured: 4, pct: 50 });
    expect(p.qc).toMatchObject({ pass: 3, fail: 1, passPct: 75 });
    expect(p.waste).toMatchObject({ usageCost: 90000, wasteCost: 10000, costPct: 10, cookedPortions: 40, wastedPortions: 4, portionPct: 10 });
    expect(p.costPerMeal).toMatchObject({ recipe: 2000, recipeTotal: 16000, actual: 12500, uncostedDishes: 0 });
    expect(p.operatingCosts).toMatchObject({ total: 400000, perMeal: 50000, count: 1 });
  });
});

describe("manager, staff and scoping", () => {
  it("assigns a manager (audited) and staff via scopes; refuses unsafe removals", async () => {
    const chef = await db.user.findUniqueOrThrow({ where: { email: "chef@demo.dabbabela.local" } });
    expect(await assignStaffToKitchen(owner, kB, chef.id)).toBe(true);
    expect((await kitchenStaff(kB)).map((s) => s.id)).toContain(chef.id);
    expect(await assignKitchenManager(owner, kB, chef.id)).toBe(true);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "kitchen.manager", entityId: kB } });
    expect(log.after).toMatchObject({ managerId: chef.id });
    // chef is now limited to kB, so they can't manage kA
    await expect(assignKitchenManager(owner, kA, chef.id)).rejects.toThrow(/can't access/);
    await expect(removeStaffFromKitchen(owner, kB, chef.id)).rejects.toThrow(/only kitchen/);
    await assignStaffToKitchen(owner, kA, chef.id);
    expect(await removeStaffFromKitchen(owner, kB, chef.id)).toBe(true);
    await db.staffScope.deleteMany({ where: { userId: chef.id } });
    const customer = await db.user.findUniqueOrThrow({ where: { email: B } });
    await expect(assignKitchenManager(owner, kB, customer.id)).rejects.toThrow(/staff member/);
  });

  it("refuses out-of-scope kitchens and missing permissions", async () => {
    const ops = await db.user.findUniqueOrThrow({ where: { email: "ops@demo.dabbabela.local" } });
    const scoped: KitchenActor = { id: ops.id, role: "OPERATIONS_MANAGER", kitchenIds: [kA] };
    await expect(setKitchenStatus(scoped, kB, "PAUSED", "no gas")).rejects.toThrow(/scope/);
    await expect(setCapacityOverride(scoped, { kitchenId: kB, date: serviceDay(25), maxMeals: 5 })).rejects.toThrow(/scope/);
    await expect(saveKitchenHours(scoped, kB, { workingDays: [] })).rejects.toThrow(/scope/);
    await expect(assignKitchenManager(scoped, kB, null)).rejects.toThrow(/scope/);

    const chef = await db.user.findUniqueOrThrow({ where: { email: "chef@demo.dabbabela.local" } });
    const cook: KitchenActor = { id: chef.id, role: "KITCHEN_STAFF", kitchenIds: null };
    await expect(setKitchenStatus(cook, kB, "CLOSED", "closing")).rejects.toThrow(/permission/);
    await expect(setKitchenStatus(cook, kB, "PAUSED", "no gas")).rejects.toThrow(/permission/);
    await expect(setCapacityOverride(cook, { kitchenId: kB, date: serviceDay(25), maxMeals: 5 })).rejects.toThrow(/permission/);
    expect((await db.kitchen.findUniqueOrThrow({ where: { id: kB } })).status).toBe("OPEN");
  });
});
