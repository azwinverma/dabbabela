import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, todayKTM, weekdayOf } from "@/lib/dates";
import { createSubscription, expireSwapPayments, parseSwapPaymentKey, pendingSwapPayments, swapMeal, swapOptions } from "@/server/subscriptions";
import { markPaymentPaid, switchPaymentMethod } from "@/server/payments";
import { addCredit, walletBalance } from "@/server/ledger";
import { getOffersForDates } from "@/server/menu";
import { loadUser, serviceDay } from "../helpers";

// Phase 2C — swap "pay the difference": a dearer swap of a paid plan meal paid online (SWAP_DIFFERENCE payment).

const B = "customer.b@demo.dabbabela.local";
const C = "customer.c@demo.dabbabela.local";
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI"] as const;
const BASE = 15000;

afterEach(() => {
  vi.useRealTimers();
});

async function drain(userId: string) {
  const bal = await walletBalance(userId);
  if (bal > 0) await db.creditLedger.create({ data: { userId, amount: -bal, reason: "ADJUSTMENT", note: "test drain" } });
}

/** A paid one-week plan whose meal on some day is the cheapest dabba; `target` is the dearest dabba that day. */
async function paidPlanOnCheapest(email: string, slug: string) {
  const today = todayKTM();
  const plan = await db.mealPlan.create({ data: { slug, name: `Test ${slug}`, kind: "WEEKLY", durationWeeks: 1, minDaysPerWeek: 1, pricePerMeal: BASE, compareAtPrice: BASE, includesDelivery: true } });
  await db.mealPlanPrice.create({ data: { planId: plan.id, pricePerMeal: BASE, compareAtPrice: BASE, effectiveFrom: dateOnly(addDays(today, -30)) } });
  const user = await loadUser(email);
  const address = user.addresses.find((a) => a.zoneId)!;
  const start = serviceDay(5);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((d) => weekdayOf(d) !== "SAT");
  const offers = await getOffersForDates(dates, address.zone!.kitchenId);
  for (const date of dates) {
    const items = (offers.get(date)?.items ?? []).filter((i) => !i.soldOut).sort((a, b) => a.price - b.price);
    if (items.length < 2 || items[items.length - 1].price <= Math.max(items[0].price, BASE)) continue;
    const sub = await createSubscription(user, { planId: plan.id, startDate: start, days: [...DAYS], picks: { [date]: { boxId: items[0].box.id } }, addressId: address.id, method: "ESEWA" });
    await markPaymentPaid(sub.payment.id, { amount: sub.payment.amount });
    const meal = await db.order.findFirstOrThrow({ where: { subscriptionId: sub.subscription.id, deliveryDate: dateOnly(date) }, include: { items: true } });
    const opts = await swapOptions(meal.id, user.id);
    const target = opts.options.find((o) => o.boxId === items[items.length - 1].box.id)!;
    const other = opts.options.find((o) => !o.current && o.boxId !== target.boxId && o.delta <= 0) ?? null;
    return { user, sub: sub.subscription, meal, target, other, date };
  }
  throw new Error("Seed menu has no day with dabbas at different prices");
}

