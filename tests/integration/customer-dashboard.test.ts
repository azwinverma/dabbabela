import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, todayKTM, weekdayOf } from "@/lib/dates";
import { getSettings, saveSettings } from "@/lib/settings";
import { placeCartOrder, cancelOrder } from "@/server/orders";
import { createSubscription, skipMeal } from "@/server/subscriptions";
import { markPaymentPaid } from "@/server/payments";
import { addCredit } from "@/server/ledger";
import { getOffersForDates } from "@/server/menu";
import {
  calendarGrid,
  dashboardPlans,
  hasCustomerAction,
  mealCalendar,
  mealWindows,
  parsePin,
  paymentHistory,
  PinError,
  saveAddressPin,
  statusStep,
  upcomingLunches,
  windowOpen,
} from "@/server/customer-dashboard";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

const A = "customer.a@demo.dabbabela.local";
const B = "customer.b@demo.dabbabela.local";

async function customer(email: string) {
  const user = await loadUser(email);
  return { user, addressId: user.addresses.find((a) => a.zoneId)!.id };
}

async function book(email: string, date: string, key: string) {
  const { user, addressId } = await customer(email);
  const box = await primaryBoxOn(date);
  return placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date, qty: 1 }], addressId, method: "CASH", idempotencyKey: key });
}

let planId: string;

beforeAll(async () => {
  await saveSettings({ skipPolicy: "EXTEND" });
  const p = await db.mealPlan.create({
    data: { slug: "wp18-dash", name: "Test wp18", kind: "WEEKLY", durationWeeks: 1, minDaysPerWeek: 1, pricePerMeal: 15000, compareAtPrice: 15000, includesDelivery: true, renewalReminderDays: 30 },
  });
  await db.mealPlanPrice.create({ data: { planId: p.id, pricePerMeal: 15000, compareAtPrice: 15000, effectiveFrom: dateOnly(addDays(todayKTM(), -30)) } });
  planId = p.id;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("upcoming lunches", () => {
  it("equal the customer's own booked orders (single + plan), never another customer's", async () => {
    const d1 = serviceDay(2, 0);
    const d2 = serviceDay(2, 1);
    const a1 = await book(A, d1, "wp18-a1");
    const a2 = await book(A, d2, "wp18-a2");
    const b1 = await book(B, d1, "wp18-b1");
    const aCancel = await book(A, d2, "wp18-a3");
    const { user: ua } = await customer(A);
    await cancelOrder(aCancel.orders[0].id, { id: ua.id, isStaff: false }, { reason: "test", userId: ua.id });

    const from = todayKTM();
    const rows = await upcomingLunches(ua.id, { from, days: 14 });
    const expected = await db.order.findMany({
      where: { userId: ua.id, deliveryDate: { gte: dateOnly(from), lte: dateOnly(addDays(from, 13)) }, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(expected.map((r) => r.id)));
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([a1.orders[0].id, a2.orders[0].id]));
    expect(ids).not.toContain(b1.orders[0].id);
    expect(ids).not.toContain(aCancel.orders[0].id);
    expect(rows.every((r) => r.userId === ua.id)).toBe(true);
    // sorted by delivery date
    expect(rows.map((r) => isoDate(r.deliveryDate))).toEqual([...rows.map((r) => isoDate(r.deliveryDate))].sort());
  });

  it("the meal calendar shows the same lunches for the month, only the customer's", async () => {
    const d = serviceDay(2, 0);
    const { user: ua } = await customer(A);
    const { user: ub } = await customer(B);
    const cal = await mealCalendar(ua.id, d.slice(0, 7));
    const all = [...cal.byDate.values()].flat();
    const mine = await db.order.findMany({ where: { userId: ua.id, deliveryDate: { gte: dateOnly(cal.start), lte: dateOnly(cal.end) }, status: { not: "CANCELLED" } }, select: { id: true } });
    expect(new Set(all.map((o) => o.id))).toEqual(new Set(mine.map((o) => o.id)));
    const theirs = await db.order.findMany({ where: { userId: ub.id }, select: { id: true } });
    expect(all.some((o) => theirs.some((t) => t.id === o.id))).toBe(false);
  });

  it("builds Sunday-first month grids", () => {
    const g = calendarGrid("2026-11", "2026-11-19");
    expect(weekdayOf(g.start)).toBe("SUN");
    expect(weekdayOf(g.end)).toBe("SAT");
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
    expect(g.weeks.flat().filter((c) => c.inMonth).length).toBe(30);
    expect(g.weeks.flat().find((c) => c.isToday)?.date).toBe("2026-11-19");
    expect(g.prev).toBe("2026-10");
    expect(g.next).toBe("2026-12");
    expect(calendarGrid("2026-12").next).toBe("2027-01");
    expect(statusStep("PENDING_PAYMENT")).toBe(0);
    expect(statusStep("OUT_FOR_DELIVERY")).toBe(4);
    expect(statusStep("CANCELLED")).toBe(-1);
  });
});

describe("payment history", () => {
  it("totals equal the customer's payment, refund and wallet records", async () => {
    const { user: ua } = await customer(A);
    const { user: ub } = await customer(B);
    const paid = await book(A, serviceDay(3, 2), "wp18-pay-a");
    await markPaymentPaid(paid.payment.id, { amount: paid.payment.amount });
    await db.$transaction((tx) => addCredit(tx, { userId: ua.id, amount: 5000, reason: "GOODWILL", note: "wp18" }));
    await db.creditLedger.create({ data: { userId: ua.id, amount: -1200, reason: "ADJUSTMENT", note: "wp18 spend" } });
    const bPay = await book(B, serviceDay(3, 2), "wp18-pay-b");
    const bRefund = await db.refund.create({ data: { paymentId: bPay.payment.id, amount: 100, reason: "wp18 other customer" } });

    const h = await paymentHistory(ua.id, { take: 200 });
    const payments = await db.payment.findMany({ where: { userId: ua.id } });
    const paidRows = payments.filter((p) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status));
    expect(h.totals.paid).toBe(paidRows.reduce((s, p) => s + p.amount, 0));
    expect(h.totals.paidCount).toBe(paidRows.length);
    expect(h.totals.refunded).toBe(paidRows.reduce((s, p) => s + p.refundedAmount, 0));
    expect(h.totals.pending).toBe(payments.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amount, 0));
    expect(h.totals.paid).toBeGreaterThanOrEqual(paid.payment.amount);

    const ledger = await db.creditLedger.findMany({ where: { userId: ua.id } });
    expect(h.totals.walletIn).toBe(ledger.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0));
    expect(h.totals.walletOut).toBe(-ledger.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0));
    expect(h.totals.walletBalance).toBe(h.totals.walletIn - h.totals.walletOut);

    // rows: all own, nothing of B's
    expect(new Set(h.payments.map((p) => p.id))).toEqual(new Set(payments.map((p) => p.id)));
    expect(h.wallet.length).toBe(ledger.length);
    expect(h.refunds.map((r) => r.id)).not.toContain(bRefund.id);
    expect(h.payments.map((p) => p.id)).not.toContain(bPay.payment.id);

    const hb = await paymentHistory(ub.id, { take: 200 });
    expect(hb.refunds.map((r) => r.id)).toContain(bRefund.id);
    expect(hb.payments.some((p) => payments.some((x) => x.id === p.id))).toBe(false);
  });
});

