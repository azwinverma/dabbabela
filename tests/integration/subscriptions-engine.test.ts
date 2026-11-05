import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, todayKTM, weekdayOf } from "@/lib/dates";
import { saveSettings } from "@/lib/settings";
import {
  addMealToPlan,
  cancelSubscription,
  changePlanPrice,
  createSubscription,
  extraMeals,
  planMealPrice,
  planPriceOn,
  quoteAddMeal,
  quoteSubscription,
  renewSubscription,
  skipMeal,
  swapMeal,
  swapOptions,
  syncPlanPriceMirrors,
} from "@/server/subscriptions";
import { markPaymentPaid } from "@/server/payments";
import { addCredit, walletBalance } from "@/server/ledger";
import { getOffersForDates } from "@/server/menu";
import { bookings } from "@/server/analytics/revenue";
import { COMMITTED_STATUSES, productionCalendar } from "@/app/admin/production-calendar/query";
import { loadUser, serviceDay } from "../helpers";

const A = "customer.a@demo.dabbabela.local";
const B = "customer.b@demo.dabbabela.local";
const C = "customer.c@demo.dabbabela.local";
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI"] as const;

let planId: string;
const BASE = 15000; // Rs 150 per meal

async function freshPlan(slug: string, extra: Record<string, unknown> = {}) {
  const today = todayKTM();
  const p = await db.mealPlan.create({
    data: { slug, name: `Test ${slug}`, kind: "WEEKLY", durationWeeks: 1, minDaysPerWeek: 1, pricePerMeal: BASE, compareAtPrice: BASE, includesDelivery: true, ...extra },
  });
  await db.mealPlanPrice.create({ data: { planId: p.id, pricePerMeal: BASE, compareAtPrice: BASE, effectiveFrom: dateOnly(addDays(today, -30)) } });
  return p;
}

async function customer(email: string) {
  const user = await loadUser(email);
  return { user, addressId: user.addresses.find((a) => a.zoneId)!.id };
}

async function fund(userId: string, amount: number) {
  await db.$transaction((tx) => addCredit(tx, { userId, amount, reason: "GOODWILL", note: "test" }));
}

const today = () => todayKTM();
const allBookings = () => bookings({ from: today(), to: today(), kitchenIds: null });

beforeAll(async () => {
  await saveSettings({ skipPolicy: "EXTEND" });
  planId = (await freshPlan("wp06-engine")).id;
});

afterEach(() => {
  vi.useRealTimers();
});

// The shared test schema is also used by the foundation-backfill test, which expects one price row per plan.
// Leave this file's plans with just their current version (history was asserted above).
afterAll(async () => {
  for (const p of await db.mealPlan.findMany({ where: { slug: { startsWith: "wp06-" } } })) {
    const now = await planPriceOn(p);
    await db.mealPlanPrice.deleteMany({ where: { planId: p.id, id: { not: now.id ?? "" } } });
    await db.mealPlanPrice.updateMany({ where: { planId: p.id }, data: { effectiveTo: null } });
    await db.mealPlan.update({ where: { id: p.id }, data: { pricePerMeal: now.pricePerMeal, compareAtPrice: now.compareAtPrice } });
  }
});