describe("swap: pay the difference online", () => {
  it("keeps the swap pending until paid, applies it exactly once on verification, retries return the same payment", async () => {
    const { user, sub, meal, target } = await paidPlanOnCheapest(B, "p2c-swap-pay");
    expect(target.delta).toBeGreaterThan(0);
    await drain(user.id);

    // Wallet is empty → the default (wallet) is refused with a pointer to paying online.
    await expect(swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id)).rejects.toThrow(/pay the difference with eSewa or Khalti/);

    const r = await swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id, { method: "ESEWA" });
    expect(r).toMatchObject({ changed: false, delta: target.delta, settlement: "PAY_ONLINE" });
    const p = await db.payment.findUniqueOrThrow({ where: { id: r.paymentId! } });
    expect(p).toMatchObject({ purpose: "SWAP_DIFFERENCE", status: "PENDING", amount: target.delta, subscriptionId: sub.id, userId: user.id, method: "ESEWA" });
    expect(parseSwapPaymentKey(p.idempotencyKey)).toEqual({ orderId: meal.id, boxId: target.boxId, version: meal.version });
    // nothing changed on the meal yet
    const still = await db.order.findUniqueOrThrow({ where: { id: meal.id }, include: { items: true } });
    expect(still.items[0].boxId).toBe(meal.items[0].boxId);
    expect(still.version).toBe(meal.version);
    expect((await pendingSwapPayments(sub.id)).map((x) => x.id)).toEqual([p.id]);

    // A retried submit (double click / back button) returns the same payment, switching method if asked.
    const again = await swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id, { method: "ESEWA" });
    expect(again.paymentId).toBe(p.id);
    expect(await db.payment.count({ where: { purpose: "SWAP_DIFFERENCE", subscriptionId: sub.id } })).toBe(1);

    // Swap payments only take online / credit methods.
    await expect(switchPaymentMethod(p.id, user.id, "CASH")).rejects.toThrow();

    // Verified payment → swap applied; a duplicate callback / concurrent verification applies nothing more.
    const [a, b] = await Promise.all([markPaymentPaid(p.id, { amount: p.amount }), markPaymentPaid(p.id, { amount: p.amount })]);
    expect([a.already, b.already].sort()).toEqual([false, true]);
    await markPaymentPaid(p.id, { amount: p.amount });
    const after = await db.order.findUniqueOrThrow({ where: { id: meal.id }, include: { items: true } });
    expect(after.items[0].boxId).toBe(target.boxId);
    expect(after.customerShare).toBe(meal.customerShare + target.delta);
    expect(after.total).toBe(meal.total + target.delta);
    expect(await db.orderAdjustment.count({ where: { orderId: meal.id } })).toBe(1);
    expect(await db.subscriptionChange.count({ where: { subscriptionId: sub.id, type: "SWAP" } })).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PAID");
    expect(await walletBalance(user.id)).toBe(0); // nothing credited, nothing spent
    expect(await pendingSwapPayments(sub.id)).toEqual([]);
    const choices = (await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).dayChoices as Record<string, { boxId?: string }>;
    expect(choices[isoDate(meal.deliveryDate)].boxId).toBe(target.boxId);
  });

  it("credits the wallet instead when the meal changed before the money arrived (and supersedes the stale payment)", async () => {
    const { user, meal, target, other } = await paidPlanOnCheapest(C, "p2c-swap-stale");
    await drain(user.id);
    const r = await swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id, { method: "ESEWA" });
    // Customer changes their mind: a same-or-cheaper swap applies at once and cancels the pending payment.
    if (other) {
      const direct = await swapMeal(meal.id, other.boxId, { id: user.id, isStaff: false }, user.id);
      expect(direct.changed).toBe(true);
      expect((await db.payment.findUniqueOrThrow({ where: { id: r.paymentId! } })).status).toBe("CANCELLED");
    } else {
      await db.order.update({ where: { id: meal.id }, data: { version: { increment: 1 } } }); // any other edit
    }
    const before = await db.order.findUniqueOrThrow({ where: { id: meal.id }, include: { items: true } });
    // The gateway confirms late anyway: money is never lost — it becomes wallet credit.
    const res = await markPaymentPaid(r.paymentId!, { amount: target.delta });
    expect(res.credited).toBe(target.delta);
    const p = await db.payment.findUniqueOrThrow({ where: { id: r.paymentId! } });
    expect(p.status).toBe("REFUNDED");
    expect(await walletBalance(user.id)).toBe(target.delta);
    const after = await db.order.findUniqueOrThrow({ where: { id: meal.id }, include: { items: true } });
    expect(after.items[0].boxId).toBe(before.items[0].boxId);
    expect(after.items[0].boxId).not.toBe(target.boxId);
  });

  it("expires an unpaid swap at the day's cut-off; a late payment is credited, not applied", async () => {
    const { user, meal, target, date } = await paidPlanOnCheapest(B, "p2c-swap-expire");
    await drain(user.id);
    const r = await swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id, { method: "KHALTI" }).catch(async (e) => {
      // Khalti needs a secret key; fall back to eSewa (always configured outside production).
      if (/Khalti isn't available/.test(String(e))) return swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id, { method: "ESEWA" });
      throw e;
    });
    expect(await expireSwapPayments()).toBe(0); // still before the cut-off
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${date}T04:30:00Z`)); // 10:15 in Kathmandu on the meal's day — past the 09:30 cut-off
    expect(await expireSwapPayments()).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: r.paymentId! } })).status).toBe("CANCELLED");
    const res = await markPaymentPaid(r.paymentId!, { amount: target.delta });
    expect(res.credited).toBe(target.delta);
    vi.useRealTimers();
    expect((await db.order.findUniqueOrThrow({ where: { id: meal.id }, include: { items: true } })).items[0].boxId).toBe(meal.items[0].boxId);
    expect(await walletBalance(user.id)).toBe(target.delta);
  });

  it("wallet still pays instantly when credit covers it (method WALLET)", async () => {
    const { user, meal, target } = await paidPlanOnCheapest(C, "p2c-swap-wallet");
    await drain(user.id);
    await db.$transaction((tx) => addCredit(tx, { userId: user.id, amount: target.delta, reason: "GOODWILL", note: "test" }));
    const r = await swapMeal(meal.id, target.boxId, { id: user.id, isStaff: false }, user.id, { method: "WALLET" });
    expect(r).toMatchObject({ changed: true, settlement: "WALLET_CHARGE", delta: target.delta });
    expect(await walletBalance(user.id)).toBe(0);
  });
});
