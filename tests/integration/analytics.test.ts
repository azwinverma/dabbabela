import { beforeAll, describe, expect, it } from "vitest";
import type { Diet, OrderPaymentStatus, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, weekdayOf } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { NONE, parseFilters, type AnalyticsFilters } from "@/server/analytics/filters";
import * as rev from "@/server/analytics/revenue";
import * as ops from "@/server/analytics/orders";
import * as subs from "@/server/analytics/subscriptions";
import * as cust from "@/server/analytics/customers";
import { drill } from "@/server/analytics/transactions";
import { ExportDenied, exportAnalyticsCsv } from "@/server/analytics/export";
import { ensureFoundationData } from "@/server/foundation";
import { loadUser } from "../helpers";

/**
 * WP-02 metric validation. A fixed dataset lives in two brand-new kitchens in March 2021 (no other test touches
 * those kitchens or dates), and every metric is asserted against values computed by hand from these rows
 * (the arithmetic is written out next to each expectation).
 */

const R = { from: "2021-03-01", to: "2021-03-31" };
const at = (d: string, time = "10:00") => new Date(`${d}T${time}:00+05:45`);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
let n = 0;

const ids = {} as { k1: string; k2: string; z1: string; z2: string; company: string; plan: string; cat: string; box: string; u1: string; u2: string; u3: string; s1: string; s2: string; o1: string; o2: string };
let F: AnalyticsFilters; // kitchen K1, March 2021

async function order(o: {
  user: string;
  kitchen: string;
  zone?: string | null;
  company?: string | null;
  created: Date;
  delivery: string;
  status: OrderStatus;
  pay?: OrderPaymentStatus;
  total: number;
  tax?: number;
  refunded?: number;
  cost?: number;
  packaging?: number;
  diet?: Diet;
  box?: string | null;
  sub?: string | null;
  payment?: string | null;
  slot?: string | null;
}) {
  n++;
  return db.order.create({
    data: {
      number: `AN-${n}-${Date.now()}`,
      code: `A${n}`,
      userId: o.user,
      kitchenId: o.kitchen,
      zoneId: o.zone ?? null,
      companyId: o.company ?? null,
      createdAt: o.created,
      deliveryDate: day(o.delivery),
      status: o.status,
      paymentStatus: o.pay ?? "PAID",
      source: o.sub ? "SUBSCRIPTION" : "SINGLE",
      contactName: "Test",
      contactPhone: "+9779811111111",
      addressLine: "Line",
      area: "Baneshwor",
      subtotal: o.total,
      total: o.total,
      tax: o.tax ?? 0,
      refundedAmount: o.refunded ?? 0,
      costTotal: o.cost ?? 0,
      packagingCost: o.packaging ?? 0,
      subscriptionId: o.sub ?? null,
      paymentId: o.payment ?? null,
      slotId: o.slot ?? null,
      items: { create: [{ name: "Dabba", components: [], diet: o.diet ?? "VEG", quantity: 1, unitPrice: o.total, lineTotal: o.total, boxId: o.box ?? null }] },
    },
  });
}

async function payment(p: { user: string; method: Prisma.PaymentCreateInput["method"]; status: Prisma.PaymentCreateInput["status"]; amount: number; paidAt?: Date | null; sub?: string; fee?: number; feeActual?: number | null }) {
  n++;
  return db.payment.create({
    data: { reference: `ANP-${n}-${Date.now()}`, userId: p.user, method: p.method, status: p.status, amount: p.amount, paidAt: p.paidAt ?? null, subscriptionId: p.sub ?? null, gatewayFee: p.fee ?? 0, feeActual: p.feeActual ?? null },
  });
}