describe("versioned plan pricing", () => {
  it("sells at the effective price and never reprices an existing subscription", async () => {
    const { user, addressId } = await customer(B);
    const sub = await createSubscription(user, { planId, startDate: serviceDay(6), days: ["MON", "TUE", "WED"], addressId, method: "CASH" });
    const firstPrice = await planPriceOn({ id: planId, pricePerMeal: 0, compareAtPrice: null });
    expect(sub.subscription.pricePerMeal).toBe(BASE);
    expect(sub.subscription.priceId).toBe(firstPrice.id);
    const ordersBefore = await db.order.findMany({ where: { subscriptionId: sub.subscription.id }, select: { id: true, total: true, subtotal: true } });

    const owner = await loadUser("owner@test.local");
    await changePlanPrice(planId, { pricePerMeal: 18000, compareAtPrice: 18000 }, owner.id);
    // history is append-only: the old row is closed yesterday, the new one is current
    const rows = await db.mealPlanPrice.findMany({ where: { planId }, orderBy: { effectiveFrom: "asc" } });
    expect(rows.length).toBe(2);
    expect(isoDate(rows[0].effectiveTo!)).toBe(addDays(today(), -1));
    expect((await db.mealPlan.findUniqueOrThrow({ where: { id: planId } })).pricePerMeal).toBe(18000);

    const q = await quoteSubscription(user, { planId, startDate: serviceDay(6), days: ["MON", "TUE", "WED"], addressId });
    expect(q.plan.pricePerMeal).toBe(18000);
    expect(q.price.id).toBe(rows[1].id);

    const after = await db.subscription.findUniqueOrThrow({ where: { id: sub.subscription.id } });
    expect(after.pricePerMeal).toBe(BASE);
    expect(after.priceId).toBe(firstPrice.id);
    expect(after.total).toBe(sub.subscription.total);
    const ordersAfter = await db.order.findMany({ where: { subscriptionId: sub.subscription.id }, select: { id: true, total: true, subtotal: true } });
    expect(ordersAfter).toEqual(expect.arrayContaining(ordersBefore));

    // the change is audited with before/after
    const log = await db.auditLog.findFirst({ where: { action: "plan.price_change", entityId: planId }, orderBy: { createdAt: "desc" } });
    expect(log?.actorId).toBe(owner.id);
    expect(JSON.stringify(log?.before)).toContain(String(BASE));
    expect(JSON.stringify(log?.after)).toContain("18000");
  });

  it("schedules a future price without touching today's, and refuses back-dating", async () => {
    const owner = await loadUser("owner@test.local");
    const future = addDays(today(), 10);
    await changePlanPrice(planId, { pricePerMeal: 20000, compareAtPrice: null, effectiveFrom: future }, owner.id);
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { id: planId } });
    expect((await planPriceOn(plan)).pricePerMeal).toBe(18000);
    expect((await planPriceOn(plan, future)).pricePerMeal).toBe(20000);
    expect(plan.pricePerMeal).toBe(18000); // mirror only moves when the version becomes current
    expect(await syncPlanPriceMirrors([planId])).toBe(0);
    await expect(changePlanPrice(planId, { pricePerMeal: 1000, compareAtPrice: null, effectiveFrom: addDays(today(), -1) }, owner.id)).rejects.toThrow(/past/);
    // re-scheduling the same future date replaces the unused version
    await changePlanPrice(planId, { pricePerMeal: 21000, compareAtPrice: null, effectiveFrom: future }, owner.id);
    expect(await db.mealPlanPrice.count({ where: { planId, effectiveFrom: dateOnly(future) } })).toBe(1);
    expect((await planPriceOn(plan, future)).pricePerMeal).toBe(21000);
  });
});

describe("add a meal to a plan", () => {
  it("prices at the subscription's own price (not today's), books once, and is idempotent", async () => {
    const { user, addressId } = await customer(B);
    const sub = await db.subscription.findFirstOrThrow({ where: { userId: user.id, planId, pricePerMeal: BASE }, include: { plan: true, price: true } });
    const date = serviceDay(5, 2);
    const offer = (await getOffersForDates([date], (await db.order.findFirstOrThrow({ where: { subscriptionId: sub.id } })).kitchenId)).get(date)!;
    const box = offer.items.find((i) => !i.soldOut)!;
    const q = await quoteAddMeal(user, sub.id, { date, boxId: box.box.id });
    const expected = BASE + Math.max(0, box.price - (sub.price?.compareAtPrice ?? BASE));
    expect(q.unitPrice).toBe(expected);
    expect(q.unitPrice).toBe(planMealPrice(sub, box.price));
    expect(q.priced.deliveryFee).toBe(0); // plan includes delivery

    const before = await allBookings();
    const key = `addmeal-${sub.id}`;
    const r1 = await addMealToPlan(user, sub.id, { date, boxId: box.box.id, method: "CASH", idempotencyKey: key });
    const r2 = await addMealToPlan(user, sub.id, { date, boxId: box.box.id, method: "CASH", idempotencyKey: key });
    expect(r2.replayed).toBe(true);
    expect(r2.payment.id).toBe(r1.payment.id);
    expect(await db.order.count({ where: { paymentId: r1.payment.id } })).toBe(1);
    expect(r1.order.subscriptionId).toBeNull();
    expect(r1.payment.subscriptionId).toBe(sub.id);
    expect(r1.order.total).toBe(q.priced.total);
    const extras = await extraMeals(sub.id);
    expect(extras.map((o) => o.id)).toContain(r1.order.id);
    // booked once, as its own sale; the plan's booked total doesn't move
    const after = await allBookings();
    expect(after.total - before.total).toBe(r1.order.total);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).total).toBe(sub.total);
    expect(addressId).toBeTruthy();
  });

  it("refuses another customer's plan", async () => {
    const { user: other } = await customer(A);
    const sub = await db.subscription.findFirstOrThrow({ where: { planId, user: { email: B } } });
    await expect(quoteAddMeal(other, sub.id, { date: serviceDay(5), boxId: "x" })).rejects.toThrow(/not found/i);
  });
});

