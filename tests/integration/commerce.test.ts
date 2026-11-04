import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, ktmNow } from "@/lib/dates";
import { placeCartOrder, quoteCart, cancelOrder, setOrderStatus, lockDay, OrderError } from "@/server/orders";
import { createSubscription, quoteSubscription, skipMeal, unskipMeal, pauseSubscription, resumeSubscription, cancelSubscription } from "@/server/subscriptions";
import { markPaymentPaid, handleEsewaReturn, startPayment, requestRefund, approveRefund, processRefund } from "@/server/payments";
import { esewaSign, esewaConfig } from "@/server/payments/esewa";
import { walletBalance, addCredit } from "@/server/ledger";
import { handleDisruption } from "@/server/disruption";
import { saveSettings } from "@/lib/settings";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

const B = "customer.b@demo.dabbabela.local";
const C = "customer.c@demo.dabbabela.local";
const A = "customer.a@demo.dabbabela.local";

async function addr(email: string) {
  const u = await loadUser(email);
  return { user: u, addressId: u.addresses[0].id };
}

afterEach(() => vi.unstubAllGlobals());

beforeAll(async () => {
  await saveSettings({ bankDetails: "Test bank · A/C 000" });
});

describe("single orders", () => {
  it("prices on the server and creates one order per day (cash)", async () => {
    const { user, addressId } = await addr(B);
    const d1 = serviceDay(3, 0);
    const d2 = serviceDay(3, 1);
    const b1 = await primaryBoxOn(d1);
    const b2 = await primaryBoxOn(d2);
    const q = await quoteCart(user, { lines: [{ kind: "box", id: b1.id, date: d1, qty: 2 }, { kind: "box", id: b2.id, date: d2, qty: 1 }], addressId });
    expect(q.ok).toBe(true);
    expect(q.subtotal).toBe(b1.price * 2 + b2.price);
    expect(q.days.length).toBe(2);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b1.id, date: d1, qty: 2 }, { kind: "box", id: b2.id, date: d2, qty: 1 }], addressId, method: "CASH", idempotencyKey: "k-cash-1" });
    expect(res.orders.length).toBe(2);
    expect(res.orders.every((o) => o.status === "SCHEDULED" && o.paymentStatus === "UNPAID")).toBe(true);
    expect(res.payment.amount).toBe(q.total);
    // snapshot stored
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: res.orders[0].id } });
    expect(Array.isArray(item.components)).toBe(true);
  });

  it("returns the same payment when a submit is retried with the same key", async () => {
    const { user, addressId } = await addr(B);
    const d = serviceDay(3, 2);
    const b = await primaryBoxOn(d);
    const again = await placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "CASH", idempotencyKey: "k-cash-1" });
    expect(again.replayed).toBe(true);
    expect(await db.payment.count({ where: { idempotencyKey: "k-cash-1" } })).toBe(1);
  });

  it("refuses a box that isn't on that day's menu", async () => {
    const { user, addressId } = await addr(B);
    const d = serviceDay(3, 0);
    const pasta = await db.lunchBox.findUniqueOrThrow({ where: { slug: "fusion-special" } });
    const offered = (await primaryBoxOn(d)).id === pasta.id;
    if (offered) return;
    const q = await quoteCart(user, { lines: [{ kind: "box", id: pasta.id, date: d, qty: 1 }], addressId });
    expect(q.ok).toBe(false);
  });

  it("blocks an address outside the delivery areas with a clear message", async () => {
    const u0 = await loadUser(C);
    const a = await db.address.create({ data: { userId: u0.id, label: "Biratnagar", recipientName: "x", phone: "+9779800000003", line1: "Main road", area: "Biratnagar", city: "Biratnagar" } });
    const user = await loadUser(C);
    const d = serviceDay(3);
    const b = await primaryBoxOn(d);
    await expect(placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId: a.id, method: "CASH" })).rejects.toThrow(/don't deliver to Biratnagar/);
  });

  it("does not oversell the last portion when two customers race", async () => {
    const d = serviceDay(20, 0);
    const box = await primaryBoxOn(d);
    // a week-specific menu with capacity 1 for that box on d
    const { weekStartOf, weekdayOf } = await import("@/lib/dates");
    await db.weeklyMenu.create({
      data: {
        title: "Race test",
        weekStart: dateOnly(weekStartOf(d)),
        status: "PUBLISHED",
        days: { create: [{ day: weekdayOf(d), items: { create: [{ boxId: box.id, isPrimary: true, capacity: 1 }] } }] },
      },
    });
    const b = await addr(B);
    const c = await addr(C);
    const results = await Promise.allSettled([
      placeCartOrder(b.user, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: b.addressId, method: "CASH" }),
      placeCartOrder(c.user, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: c.addressId, method: "CASH" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason.message)).toMatch(/sold out/);
    await db.weeklyMenu.deleteMany({ where: { title: "Race test" } });
  });

  it("keeps the order's dish snapshot when the kitchen changes the recipe later", async () => {
    const { user, addressId } = await addr(B);
    const d = serviceDay(3, 3);
    const b = await primaryBoxOn(d);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "CASH" });
    const before = (await db.orderItem.findFirstOrThrow({ where: { orderId: res.orders[0].id } })).components;
    const salad = await db.menuItem.findFirstOrThrow({ where: { name: "Cucumber-radish salad" } });
    await db.boxItem.upsert({ where: { boxId_menuItemId: { boxId: b.id, menuItemId: salad.id } }, create: { boxId: b.id, menuItemId: salad.id }, update: {} });
    const after = (await db.orderItem.findFirstOrThrow({ where: { orderId: res.orders[0].id } })).components;
    expect(after).toEqual(before);
    await db.boxItem.deleteMany({ where: { boxId: b.id, menuItemId: salad.id } });
  });
});