beforeAll(async () => {
  const stamp = Date.now();
  const k1 = await db.kitchen.create({ data: { name: "Analytics K1", code: `AK1${stamp}`, dailyCapacity: 2 } });
  const k2 = await db.kitchen.create({ data: { name: "Analytics K2", code: `AK2${stamp}` } });
  const z1 = await db.deliveryZone.create({ data: { name: "AZ1", areas: [], wards: [], kitchenId: k1.id } });
  const z2 = await db.deliveryZone.create({ data: { name: "AZ2", areas: [], wards: [], kitchenId: k2.id } });
  const company = await db.company.create({ data: { name: "Analytics Co", slug: `analytics-co-${stamp}` } });
  const plan = await db.mealPlan.create({ data: { name: "Analytics Plan", slug: `analytics-plan-${stamp}`, pricePerMeal: 10000 } });
  // Like the app, every plan has a price row and subscriptions point at it (keeps the foundation backfill idempotent for other tests).
  const price = await db.mealPlanPrice.create({ data: { planId: plan.id, pricePerMeal: 10000, effectiveFrom: day("2021-01-01") } });
  const cat = await db.mealCategory.create({ data: { slug: `an-cat-${stamp}`, name: "Analytics Cat" } });
  const box = await db.lunchBox.create({ data: { name: "Analytics Box", slug: `an-box-${stamp}`, price: 20000, categoryId: cat.id } });
  const u1 = await db.user.create({ data: { name: "An One", email: `an1-${stamp}@test.local`, acquisitionSource: "instagram", diet: "VEG" } });
  const u2 = await db.user.create({ data: { name: "An Two", email: `an2-${stamp}@test.local` } });
  const u3 = await db.user.create({ data: { name: "An Three", email: `an3-${stamp}@test.local` } });
  Object.assign(ids, { k1: k1.id, k2: k2.id, z1: z1.id, z2: z2.id, company: company.id, plan: plan.id, cat: cat.id, box: box.id, u1: u1.id, u2: u2.id, u3: u3.id });
  const K1 = { kitchen: k1.id, zone: z1.id };

  // O0 — before the range (makes U1 a returning customer). recognised 5000 − 575 = 4425
  await order({ ...K1, user: u1.id, created: at("2021-02-09"), delivery: "2021-02-10", status: "DELIVERED", total: 5000, tax: 575 });

  // O1 — delivered, eSewa, box in category. recognised 20000 − 2301 = 17699
  const py1 = await payment({ user: u1.id, method: "ESEWA", status: "PAID", amount: 20000, paidAt: at("2021-03-02", "10:05"), fee: 300, feeActual: 280 });
  const o1 = await order({ ...K1, user: u1.id, created: at("2021-03-02"), delivery: "2021-03-03", status: "DELIVERED", total: 20000, tax: 2301, cost: 8000, packaging: 500, box: box.id, payment: py1.id });
  // O2 — corporate, cash, partly refunded 6000 (5000 bank + 1000 wallet credit). recognised 30000 − 3451 − 6000 = 20549
  const py2 = await payment({ user: u2.id, method: "CASH", status: "PARTIALLY_REFUNDED", amount: 30000, paidAt: at("2021-03-05") });
  const o2 = await order({ ...K1, user: u2.id, company: company.id, created: at("2021-03-04"), delivery: "2021-03-05", status: "DELIVERED", pay: "PARTIALLY_REFUNDED", total: 30000, tax: 3451, refunded: 6000, cost: 12000, diet: "CHICKEN", payment: py2.id });
  await db.refund.create({ data: { paymentId: py2.id, orderId: o2.id, amount: 5000, reason: "cold", method: "BANK", status: "PROCESSED", processedAt: at("2021-03-06") } });
  await db.refund.create({ data: { paymentId: py2.id, orderId: o2.id, amount: 1000, reason: "late", method: "WALLET_CREDIT", status: "PROCESSED", processedAt: at("2021-03-06") } });
  await db.creditLedger.create({ data: { userId: u2.id, amount: 1000, reason: "REFUND", orderId: o2.id } });
  // O3 — cancelled (not booked; cancelled value 15000)
  await order({ ...K1, user: u1.id, created: at("2021-03-06"), delivery: "2021-03-08", status: "CANCELLED", pay: "UNPAID", total: 15000 });
  // O4 — checkout never completed (not booked; pending payment 12000)
  const py4 = await payment({ user: u1.id, method: "KHALTI", status: "PENDING", amount: 12000 });
  await order({ ...K1, user: u1.id, created: at("2021-03-07"), delivery: "2021-03-09", status: "PENDING_PAYMENT", pay: "PENDING", total: 12000, payment: py4.id });
  // O6 — paid from wallet (booked, recognised, NOT cash). recognised 10000 − 1150 = 8850
  const py6 = await payment({ user: u1.id, method: "WALLET", status: "PAID", amount: 10000, paidAt: at("2021-03-10") });
  await order({ ...K1, user: u1.id, created: at("2021-03-10"), delivery: "2021-03-11", status: "DELIVERED", total: 10000, tax: 1150, cost: 4000, payment: py6.id });
  // O7 — packed, cash on delivery, delivery day already past → delayed; upcoming 8000 − 920 = 7080
  await order({ ...K1, user: u1.id, created: at("2021-03-19"), delivery: "2021-03-20", status: "PACKED", pay: "UNPAID", total: 8000, tax: 920 });
  // O5 — other kitchen. recognised 40000 − 4602 = 35398
  const py5 = await payment({ user: u3.id, method: "ESEWA", status: "PAID", amount: 40000, paidAt: at("2021-03-02") });
  await order({ kitchen: k2.id, zone: z2.id, user: u3.id, created: at("2021-03-02"), delivery: "2021-03-03", status: "DELIVERED", total: 40000, tax: 4602, payment: py5.id });

  // S1 — prepaid plan bought 2021-03-01 for 50000 (5 meals × 10000 share, VAT 1150 each)
  const s1 = await db.subscription.create({
    data: { reference: `AN-PLN-${stamp}`, userId: u1.id, planId: plan.id, status: "ACTIVE", startDate: day("2021-03-14"), endDate: day("2021-03-18"), days: ["SUN", "MON", "TUE", "WED", "THU"], mealsTotal: 5, pricePerMeal: 10000, priceId: price.id, subtotal: 50000, tax: 5752, total: 50000, createdAt: at("2021-03-01", "09:00") },
  });
  const pys = await payment({ user: u1.id, method: "ESEWA", status: "PAID", amount: 50000, paidAt: at("2021-03-01", "09:05"), sub: s1.id });
  const meals = ["2021-03-14", "2021-03-15", "2021-03-16", "2021-03-17", "2021-03-18"];
  for (const [i, d] of meals.entries())
    await order({ ...K1, user: u1.id, created: at("2021-03-01", "09:00"), delivery: d, status: i < 3 ? "DELIVERED" : "SCHEDULED", total: 10000, tax: 1150, cost: 3000, sub: s1.id, payment: pys.id });

  // S2 — bought in February, cancelled 2021-03-10 ("Moving away"); its remaining meal was cancelled (10000)
  const s2 = await db.subscription.create({
    data: { reference: `AN-PLN2-${stamp}`, userId: u2.id, planId: plan.id, status: "CANCELLED", cancelReason: "Moving away", startDate: day("2021-03-01"), endDate: day("2021-03-20"), days: ["MON"], mealsTotal: 2, pricePerMeal: 10000, priceId: price.id, subtotal: 20000, total: 20000, createdAt: at("2021-02-20"), updatedAt: at("2021-03-10") },
  });
  await order({ ...K1, user: u2.id, created: at("2021-02-20"), delivery: "2021-03-12", status: "CANCELLED", pay: "PAID", total: 10000, sub: s2.id });

  // Capacity override: K1 can cook nothing on 2021-03-15 (1 meal booked → over capacity)
  await db.kitchenCapacity.create({ data: { kitchenId: k1.id, date: day("2021-03-15"), maxMeals: 0 } });

  // Feedback, tickets
  await db.feedback.create({ data: { orderId: o1.id, userId: u1.id, rating: 5 } });
  await db.feedback.create({ data: { orderId: o2.id, userId: u2.id, rating: 3 } });
  await db.supportTicket.create({ data: { number: `AN-T1-${stamp}`, userId: u2.id, orderId: o2.id, subject: "Cold", category: "FOOD", createdAt: at("2021-03-06") } });
  await db.supportTicket.create({ data: { number: `AN-T2-${stamp}`, userId: u2.id, subject: "No order", category: "ACCOUNT", createdAt: at("2021-03-06") } });

  // Expenses (only APPROVED / PAID count)
  const cats = new Map((await db.expenseCategory.findMany()).map((c) => [c.key, c.id]));
  const exp = (key: string, amount: number, status: string, date: string) =>
    db.expense.create({ data: { number: `AN-E-${++n}-${stamp}`, date: day(date), categoryId: cats.get(key)!, kitchenId: k1.id, description: key, amount, status } });
  await exp("PACKAGING", 2000, "APPROVED", "2021-03-10");
  await exp("PACKAGING", 9999, "VOID", "2021-03-10");
  await exp("RENT", 50000, "PAID", "2021-03-01");
  await exp("RENT", 7777, "DRAFT", "2021-03-02");

  // Corporate contract for the run-rate
  await db.corporateContract.create({ data: { companyId: company.id, title: "Analytics contract", startsOn: day("2021-01-01"), status: "ACTIVE", pricePerMeal: 15000, minMealsPerDay: 10 } });

  Object.assign(ids, { s1: s1.id, s2: s2.id, o1: o1.id, o2: o2.id });
  F = { ...R, kitchenIds: [k1.id] };
});