/**
 * A paid plan whose meal on one day was picked explicitly (the cheapest or the dearest dabba of a day that has dabbas
 * at different prices); `target` is the opposite end of that day's menu.
 */
async function paidPlanWithChoice(email: string, slug: string, picked: "cheap" | "dear") {
  const p = await freshPlan(slug);
  const { user, addressId } = await customer(email);
  const start = serviceDay(5);
  const kitchenId = user.addresses.find((a) => a.id === addressId)!.zone!.kitchenId;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((d) => weekdayOf(d) !== "SAT");
  const offers = await getOffersForDates(dates, kitchenId);
  for (const date of dates) {
    const items = (offers.get(date)?.items ?? []).filter((i) => !i.soldOut).sort((a, b) => a.price - b.price);
    if (items.length < 2 || items[items.length - 1].price <= Math.max(items[0].price, BASE)) continue;
    const [cheap, dear] = [items[0], items[items.length - 1]];
    const mine = picked === "cheap" ? cheap : dear;
    const sub = await createSubscription(user, { planId: p.id, startDate: start, days: [...DAYS], picks: { [date]: { boxId: mine.box.id } }, addressId, method: "ESEWA" });
    await markPaymentPaid(sub.payment.id, { amount: sub.payment.amount });
    const meal = await db.order.findFirstOrThrow({ where: { subscriptionId: sub.subscription.id, deliveryDate: dateOnly(date) }, include: { items: true } });
    expect(meal.items[0].boxId).toBe(mine.box.id);
    const o = await swapOptions(meal.id, user.id);
    const target = o.options.find((x) => x.boxId === (picked === "cheap" ? dear : cheap).box.id)!;
    return { user, sub: sub.subscription, meal, target, mine: o.options.find((x) => x.current)!, plan: p };
  }
  throw new Error("Seed menu has no day with dabbas at different prices");
}