describe("online payments", () => {
  it("is idempotent: paying twice fulfils once", async () => {
    const { user, addressId } = await addr(C);
    const d = serviceDay(3, 0);
    const b = await primaryBoxOn(d);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "ESEWA" });
    expect(res.orders[0].status).toBe("PENDING_PAYMENT");
    const [r1, r2] = await Promise.all([markPaymentPaid(res.payment.id, { amount: res.payment.amount }), markPaymentPaid(res.payment.id, { amount: res.payment.amount })]);
    expect([r1.already, r2.already].filter((x) => !x).length).toBe(1);
    const o = await db.order.findUniqueOrThrow({ where: { id: res.orders[0].id }, include: { events: true } });
    expect(o.status).toBe("SCHEDULED");
    expect(o.events.filter((e) => e.toStatus === "SCHEDULED").length).toBe(1);
  });

  it("verifies eSewa callbacks on the server and ignores replays and tampering", async () => {
    const { user, addressId } = await addr(C);
    const d = serviceDay(3, 1);
    const b = await primaryBoxOn(d);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "ESEWA" });
    const start = await startPayment(res.payment.id, user.id, "http://localhost:3100");
    expect(start.kind).toBe("esewa");
    const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { paymentId: res.payment.id } });
    const amount = (attempt.amount / 100).toString();
    const body = { transaction_code: "000ABC", status: "COMPLETE", total_amount: amount, transaction_uuid: attempt.providerRef, product_code: esewaConfig().productCode, signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names" };
    const sig = esewaSign(`transaction_code=000ABC,status=COMPLETE,total_amount=${amount},transaction_uuid=${attempt.providerRef},product_code=${body.product_code},signed_field_names=${body.signed_field_names}`);
    const good = Buffer.from(JSON.stringify({ ...body, signature: sig })).toString("base64");
    const tampered = Buffer.from(JSON.stringify({ ...body, total_amount: "1", signature: sig })).toString("base64");

    // Status API says COMPLETE (stubbed — the sandbox can't confirm a fake transaction).
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "COMPLETE", ref_id: "000ABC" }), { status: 200 })));
    expect((await handleEsewaReturn(res.payment.id, tampered)).ok).toBe(false);
    expect((await db.payment.findUniqueOrThrow({ where: { id: res.payment.id } })).status).not.toBe("PAID");
    expect((await handleEsewaReturn(res.payment.id, good)).ok).toBe(true);
    expect((await handleEsewaReturn(res.payment.id, good)).ok).toBe(true); // replay: no-op
    const events = await db.orderStatusEvent.count({ where: { orderId: res.orders[0].id, toStatus: "SCHEDULED" } });
    expect(events).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: res.payment.id } })).status).toBe("PAID");
  });

  it("keeps the payment pending when the status API can't be reached", async () => {
    const { user, addressId } = await addr(C);
    const d = serviceDay(3, 2);
    const b = await primaryBoxOn(d);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "ESEWA" });
    await startPayment(res.payment.id, user.id, "http://localhost:3100");
    const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { paymentId: res.payment.id } });
    const amount = (attempt.amount / 100).toString();
    const body = { transaction_code: "X1", status: "COMPLETE", total_amount: amount, transaction_uuid: attempt.providerRef, product_code: esewaConfig().productCode, signed_field_names: "status,total_amount,transaction_uuid" };
    const sig = esewaSign(`status=COMPLETE,total_amount=${amount},transaction_uuid=${attempt.providerRef}`);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const r = await handleEsewaReturn(res.payment.id, Buffer.from(JSON.stringify({ ...body, signature: sig })).toString("base64"));
    expect(r.ok).toBe(false);
    expect(r.pending).toBe(true);
    expect((await db.order.findUniqueOrThrow({ where: { id: res.orders[0].id } })).status).toBe("PENDING_PAYMENT");
  });
});