describe("revenue bases", () => {
  it("bookings count a prepaid plan once at purchase and never its meals", async () => {
    const b = await rev.bookings(F);
    // single: O1 20000 + O2 30000 + O6 10000 + O7 8000 (O3 cancelled, O4 never paid, plan meals excluded)
    expect(b.single).toBe(68000);
    expect(b.singleCount).toBe(4);
    // plans: S1 50000 (S2 bought in February)
    expect(b.plans).toBe(50000);
    expect(b.total).toBe(118000);
    // the 5 meal orders were also created in range — counting them would have added 50000 again
    const mealOrders = await db.order.aggregate({ where: { subscriptionId: ids.s1 }, _sum: { total: true } });
    expect(mealOrders._sum.total).toBe(50000);
    expect(b.total).not.toBe(118000 + 50000);
  });

  it("cash = gateway/cash/bank payments in range − refunds paid out; wallet spends and wallet refunds move no cash", async () => {
    const c = await rev.cash(F);
    expect(c.collected).toBe(20000 + 30000 + 50000); // PY1 + PY2 + plan payment
    expect(c.payments).toBe(3);
    expect(c.refunds).toBe(5000); // bank refund only, wallet-credit refund excluded
    expect(c.net).toBe(95000);
    expect(c.walletSpend).toBe(10000);
  });

  it("recognised revenue = delivered meals net of VAT and refunds; plan meals recognised one by one", async () => {
    const r = await rev.recognised(F);
    // O1 17699 + O2 20549 + O6 8850 + 3 plan meals × 8850
    expect(r.value).toBe(17699 + 20549 + 8850 + 3 * 8850);
    expect(r.value).toBe(73648);
    expect(r.count).toBe(6);
    expect(r.vat).toBe(2301 + 3451 + 1150 + 3 * 1150);
    expect(r.aov).toBe(Math.round(73648 / 6));
    // cross-check with hand-written SQL
    const sql = await db.$queryRaw<{ v: bigint }[]>`SELECT SUM(total - tax - "refundedAmount") AS v FROM "Order" WHERE "kitchenId" = ${ids.k1} AND status = 'DELIVERED' AND "deliveryDate" BETWEEN '2021-03-01' AND '2021-03-31'`;
    expect(Number(sql[0].v)).toBe(r.value);
  });

  it("scheduled, cancelled and booked-by-delivery-date", async () => {
    const up = await rev.upcoming(F);
    expect(up.value).toBe(2 * 8850 + 7080); // M4, M5, O7
    expect(up.count).toBe(3);
    const c = await rev.cancelled(F);
    expect(c).toEqual({ value: 15000 + 10000, count: 2 }); // O3 + S2's meal
    const bd = await rev.bookedByDelivery(F);
    // statuses Scheduled→Delivered by delivery date: O1, O2, O6, O7, M1–M5
    expect(bd.gross).toBe(20000 + 30000 + 10000 + 8000 + 5 * 10000);
    expect(bd.net).toBe(bd.gross - 6000);
  });

  it("deferred revenue = paid undelivered meals (+ wallet when unfiltered)", async () => {
    const d = await rev.deferred(F);
    expect(d.plans).toBe(2 * 8850); // M4, M5 (O7 is unpaid cash on delivery)
    expect(d.planMeals).toBe(2);
    expect(d.single).toBe(0);
    expect(d.walletBalance).toBeNull(); // customer-level: not shown with a kitchen filter
    const all = await rev.deferred({ ...R, kitchenIds: null });
    const ledger = await db.creditLedger.aggregate({ _sum: { amount: true } });
    expect(all.walletBalance).toBe(ledger._sum.amount ?? 0);
    expect(all.total).toBe(all.orders + (ledger._sum.amount ?? 0));
  });

  it("receivables", async () => {
    const r = await rev.receivables(F);
    expect(r.pending).toBe(12000);
    expect(r.pendingCount).toBe(1);
    expect(r.invoicesOutstanding).toBeNull();
  });
});