describe("swap a day's pick", () => {
  it("re-prices once: credits the saving, charges the wallet on the way up, and a retry changes nothing", async () => {
    const { user, sub, meal, target, mine } = await paidPlanWithChoice(C, "wp06-swap", "dear");
    expect(target.delta).toBeLessThan(0);
    const wallet0 = await walletBalance(user.id);
    const down = await swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id);
    expect(down).toMatchObject({ changed: true, delta: target.delta, settlement: "WALLET_CREDIT" });
    const o1 = await db.order.findUniqueOrThrow({ where: { id: meal.id }, include: { items: true } });
    expect(o1.items[0].boxId).toBe(target.boxId);
    expect(o1.total).toBe(meal.total + target.delta);
    expect(await walletBalance(user.id)).toBe(wallet0 - target.delta);
    // retried submit: no second credit, no second adjustment
    const again = await swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id);
    expect(again.changed).toBe(false);
    expect(await walletBalance(user.id)).toBe(wallet0 - target.delta);
    expect(await db.orderAdjustment.count({ where: { orderId: meal.id } })).toBe(1);
    expect(await db.subscriptionChange.count({ where: { subscriptionId: sub.id, type: "SWAP" } })).toBe(1);
    // back up to the dearer dabba: charged from the wallet; the order returns to its original total
    const up = await swapMeal(meal.id, mine.boxId, { id: user.id, isStaff: false }, user.id);
    expect(up).toMatchObject({ changed: true, delta: -target.delta, settlement: "WALLET_CHARGE" });
    expect(await walletBalance(user.id)).toBe(wallet0);
    const o2 = await db.order.findUniqueOrThrow({ where: { id: meal.id } });
    expect(o2.total).toBe(meal.total);
    expect(o2.followsRotation).toBe(false);
    const adj = await db.orderAdjustment.findMany({ where: { orderId: meal.id } });
    expect(adj.reduce((a, x) => a + x.amount, 0)).toBe(0);
    // the plan remembers the pick (renewals carry it)
    const choices = (await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).dayChoices as Record<string, { boxId?: string }>;
    expect(choices[isoDate(meal.deliveryDate)].boxId).toBe(mine.boxId);
  });

  it("refuses an up-charge the wallet can't cover", async () => {
    const { user, meal, target } = await paidPlanWithChoice(A, "wp06-swap-short", "cheap");
    expect(target.delta).toBeGreaterThan(0);
    const bal = await walletBalance(user.id);
    if (bal >= target.delta) await db.creditLedger.create({ data: { userId: user.id, amount: -(bal - target.delta + 1), reason: "ADJUSTMENT", note: "test drain" } });
    await expect(swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id)).rejects.toThrow(/more than your current meal/);
    await expect(swapMeal(meal.id, target.boxId, { id: "someone", isStaff: false }, "someone-else")).rejects.toThrow(/not found/i);
  });

  it("respects the per-day menu cut-off (and the global one), staff can still swap", async () => {
    const { user, meal, target, mine } = await paidPlanWithChoice(B, "wp06-swap-cutoff", "cheap");
    await fund(user.id, target.delta * 3 + 10000);
    const date = isoDate(meal.deliveryDate);
    const offer = (await getOffersForDates([date], meal.kitchenId)).get(date)!;
    const day = await db.menuDay.findUniqueOrThrow({ where: { menuId_day: { menuId: offer.menuId!, day: weekdayOf(date) } } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${date}T02:15:00Z`)); // 08:00 in Kathmandu on the meal's day (global cut-off 09:30)
    try {
      await db.menuDay.update({ where: { id: day.id }, data: { cutoffOverride: "07:30" } });
      await expect(swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id)).rejects.toThrow(/closed at 07:30/);
      await expect(skipMeal(meal.id, { id: user.id, isStaff: false }, user.id)).rejects.toThrow(/closed at 07:30/);
      await db.menuDay.update({ where: { id: day.id }, data: { cutoffOverride: null } });
      const ok = await swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id);
      expect(ok.changed).toBe(true);
      vi.setSystemTime(new Date(`${date}T04:30:00Z`)); // 10:15 — past the global cut-off
      await expect(swapMeal(meal.id, mine.boxId, { id: user.id, isStaff: false }, user.id)).rejects.toThrow(/closed at 09:30/);
      const staff = await swapMeal(meal.id, mine.boxId, { id: user.id, isStaff: true }, null, { reason: "phoned in" });
      expect(staff.changed).toBe(true);
    } finally {
      vi.useRealTimers();
      await db.menuDay.update({ where: { id: day.id }, data: { cutoffOverride: day.cutoffOverride } });
    }
  });
});

describe("renewal", () => {
  it("creates one linked subscription at today's price, from after the old end date, even when clicked twice", async () => {
    const p = await freshPlan("wp06-renew");
    const { user, addressId } = await customer(A);
    const old = await createSubscription(user, { planId: p.id, startDate: serviceDay(5), days: ["MON", "WED", "FRI"], addressId, method: "CASH" });
    const owner = await loadUser("owner@test.local");
    await changePlanPrice(p.id, { pricePerMeal: 16000, compareAtPrice: 16000 }, owner.id);

    const before = await allBookings();
    const [r1, r2] = await Promise.all([
      renewSubscription(user, old.subscription.id, { method: "ESEWA", idempotencyKey: `renew-a-${p.id}` }),
      renewSubscription(user, old.subscription.id, { method: "ESEWA", idempotencyKey: `renew-b-${p.id}` }),
    ]);
    const r3 = await renewSubscription(user, old.subscription.id, { method: "ESEWA" });
    expect(r1.subscription.id).toBe(r2.subscription.id);
    expect(r3.subscription.id).toBe(r1.subscription.id);
    expect(r3.replayed).toBe(true);
    expect(await db.subscription.count({ where: { renewedFromId: old.subscription.id } })).toBe(1);
    const renewed = await db.subscription.findUniqueOrThrow({ where: { id: r1.subscription.id } });
    expect(renewed.renewedFromId).toBe(old.subscription.id);
    expect(renewed.pricePerMeal).toBe(16000);
    expect(isoDate(renewed.startDate) > isoDate(old.subscription.endDate)).toBe(true);
    expect(renewed.days).toEqual(old.subscription.days);
    expect(renewed.addressId).toBe(addressId);
    // payment goes through the normal flow — nothing charged automatically
    expect(renewed.status).toBe("PENDING_PAYMENT");
    expect(r1.needsPayment).toBe(true);
    const pay = await db.payment.findMany({ where: { subscriptionId: renewed.id } });
    expect(pay.length).toBe(1);
    expect(pay[0].status).toBe("PENDING");
    // an unpaid renewal isn't a booking; the old plan's meals are untouched
    expect((await allBookings()).total).toBe(before.total);
    expect(await db.subscriptionChange.count({ where: { subscriptionId: old.subscription.id, type: "RENEW" } })).toBe(1);
  });
});

describe("per-plan policies", () => {
  it("enforces min/max weeks", async () => {
    const p = await freshPlan("wp06-weeks", { durationWeeks: 2, minWeeks: 1, maxWeeks: 4 });
    const { user, addressId } = await customer(A);
    const start = serviceDay(5);
    await expect(quoteSubscription(user, { planId: p.id, startDate: start, days: ["MON"], weeks: 5, addressId })).rejects.toThrow(/1–4 weeks/);
    await expect(quoteSubscription(user, { planId: p.id, startDate: start, days: ["MON"], weeks: 0, addressId })).rejects.toThrow(/1–4 weeks/);
    const q1 = await quoteSubscription(user, { planId: p.id, startDate: start, days: [...DAYS], weeks: 1, addressId });
    const q4 = await quoteSubscription(user, { planId: p.id, startDate: start, days: [...DAYS], weeks: 4, addressId });
    expect(q4.dates.length).toBeGreaterThan(q1.dates.length * 3);
    expect(q4.endDate <= addDays(start, 27)).toBe(true);
    const q = await quoteSubscription(user, { planId: p.id, startDate: start, days: [...DAYS], addressId });
    expect(q.weeks).toBe(2);
  });

  it("uses the plan's skip policy over the global setting", async () => {
    const p = await freshPlan("wp06-skipcredit", { skipPolicy: "CREDIT" });
    const { user, addressId } = await customer(C);
    const sub = await createSubscription(user, { planId: p.id, startDate: serviceDay(5), days: ["TUE", "THU"], addressId, method: "ESEWA" });
    await markPaymentPaid(sub.payment.id, { amount: sub.payment.amount });
    const meal = await db.order.findFirstOrThrow({ where: { subscriptionId: sub.subscription.id, status: "SCHEDULED" }, orderBy: { deliveryDate: "asc" } });
    const before = await walletBalance(user.id);
    const r = await skipMeal(meal.id, { id: user.id, isStaff: false }, user.id);
    expect(r.policy).toBe("CREDIT");
    expect(await walletBalance(user.id)).toBe(before + meal.customerShare);
  });

  it("applies the cancel policy: STAFF_ONLY blocks online cancel, REFUND raises a refund", async () => {
    const staffOnly = await freshPlan("wp06-cancel-staff", { cancelPolicy: "STAFF_ONLY" });
    const refund = await freshPlan("wp06-cancel-refund", { cancelPolicy: "REFUND" });
    const { user, addressId } = await customer(C);
    const s1 = await createSubscription(user, { planId: staffOnly.id, startDate: serviceDay(5), days: ["WED"], addressId, method: "ESEWA" });
    await markPaymentPaid(s1.payment.id, { amount: s1.payment.amount });
    await expect(cancelSubscription(s1.subscription.id, { id: user.id, isStaff: false }, { userId: user.id, reason: "nope" })).rejects.toThrow(/contact support/);
    const staff = await cancelSubscription(s1.subscription.id, { id: user.id, isStaff: true }, { reason: "support call" });
    expect(staff.cancelled).toBeGreaterThan(0);

    const s2 = await createSubscription(user, { planId: refund.id, startDate: serviceDay(5), days: ["WED"], addressId, method: "ESEWA" });
    await markPaymentPaid(s2.payment.id, { amount: s2.payment.amount });
    const wallet = await walletBalance(user.id);
    const c = await cancelSubscription(s2.subscription.id, { id: user.id, isStaff: false }, { userId: user.id, reason: "moving away" });
    expect(c.settlement).toBe("REFUND");
    expect(await walletBalance(user.id)).toBe(wallet);
    expect(await db.refund.count({ where: { paymentId: s2.payment.id } })).toBe(1);
  });
});

describe("production calendar", () => {
  it("totals equal the booked orders in range, per day and overall", async () => {
    const owner = await loadUser("owner@test.local");
    const cal = await productionCalendar(owner, { from: today(), weeks: 3 });
    const items = await db.orderItem.findMany({
      where: { order: { deliveryDate: { gte: dateOnly(cal.start), lte: dateOnly(cal.end) }, kitchenId: { in: cal.kitchens.map((k) => k.id) } } },
      select: { quantity: true, order: { select: { status: true, deliveryDate: true } } },
    });
    const committed = items.filter((i) => COMMITTED_STATUSES.includes(i.order.status));
    expect(cal.totals.meals).toBe(committed.reduce((a, i) => a + i.quantity, 0));
    expect(cal.totals.meals).toBeGreaterThan(0);
    expect(cal.totals.pending).toBe(items.filter((i) => i.order.status === "PENDING_PAYMENT").reduce((a, i) => a + i.quantity, 0));
    expect(cal.rows.reduce((a, r) => a + r.total, 0)).toBe(cal.totals.meals);
    for (const d of cal.days) {
      const n = committed.filter((i) => isoDate(i.order.deliveryDate) === d).reduce((a, i) => a + i.quantity, 0);
      expect(cal.perDay[d].meals).toBe(n);
      expect(cal.kitchens.reduce((a, k) => a + cal.cell(k.id, d).meals, 0)).toBe(n);
    }
    // skipped / cancelled meals never count
    expect(items.some((i) => ["SKIPPED", "CANCELLED"].includes(i.order.status))).toBe(true);
  });

  it("is limited to the staff member's kitchens and needs kitchen.view", async () => {
    const customerUser = await loadUser(A);
    await expect(productionCalendar(customerUser, {})).rejects.toThrow(/access/);
    const owner = await loadUser("owner@test.local");
    const k = (await db.kitchen.findFirstOrThrow({ where: { isActive: true } })).id;
    const scoped = await productionCalendar({ ...owner, kitchenIds: [k] }, { from: today(), weeks: 1 });
    expect(scoped.kitchens.map((x) => x.id)).toEqual([k]);
  });
});

describe("revenue is not double counted", () => {
  it("a plan books once at purchase; its meals carry the plan total; swaps/extra meals/renewals don't re-book the plan", async () => {
    const p = await freshPlan("wp06-revenue");
    const { user, addressId } = await customer(A);
    const before = await allBookings();
    const sub = await createSubscription(user, { planId: p.id, startDate: serviceDay(5), days: ["SUN", "TUE", "THU"], addressId, method: "CASH" });
    const mid = await allBookings();
    expect(mid.total - before.total).toBe(sub.subscription.total);
    const meals = await db.order.findMany({ where: { subscriptionId: sub.subscription.id } });
    expect(meals.reduce((a, o) => a + o.total, 0)).toBe(sub.subscription.total);
    // the plan's meal orders are not booked again as single orders
    expect(mid.single - before.single).toBe(0);
  });
});