describe("address map pin", () => {
  it("validates ranges and shape", () => {
    expect(parsePin("", "")).toBeNull();
    expect(parsePin(null, undefined)).toBeNull();
    expect(parsePin(" 27.7172 ", "85.324")).toEqual({ lat: 27.7172, lng: 85.324 });
    expect(parsePin("27.123456789", "85.987654321")).toEqual({ lat: 27.123457, lng: 85.987654 });
    expect(() => parsePin("27.7", "")).toThrow(PinError);
    expect(() => parsePin("", "85.3")).toThrow(/both/);
    expect(() => parsePin("abc", "85.3")).toThrow(/numbers/);
    expect(() => parsePin("1e1", "85.3")).toThrow(PinError);
    expect(() => parsePin("25.9", "85.3")).toThrow(/outside Nepal/);
    expect(() => parsePin("27.7", "89.5")).toThrow(/outside Nepal/);
    expect(() => parsePin("-27.7", "85.3")).toThrow(/outside Nepal/);
    expect(() => parsePin("91", "85.3")).toThrow(PinError);
  });

  it("saves and clears a pin on the customer's own address only", async () => {
    const { user: ua, addressId } = await customer(A);
    const { user: ub, addressId: bAddress } = await customer(B);
    const before = await db.address.findUniqueOrThrow({ where: { id: bAddress } });

    await saveAddressPin(ua.id, addressId, { lat: 27.7172, lng: 85.324 });
    let a = await db.address.findUniqueOrThrow({ where: { id: addressId } });
    expect([a.lat, a.lng]).toEqual([27.7172, 85.324]);

    await expect(saveAddressPin(ua.id, bAddress, { lat: 27.7, lng: 85.3 })).rejects.toThrow(/not found/i);
    const after = await db.address.findUniqueOrThrow({ where: { id: bAddress } });
    expect([after.lat, after.lng]).toEqual([before.lat, before.lng]);
    await expect(saveAddressPin(ua.id, addressId, { lat: 40, lng: 85.3 })).rejects.toThrow(PinError);

    await saveAddressPin(ua.id, addressId, null);
    a = await db.address.findUniqueOrThrow({ where: { id: addressId } });
    expect([a.lat, a.lng]).toEqual([null, null]);

    // archived addresses can't be pinned
    const archived = await db.address.create({ data: { userId: ub.id, label: "Old", recipientName: "B", phone: "+9779800000000", line1: "Somewhere", area: "Baneshwor", archivedAt: new Date() } });
    await expect(saveAddressPin(ub.id, archived.id, { lat: 27.7, lng: 85.3 })).rejects.toThrow(/not found/i);
  });
});