describe("breakdowns reconcile to the KPI", () => {
  it("by plan, company, zone, kitchen, channel", async () => {
    const plan = await rev.byPlan(F);
    expect(plan).toEqual([
      { key: NONE, label: "Single orders (no plan)", value: 17699 + 20549 + 8850, count: 3 },
      { key: ids.plan, label: "Analytics Plan", value: 26550, count: 3 },
    ]);
    const company = await rev.byCompany(F);
    expect(company).toEqual([
      { key: NONE, label: "Individual customers", value: 73648 - 20549, count: 5 },
      { key: ids.company, label: "Analytics Co", value: 20549, count: 1 },
    ]);
    expect(await rev.byZone(F)).toEqual([{ key: ids.z1, label: "AZ1", value: 73648, count: 6 }]);
    const kitchens = await rev.byKitchen({ ...R, kitchenIds: [ids.k1, ids.k2] });
    expect(kitchens).toEqual([
      { key: ids.k1, label: "Analytics K1", value: 73648, count: 6 },
      { key: ids.k2, label: "Analytics K2", value: 35398, count: 1 },
    ]);
    const ch = await rev.byChannel(F);
    expect(ch.captured).toBe(true);
    expect(ch.rows).toEqual([
      { key: "instagram", label: "instagram", value: 17699 + 8850 + 26550, count: 5 },
      { key: NONE, label: "Not captured yet", value: 20549, count: 1 },
    ]);
  });

  it("category line value, method mix and plan bookings", async () => {
    expect(await rev.byCategory(F)).toEqual([
      { key: NONE, label: "Uncategorised / Build-a-Dabba", value: 30000 + 10000 + 3 * 10000, count: 5 },
      { key: ids.cat, label: "Analytics Cat", value: 20000, count: 1 },
    ]);
    const m = await rev.cashByMethod(F);
    expect(m.map((x) => [x.key, x.value, x.count, x.cash])).toEqual([
      ["ESEWA", 70000, 2, true],
      ["CASH", 30000, 1, true],
      ["WALLET", 10000, 1, false],
    ]);
    expect(m.filter((x) => x.cash).reduce((a, x) => a + x.value, 0)).toBe((await rev.cash(F)).collected);
    expect(await rev.planBookingsByPlan(F)).toEqual([{ key: ids.plan, label: "Analytics Plan", value: 50000, count: 1 }]);
  });

  it("trend buckets sum to the range totals for every bucket size", async () => {
    for (const bucket of rev.BUCKETS) {
      const t = await rev.trendSeries(F, bucket);
      expect(t.reduce((a, x) => a + x.recognised, 0)).toBe(73648);
      expect(t.reduce((a, x) => a + x.bookings, 0)).toBe(118000);
      expect(t.reduce((a, x) => a + x.cash, 0)).toBe(95000);
      expect(t[0].from).toBe("2021-03-01");
      expect(t[t.length - 1].to).toBe("2021-03-31");
    }
    const days = await rev.trendSeries(F, "day");
    expect(days.find((d) => d.key === "2021-03-01")).toMatchObject({ bookings: 50000, cash: 50000, recognised: 0 });
    expect(days.find((d) => d.key === "2021-03-06")).toMatchObject({ cash: -5000 });
    expect(days.find((d) => d.key === "2021-03-14")).toMatchObject({ recognised: 8850, delivered: 1, bookings: 0 });
    const weeks = await rev.trendSeries(F, "week");
    expect(weeks[0].key).toBe("2021-02-28"); // weeks start Sunday
  });

  it("period presets compare with the previous equivalent period", async () => {
    const p = await rev.periodTiles(F, "2021-03-18");
    const week = p.find((x) => x.key === "week")!; // 03-12..03-18 vs 03-05..03-11
    expect([week.from, week.to, week.prevFrom, week.prevTo]).toEqual(["2021-03-12", "2021-03-18", "2021-03-05", "2021-03-11"]);
    expect(week.recognised).toBe(26550);
    expect(week.recognisedGrowth).toBeCloseTo((26550 - (20549 + 8850)) / (20549 + 8850), 10);
    const month = p.find((x) => x.key === "month")!; // 03-01..03-18 vs 02-01..02-18
    expect(month.recognised).toBe(73648);
    expect(month.recognisedGrowth).toBeCloseTo((73648 - 4425) / 4425, 10);
    expect(p.find((x) => x.key === "today")!.recognisedGrowth).toBeNull(); // nothing delivered either day
  });
});