describe("cancellations, credit and refunds", () => {
  it("credits the wallet when a paid order is cancelled before the cut-off", async () => {
    const { user, addressId } = await addr(C);
    const d = serviceDay(4, 0);
    const b = await primaryBoxOn(d);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "ESEWA" });
    await markPaymentPaid(res.payment.id, { amount: res.payment.amount });
    const before = await walletBalance(user.id);
    const r = await cancelOrder(res.orders[0].id, { id: user.id, isStaff: false }, { reason: "Changed plans", userId: user.id });
    expect(r.settlement).toBe("CREDIT");
    expect(await walletBalance(user.id)).toBe(before + res.orders[0].customerShare);
    const p = await db.payment.findUniqueOrThrow({ where: { id: res.payment.id } });
    expect(p.refundedAmount).toBe(res.orders[0].customerShare);
  });

  it("won't let a customer cancel once the kitchen is cooking", async () => {
    const { user, addressId } = await addr(B);
    const d = serviceDay(4, 1);
    const b = await primaryBoxOn(d);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "CASH" });
    await setOrderStatus([res.orders[0].id], "PREPARING", null, "test");
    await expect(cancelOrder(res.orders[0].id, { id: user.id, isStaff: false }, { reason: "x", userId: user.id })).rejects.toThrow(/being prepared/);
  });

  it("never marks a gateway refund processed without proof", async () => {
    const { user, addressId } = await addr(C);
    const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
    const d = serviceDay(4, 2);
    const b = await primaryBoxOn(d);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "ESEWA" });
    await markPaymentPaid(res.payment.id, { amount: res.payment.amount });
    await expect(requestRefund({ paymentId: res.payment.id, amount: res.payment.amount + 1, reason: "too much", method: "ORIGINAL", actorId: owner.id })).rejects.toThrow(/At most/);
    const r = await requestRefund({ paymentId: res.payment.id, orderId: res.orders[0].id, amount: 5000, reason: "Cold food", method: "ORIGINAL", actorId: owner.id });
    await expect(processRefund(r.id, owner.id, {})).rejects.toThrow(/Approve/);
    await approveRefund(r.id, owner.id);
    await expect(processRefund(r.id, owner.id, {})).rejects.toThrow(/proof/);
    await processRefund(r.id, owner.id, { providerRef: "ESW-REF-1" });
    const p = await db.payment.findUniqueOrThrow({ where: { id: res.payment.id } });
    expect(p.status).toBe("PARTIALLY_REFUNDED");
  });

  it("can't overspend the wallet from two tabs", async () => {
    const { user, addressId } = await addr(B);
    const bal = await walletBalance(user.id);
    const d = serviceDay(6, 0);
    const b = await primaryBoxOn(d);
    const q = await quoteCart(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId });
    const need = q.customerShare - bal;
    if (need > 0) await db.$transaction((tx) => addCredit(tx, { userId: user.id, amount: need, reason: "GOODWILL", note: "test" }));
    const results = await Promise.allSettled([
      placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "WALLET" }),
      placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "WALLET" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await walletBalance(user.id)).toBeGreaterThanOrEqual(0);
  });
});