describe("per-day cut-off on the account pages", () => {
  it("closes skip at the menu day's own cut-off, like the server does", async () => {
    const { user, addressId } = await customer(A);
    const settings = await getSettings();
    const start = serviceDay(5);
    const sub = await createSubscription(user, { planId, startDate: start, days: ["SUN", "MON", "TUE", "WED", "THU", "FRI"], addressId, method: "CASH" });
    const meal = await db.order.findFirstOrThrow({ where: { subscriptionId: sub.subscription.id, status: { in: ["SCHEDULED", "PENDING_PAYMENT"] } }, orderBy: { deliveryDate: "asc" } });
    expect(hasCustomerAction(meal)).toBe(true);
    const date = isoDate(meal.deliveryDate);
    const offer = (await getOffersForDates([date], meal.kitchenId)).get(date)!;
    const day = await db.menuDay.findUniqueOrThrow({ where: { menuId_day: { menuId: offer.menuId!, day: weekdayOf(date) } } });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${date}T02:15:00Z`)); // 08:00 in Kathmandu on the meal's day
    try {
      await db.menuDay.update({ where: { id: day.id }, data: { cutoffOverride: "07:30" } });
      const closed = (await mealWindows([meal], settings)).get(meal.id)!;
      expect(closed).toEqual({ open: false, cutoff: "07:30" });
      await expect(skipMeal(meal.id, { id: user.id, isStaff: false }, user.id)).rejects.toThrow(/closed at 07:30/);

      await db.menuDay.update({ where: { id: day.id }, data: { cutoffOverride: null } });
      const open = (await mealWindows([meal], settings)).get(meal.id)!;
      expect(open.cutoff).toBe(settings.orderCutoff);
      expect(open.open).toBe(settings.orderCutoff > "08:00");
    } finally {
      vi.useRealTimers();
      await db.menuDay.update({ where: { id: day.id }, data: { cutoffOverride: day.cutoffOverride } });
    }
  });

  it("pure window rules", () => {
    const now = { date: "2026-11-19", time: "08:00" };
    expect(windowOpen("2026-11-18", "23:59", now)).toBe(false);
    expect(windowOpen("2026-11-19", "07:30", now)).toBe(false);
    expect(windowOpen("2026-11-19", "09:30", now)).toBe(true);
    expect(windowOpen("2026-11-20", "00:00", now)).toBe(true);
    expect(hasCustomerAction({ status: "SKIPPED", source: "SUBSCRIPTION", paymentStatus: "PAID" })).toBe(true);
    expect(hasCustomerAction({ status: "SKIPPED", source: "SUBSCRIPTION", paymentStatus: "REFUNDED" })).toBe(false);
    expect(hasCustomerAction({ status: "CONFIRMED", source: "SINGLE", paymentStatus: "PAID" })).toBe(false);
  });
});

describe("isolation between two customers", () => {
  it("plans, lunches and calendars never leak across accounts", async () => {
    const { user: ua } = await customer(A);
    const { user: ub } = await customer(B);
    const aPlans = await dashboardPlans(ua.id);
    const bPlans = await dashboardPlans(ub.id);
    expect(aPlans.length).toBeGreaterThan(0);
    const aSubs = await db.subscription.findMany({ where: { userId: ua.id }, select: { id: true } });
    expect(bPlans.some((p) => aSubs.some((s) => s.id === p.id))).toBe(false);

    const bUpcoming = await upcomingLunches(ub.id, { from: todayKTM(), days: 31 });
    expect(bUpcoming.every((o) => o.userId === ub.id)).toBe(true);
    const aIds = new Set((await upcomingLunches(ua.id, { from: todayKTM(), days: 31 })).map((o) => o.id));
    expect(bUpcoming.some((o) => aIds.has(o.id))).toBe(false);
  });

  it("offers Renew for a paid plan inside its reminder window", async () => {
    const { user: ua } = await customer(A);
    const sub = await db.subscription.findFirstOrThrow({ where: { userId: ua.id, planId }, orderBy: { createdAt: "desc" } });
    await db.subscription.update({ where: { id: sub.id }, data: { status: "PENDING_PAYMENT" } });
    expect((await dashboardPlans(ua.id)).find((p) => p.id === sub.id)?.renewDue).toBe(false); // unpaid: no renew prompt
    await db.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE" } });
    const plan = (await dashboardPlans(ua.id)).find((p) => p.id === sub.id);
    expect(plan?.renewDue).toBe(true); // ends within the plan's 30-day reminder window, nothing renews it
    const { user: ub } = await customer(B);
    expect((await dashboardPlans(ub.id)).find((p) => p.id === sub.id)).toBeUndefined();
  });
});