describe("global filters", () => {
  it("customer type, company, diet, plan, payment status, zone", async () => {
    expect((await rev.recognised({ ...F, customerType: "CORPORATE" })).value).toBe(20549);
    expect((await rev.recognised({ ...F, customerType: "INDIVIDUAL" })).value).toBe(73648 - 20549);
    expect((await rev.recognised({ ...F, companyId: ids.company })).value).toBe(20549);
    expect((await rev.recognised({ ...F, diet: "CHICKEN" })).value).toBe(20549);
    expect((await rev.recognised({ ...F, paymentStatus: "PARTIALLY_REFUNDED" })).value).toBe(20549);
    expect((await rev.recognised({ ...F, zoneId: ids.z2 })).value).toBe(0);
    const plan = { ...F, planId: ids.plan };
    expect((await rev.recognised(plan)).value).toBe(26550);
    expect(await rev.bookings(plan)).toMatchObject({ single: 0, plans: 50000 });
    const single = { ...F, planId: NONE };
    expect((await rev.recognised(single)).value).toBe(73648 - 26550);
    expect(await rev.bookings(single)).toMatchObject({ single: 68000, plans: 0 });
    // cash follows the orders a payment paid for
    expect((await rev.cash({ ...F, companyId: ids.company })).collected).toBe(30000);
  });

  it("kitchen scope: a scoped user can't widen to another kitchen", async () => {
    const scoped = { kitchenIds: [ids.k2] };
    const f = parseFilters({ ...R, kitchen: ids.k1 }, scoped);
    expect(f.kitchenIds).toEqual([ids.k2]);
    expect((await rev.recognised(f)).value).toBe(35398);
    expect((await rev.byKitchen(f)).map((k) => k.key)).toEqual([ids.k2]);
    const unscoped = parseFilters({ ...R, kitchen: ids.k1 }, { kitchenIds: null });
    expect(unscoped.kitchenIds).toEqual([ids.k1]);
    // junk params are dropped
    const junk = parseFilters({ from: "2021-13-40", status: "NOPE", pay: "x';--", kitchen: "a b" }, { kitchenIds: null });
    expect([junk.orderStatus, junk.paymentStatus, junk.kitchenIds]).toEqual([undefined, undefined, null]);
  });
});