describe("meal plans", () => {
  it("counts real service days and skips move a meal to the end", async () => {
    const { user, addressId } = await addr(B);
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "hapta" } });
    const start = serviceDay(3);
    const q = await quoteSubscription(user, { planId: plan.id, startDate: start, days: ["SUN", "MON", "TUE", "WED", "THU"], addressId });
    expect(q.mealsTotal).toBeGreaterThan(0);
    expect(q.total).toBe(q.days.reduce((a, d) => a + d.total, 0));
    const sub = await createSubscription(user, { planId: plan.id, startDate: start, days: ["SUN", "MON", "TUE", "WED", "THU"], addressId, method: "CASH" });
    expect(sub.subscription.status).toBe("ACTIVE");
    const meals = await db.order.findMany({ where: { subscriptionId: sub.subscription.id }, orderBy: { deliveryDate: "asc" } });
    expect(meals.length).toBe(q.mealsTotal);
    const sum = meals.reduce((a, o) => a + o.total, 0);
    expect(sum).toBe(sub.subscription.total);

    const first = meals[0];
    const r = await skipMeal(first.id, { id: user.id, isStaff: false }, user.id);
    expect(r.policy).toBe("EXTEND");
    const live = await db.order.findMany({ where: { subscriptionId: sub.subscription.id, status: { in: ["SCHEDULED"] } } });
    expect(live.length).toBe(q.mealsTotal);
    const s2 = await db.subscription.findUniqueOrThrow({ where: { id: sub.subscription.id } });
    expect(isoDate(s2.endDate) > q.endDate).toBe(true);
    // skipped day no longer counts in kitchen demand
    const demand = await db.order.count({ where: { id: first.id, status: { in: ["SCHEDULED", "CONFIRMED"] } } });
    expect(demand).toBe(0);

    await unskipMeal(first.id, { id: user.id, isStaff: false }, user.id);
    const live2 = await db.order.count({ where: { subscriptionId: sub.subscription.id, status: "SCHEDULED" } });
    expect(live2).toBe(q.mealsTotal);
  });

  it("credits a skipped paid meal when the policy is CREDIT", async () => {
    await saveSettings({ skipPolicy: "CREDIT" });
    try {
      const { user, addressId } = await addr(C);
      const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "hapta" } });
      const sub = await createSubscription(user, { planId: plan.id, startDate: serviceDay(3), days: ["SUN", "MON", "TUE", "WED"], addressId, method: "ESEWA" });
      await markPaymentPaid(sub.payment.id, { amount: sub.payment.amount });
      const meal = await db.order.findFirstOrThrow({ where: { subscriptionId: sub.subscription.id, status: "SCHEDULED" }, orderBy: { deliveryDate: "asc" } });
      const before = await walletBalance(user.id);
      const r = await skipMeal(meal.id, { id: user.id, isStaff: false }, user.id);
      expect(r.policy).toBe("CREDIT");
      expect(await walletBalance(user.id)).toBe(before + meal.customerShare);
    } finally {
      await saveSettings({ skipPolicy: "EXTEND" });
    }
  });

  it("pauses and resumes without duplicating meals, and cancels with credit", async () => {
    const { user, addressId } = await addr(C);
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "do-hapta" } });
    const sub = await createSubscription(user, { planId: plan.id, startDate: serviceDay(3), days: ["MON", "WED"], addressId, method: "ESEWA" });
    await markPaymentPaid(sub.payment.id, { amount: sub.payment.amount });
    const total = sub.subscription.mealsTotal;
    const actor = { id: user.id, isStaff: false };
    const held = await pauseSubscription(sub.subscription.id, actor, { userId: user.id });
    expect(held).toBe(total);
    await resumeSubscription(sub.subscription.id, actor, { userId: user.id });
    await expect(resumeSubscription(sub.subscription.id, actor, { userId: user.id })).rejects.toThrow(/isn't paused/);
    expect(await db.order.count({ where: { subscriptionId: sub.subscription.id, status: "SCHEDULED" } })).toBe(total);
    const before = await walletBalance(user.id);
    const c = await cancelSubscription(sub.subscription.id, actor, { userId: user.id, reason: "Moving" });
    expect(c.credit).toBeGreaterThan(0);
    expect(await walletBalance(user.id)).toBe(before + c.credit);
    expect(c.credit).toBeLessThanOrEqual(sub.payment.amount);
  });

  it("resumes a paused plan around days the kitchen has already locked", async () => {
    const { user, addressId } = await addr(C);
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "hapta" } });
    const sub = await createSubscription(user, { planId: plan.id, startDate: serviceDay(4), days: ["SUN", "MON", "TUE", "WED", "THU", "FRI"], addressId, method: "ESEWA" });
    await markPaymentPaid(sub.payment.id, { amount: sub.payment.amount });
    const total = sub.subscription.mealsTotal;
    const actor = { id: user.id, isStaff: false };
    const kitchenId = (await db.order.findFirstOrThrow({ where: { subscriptionId: sub.subscription.id } })).kitchenId;
    await pauseSubscription(sub.subscription.id, actor, { userId: user.id });
    // the next three days get locked while the plan is paused (e.g. the cut-off passed)
    const locked = [1, 2, 3].map((n) => addDays(ktmNow().date, n));
    await db.dayLock.createMany({ data: locked.map((d) => ({ kitchenId, date: dateOnly(d), orderCount: 0 })), skipDuplicates: true });
    try {
      await resumeSubscription(sub.subscription.id, actor, { userId: user.id });
      const s = await db.subscription.findUniqueOrThrow({ where: { id: sub.subscription.id } });
      expect(s.status).toBe("ACTIVE");
      const live = await db.order.findMany({ where: { subscriptionId: sub.subscription.id, status: "SCHEDULED" }, select: { deliveryDate: true } });
      expect(live.length).toBe(total);
      expect(live.map((o) => isoDate(o.deliveryDate)).filter((d) => locked.includes(d))).toEqual([]);
    } finally {
      await db.dayLock.deleteMany({ where: { kitchenId, date: { in: locked.map(dateOnly) } } });
    }
  });
});