describe("pipeline and plans", () => {
  it("status counts, delayed and over-capacity", async () => {
    const s = new Map((await ops.statusCounts(F)).map((x) => [x.status, x.count]));
    expect([s.get("DELIVERED"), s.get("CANCELLED"), s.get("PENDING_PAYMENT"), s.get("SCHEDULED"), s.get("PACKED")]).toEqual([6, 2, 1, 2, 1]);
    expect(await ops.delayedCount(F)).toBe(1); // O7, delivery day long past
    expect(await ops.overCapacity(F, "2021-03-14")).toEqual([{ kitchenId: ids.k1, kitchen: "Analytics K1", date: "2021-03-15", meals: 1, capacity: 0 }]);
  });

  it("run-rate, renewals, expected meals, churn, cancel reasons", async () => {
    const rr = await subs.runRate(F, "2021-03-15");
    expect(rr.plans).toBe(Math.round(((50000 - 5752) / 5) * 30)); // S1: plan days 03-14..03-18 = 5
    expect(rr.contracts).toBeNull(); // contracts have no kitchen dimension
    const settings = await getSettings();
    let serviceDays = 0;
    for (let i = 0; i < 30; i++) if (settings.deliveryDays.includes(weekdayOf(addDays("2021-03-15", i)))) serviceDays++;
    const co = await subs.runRate({ ...R, kitchenIds: null, companyId: ids.company }, "2021-03-15");
    expect(co.plans).toBe(0);
    expect(co.contracts).toBe(15000 * 10 * serviceDays);
    expect(await subs.renewalsDue(F, "2021-03-14")).toBe(1);
    const em = await subs.expectedMeals(F, "2021-03-14");
    expect(em.week).toBe(2);
    expect(em.perDay.filter((d) => d.meals).map((d) => d.date)).toEqual(["2021-03-17", "2021-03-18"]);
    expect(await subs.churn(F)).toEqual({ activeAtStart: 1, cancelled: 1, rate: 1 });
    expect(await subs.cancelReasons(F)).toEqual([{ reason: "Moving away", count: 1 }]);
    expect(await subs.planStatusCounts(F)).toMatchObject({ active: 1, cancelled: 1, paused: 0 });
  });
});

describe("customers", () => {
  it("active, new, returning, frequency, LTV, top customers", async () => {
    expect(await cust.customerStats(F)).toEqual({ active: 2, newCustomers: 1, returning: 1, deliveredOrders: 6, frequency: 3 });
    // U1: 4425 + 17699 + 8850 + 26550 = 57524 · U2: 20549
    expect(await cust.ltv(F)).toEqual({ customers: 2, total: 57524 + 20549, average: Math.round((57524 + 20549) / 2) });
    const top = await cust.topCustomers(F);
    expect(top.map((t) => [t.userId, t.value, t.orders])).toEqual([
      [ids.u1, 53099, 5],
      [ids.u2, 20549, 1],
    ]);
  });

  it("diet mix, ratings, complaints", async () => {
    expect(await cust.dietMix(F)).toEqual(expect.arrayContaining([{ diet: "VEG", count: 1 }, { diet: "ANY", count: 1 }]));
    expect(await cust.ratings(F)).toEqual({ average: 4, count: 2 });
    const c = await cust.complaints(F);
    expect(c.total).toBe(1); // the ticket without an order isn't attributable to a kitchen
    expect(c.byCategory).toEqual([{ category: "FOOD", count: 1 }]);
    expect(c.weekly).toEqual([{ week: "2021-02-28", count: 1 }]);
  });
});