describe("corporate split billing", () => {
  it("bills the company its subsidy and the employee the rest", async () => {
    const { user, addressId } = await addr(A);
    const d = serviceDay(3, 0);
    const b = await primaryBoxOn(d);
    const q = await quoteCart(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId });
    // demo company: SPLIT 50%, capped Rs 100/meal, 5% discount, free delivery
    const afterDiscount = b.price - Math.round(b.price * 0.05);
    expect(q.deliveryFee).toBe(0);
    expect(q.companyShare).toBe(Math.min(Math.round(afterDiscount / 2), 10000));
    expect(q.customerShare).toBe(q.total - q.companyShare);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "CASH" });
    expect(res.orders[0].source).toBe("CORPORATE");
    expect(res.orders[0].companyShare).toBe(q.companyShare);
  });
});

describe("kitchen day lock & disruption", () => {
  it("locks a day after the cut-off and refuses new orders for it", async () => {
    const { user, addressId } = await addr(B);
    const d = serviceDay(8, 0);
    const b = await primaryBoxOn(d);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "CASH" });
    const k = await lockDay(res.orders[0].kitchenId, d, null);
    expect(k.confirmed).toBeGreaterThanOrEqual(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: res.orders[0].id } })).status).toBe("CONFIRMED");
    await expect(placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "CASH" })).rejects.toThrow(/locked/);
  });

  it("moves orders to the next service day on a bandh and closes the date", async () => {
    const { user, addressId } = await addr(B);
    const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
    const d = serviceDay(9, 0);
    const b = await primaryBoxOn(d);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId, method: "CASH" });
    const r = await handleDisruption({ date: d, kitchenId: null, reason: "Nepal bandh", kind: "BANDH", outcome: "MOVE", actorId: owner.id });
    expect(r.moved + r.credited + r.cancelled).toBe(r.total);
    const o = await db.order.findUniqueOrThrow({ where: { id: res.orders[0].id } });
    expect(isoDate(o.deliveryDate) > d || o.status === "CANCELLED").toBe(true);
    const q = await quoteCart(user, { lines: [{ kind: "box", id: b.id, date: d, qty: 1 }], addressId });
    expect(q.ok).toBe(false);
  });
});

describe("guards", () => {
  it("throws OrderError for an empty basket", async () => {
    const { user, addressId } = await addr(B);
    await expect(placeCartOrder(user, { lines: [], addressId, method: "CASH" })).rejects.toBeInstanceOf(OrderError);
  });
});