describe("profitability", () => {
  it("estimated vs recorded, with 'no data' instead of zero", async () => {
    const p = await rev.profitability(F);
    expect(p.revenue).toBe(73648);
    const l = Object.fromEntries(p.lines.map((x) => [x.key, x]));
    expect([l.food.estimated, l.food.actual]).toEqual([8000 + 12000 + 4000 + 3 * 3000, null]);
    expect([l.packaging.estimated, l.packaging.actual]).toEqual([500, 2000]); // VOID expense ignored
    expect([l.delivery.estimated, l.delivery.actual]).toEqual([null, null]);
    expect([l.gateway.estimated, l.gateway.actual]).toEqual([300, 280]);
    expect([l.overheads.estimated, l.overheads.actual]).toEqual([null, 50000]); // DRAFT rent ignored
    expect(p.contribution).toBe(73648 - (33000 + 500 + 300));
    expect(p.operating).toBe(73648 - (33000 + 2000 + 280 + 50000));
    expect(p.coverage).toBe(4);
  });
});

describe("drill-down and export", () => {
  it("every drill list totals to its metric", async () => {
    const cases: [Parameters<typeof drill>[0], AnalyticsFilters, number, number][] = [
      ["recognised", F, 6, 73648],
      ["bookings", F, 4, 68000],
      ["plans", F, 1, 50000],
      ["cash", F, 3, 100000],
      ["cash", { ...F, method: "WALLET" }, 1, 10000],
      ["refunds", F, 1, 5000],
      ["cancelled", F, 2, 25000],
      ["upcoming", F, 3, 24780],
      ["deferred", F, 2, 17700],
      ["receivables", F, 1, 12000],
      ["delayed", F, 1, 8000],
      ["recognised", { ...F, categoryId: ids.cat }, 1, 17699],
      ["recognised", { ...F, channel: NONE }, 1, 20549],
      ["recognised", { ...F, zoneId: ids.z1 }, 6, 73648],
    ];
    for (const [basis, f, count, sum] of cases) {
      const r = await drill(basis, f, { page: 1 });
      expect([basis, r.count, r.sum]).toEqual([basis, count, sum]);
      expect(r.rows.length).toBe(count);
    }
    expect((await drill("runrate", F, { today: "2021-03-15" })).count).toBe(1);
    expect((await drill("renewals", F, { today: "2021-03-14" })).count).toBe(1);
  });

  it("export needs analytics.export, masks PII without customers.pii, and is audited", async () => {
    const chef = await loadUser("chef@demo.dabbabela.local");
    await expect(exportAnalyticsCsv(chef, { ...R, kitchen: ids.k1 })).rejects.toBeInstanceOf(ExportDenied);

    const finance = await loadUser("finance@demo.dabbabela.local");
    const out = await exportAnalyticsCsv(finance, { ...R, kitchen: ids.k1, basis: "plans" });
    expect(out.rows).toBe(1);
    const u1 = await db.user.findUniqueOrThrow({ where: { id: ids.u1 } });
    expect(out.body).not.toContain(u1.email);
    const log = await db.auditLog.findFirst({ where: { action: "analytics.export", actorId: finance.id }, orderBy: { createdAt: "desc" } });
    expect(log?.entityId).toBe("plans");
    expect((log?.after as { piiMasked: boolean }).piiMasked).toBe(true);

    const owner = await loadUser("owner@test.local");
    const full = await exportAnalyticsCsv(owner, { ...R, kitchen: ids.k1, basis: "plans" });
    expect(full.body).toContain(u1.email);
    expect(full.body.split("\r\n")[1]).toContain("500.00"); // plan total in rupees
  });
});

describe("test hygiene", () => {
  it("leaves foundation backfills idempotent for other test files", async () => {
    expect(Object.values(await ensureFoundationData(db)).every((x) => x === 0)).toBe(true);
  });
});
