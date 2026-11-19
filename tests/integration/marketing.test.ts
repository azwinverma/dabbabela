import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, todayKTM } from "@/lib/dates";
import type { CurrentUser } from "@/lib/auth";
import { placeCartOrder, quoteCart } from "@/server/orders";
import { checkCoupon, checkCoupons, couponUsage, saveCouponRecord, type CouponInput } from "@/server/coupons";
import {
  addCampaignSpend,
  campaignPerformance,
  claimReferral,
  decideReferral,
  ensureReferralCode,
  getReferralSettings,
  importLegacySpend,
  saveCampaign,
  saveReferralSettings,
  settleReferral,
  settleReferralFor,
} from "@/server/marketing";
import { NOT_BOOKED } from "@/server/analytics/metrics";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

let owner: CurrentUser;
let zoneId: string;
let area: string;
const couponIds: string[] = [];
let n = 0;

async function customer(tag: string, opts: { line1?: string; phone?: string; attribution?: Record<string, unknown> } = {}) {
  n++;
  const email = `wp15.${tag}@test.local`;
  const u = await db.user.create({ data: { name: `WP15 ${tag}`, email, emailVerified: true, attribution: opts.attribution as never } });
  await db.address.create({
    data: { userId: u.id, label: "Office", recipientName: `WP15 ${tag}`, phone: opts.phone ?? `+97798100${String(1000 + n).padStart(5, "0")}`, line1: opts.line1 ?? `WP15 building ${tag}`, area, zoneId, isDefault: true },
  });
  return loadUser(email);
}

const base = (code: string, over: Partial<CouponInput> = {}): CouponInput => ({
  code,
  description: null,
  type: "PERCENT",
  value: 10,
  scope: "ALL",
  minSubtotal: 0,
  maxDiscount: null,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  perUserLimit: 1,
  firstOrderOnly: false,
  isActive: true,
  freeDelivery: false,
  boxIds: [],
  stackable: false,
  campaignId: null,
  ...over,
});

async function coupon(code: string, over: Partial<CouponInput> = {}) {
  const c = await saveCouponRecord(owner, null, base(code, over));
  couponIds.push(c.id);
  return c;
}

async function order(user: CurrentUser, date: string, extra: { couponCode?: string; attribution?: Record<string, string> } = {}) {
  const box = await primaryBoxOn(date);
  return placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date, qty: 1 }], addressId: user.addresses[0].id, method: "CASH", ...extra });
}

beforeAll(async () => {
  owner = await loadUser("owner@test.local");
  const b = await loadUser("customer.b@demo.dabbabela.local");
  zoneId = b.addresses[0].zoneId!;
  area = b.addresses[0].area;
});

afterAll(async () => {
  await db.coupon.updateMany({ where: { id: { in: couponIds } }, data: { isActive: false } });
  // Free the dabba / kitchen capacity our orders took, so other files that run later on the same days aren't affected.
  await db.order.updateMany({ where: { user: { email: { startsWith: "wp15." } } }, data: { status: "CANCELLED", cancelledAt: new Date() } });
});

describe("coupons", () => {
  it("accepts a free-delivery-only coupon (0 discount) and refuses a coupon with neither", async () => {
    await expect(coupon("WP15NOTHING", { type: "FLAT", value: 0 })).rejects.toThrow(/discount or free delivery/);
    await coupon("WP15SHIP", { type: "FLAT", value: 0, freeDelivery: true });
    const u = await customer("ship");
    const r = await checkCoupon("wp15ship", { userId: u.id, base: 500_00, scope: "ORDERS" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.discount).toBe(0);
    const d = serviceDay(12, 0);
    const box = await primaryBoxOn(d);
    const q = await quoteCart(u, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: u.addresses[0].id, couponCode: "WP15SHIP" });
    expect(q.couponError).toBeNull();
    expect(q.couponDiscount).toBe(0);
    expect(q.deliveryFee).toBe(0);
    const log = await db.auditLog.findFirst({ where: { action: "coupon.create", summary: "WP15SHIP" } });
    expect(log?.actorId).toBe(owner.id);
  });

  it("checks a box-scoped minimum order on the eligible lines only", async () => {
    const c = await db.coupon.create({ data: { code: "WP15BOXMIN", type: "PERCENT", value: 10, minSubtotal: 300_00, perUserLimit: null, boxIds: ["box-a"] } });
    couponIds.push(c.id);
    const u = await customer("boxmin");
    const lines = [
      { date: "2030-01-01", unitPrice: 200_00, unitCost: 0, qty: 1, boxId: "box-a" },
      { date: "2030-01-01", unitPrice: 500_00, unitCost: 0, qty: 1, boxId: "box-b" },
    ];
    // Whole cart (Rs 700) is above the minimum, but the covered dabba is only Rs 200.
    const short = await checkCoupon("WP15BOXMIN", { userId: u.id, base: 700_00, scope: "ORDERS", lines });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toMatch(/of the dabbas it covers/);
    const enough = await checkCoupon("WP15BOXMIN", { userId: u.id, base: 900_00, scope: "ORDERS", lines: [{ ...lines[0], qty: 2 }, lines[1]] });
    expect(enough.ok).toBe(true);
    if (enough.ok) expect(enough.discount).toBe(40_00); // 10% of the Rs 400 of covered dabbas
    const none = await checkCoupon("WP15BOXMIN", { userId: u.id, base: 500_00, scope: "ORDERS", lines: [lines[1]] });
    expect(none.ok).toBe(false);
    // Older callers without lines keep the whole-base check.
    expect((await checkCoupon("WP15BOXMIN", { userId: u.id, base: 700_00, scope: "ORDERS" })).ok).toBe(true);
  });

  it("enforces the per-customer limit under concurrent checkouts", async () => {
    await coupon("WP15ONCE", { perUserLimit: 1 });
    const u = await customer("once");
    const [d1, d2] = [serviceDay(12, 1), serviceDay(12, 2)]; // different days → different kitchen-day locks
    const results = await Promise.allSettled([order(u, d1, { couponCode: "WP15ONCE" }), order(u, d2, { couponCode: "WP15ONCE" })]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message)).toMatch(/already used/);
    const c = await db.coupon.findUniqueOrThrow({ where: { code: "WP15ONCE" } });
    expect(await db.couponRedemption.count({ where: { couponId: c.id, userId: u.id } })).toBe(1);
    expect(c.usedCount).toBe(1);
    const usage = (await couponUsage([c.id])).get(c.id)!;
    expect(usage).toMatchObject({ redemptions: 1, customers: 1, orders: 1 });
  });

  it("refuses stacking unless every code is stackable, and never lets a total go below 0", async () => {
    await coupon("WP15S1", { perUserLimit: null });
    await coupon("WP15S2", { perUserLimit: null });
    await coupon("WP15K1", { perUserLimit: null, stackable: true });
    await coupon("WP15K2", { perUserLimit: null, stackable: true });
    const u = await customer("stack");
    const opts = { userId: u.id, base: 500_00, scope: "ORDERS" as const };
    const refused = await checkCoupons(["WP15S1", "WP15S2"], opts);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/can't be combined/);
    expect((await checkCoupons(["WP15S1", "WP15K1"], opts)).ok).toBe(false);
    const both = await checkCoupons(["WP15K1", "WP15K2"], opts);
    expect(both.ok && both.coupons.length).toBe(2);

    await coupon("WP15HUGE", { type: "FLAT", value: 100_000_00, perUserLimit: null });
    const d = serviceDay(12, 3);
    const box = await primaryBoxOn(d);
    const q = await quoteCart(u, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: u.addresses[0].id, couponCode: "WP15HUGE" });
    expect(q.couponError).toBeNull();
    expect(q.couponDiscount).toBeLessThanOrEqual(q.subtotal);
    expect(q.total).toBeGreaterThanOrEqual(0);
    for (const day of q.days) expect(day.total).toBeGreaterThanOrEqual(0);
  });
});

describe("campaigns", () => {
  it("attributes orders and sign-ups and reports performance equal to the underlying records", async () => {
    const content = await loadUser("content@demo.dabbabela.local");
    const c = await saveCampaign(content, null, { name: "WP15 Spring", channel: "FACEBOOK", utmCampaign: "wp15-spring", budget: 10_000_00, isActive: true });
    await expect(saveCampaign(owner, null, { name: "Dup", channel: "GOOGLE", utmCampaign: "WP15-SPRING", isActive: true })).rejects.toThrow(/already uses/);
    const today = todayKTM();
    await addCampaignSpend(owner, c.id, { date: today, amount: 5_000_00 });
    await addCampaignSpend(owner, c.id, { date: addDays(today, -1), amount: 2_500_00 });
    await addCampaignSpend(owner, c.id, { date: addDays(today, -60), amount: 9_99 }); // outside the period
    // A sign-up whose first touch is this campaign (UTM case differs).
    await db.user.create({ data: { name: "WP15 Signup", email: "wp15.signup@test.local", acquisitionSource: "facebook", attribution: { source: "facebook", campaign: "WP15-SPRING", at: new Date().toISOString() } } });
    const u = await customer("camp", { attribution: { source: "google", campaign: "something-else", at: new Date().toISOString() } });
    const attribution = { source: "facebook", campaign: "wp15-spring", campaignId: c.id };
    const o1 = (await order(u, serviceDay(12, 4), { attribution })).orders[0];
    await order(u, serviceDay(12, 5), { attribution });
    await db.order.update({ where: { id: o1.id }, data: { status: "DELIVERED", paymentStatus: "PAID", deliveredAt: new Date() } });

    const from = addDays(today, -7);
    const to = addDays(today, 60);
    const perf = (await campaignPerformance(owner, { from, to, campaignIds: [c.id] })).get(c.id)!;
    const delivered = await db.order.findUniqueOrThrow({ where: { id: o1.id } });
    const booked = await db.order.count({ where: { campaignId: c.id, subscriptionId: null, status: { notIn: NOT_BOOKED } } });
    expect(perf.spend).toBe(7_500_00);
    expect(perf.spendToDate).toBe(7_500_00 + 9_99);
    expect(perf.signups).toBe(1);
    expect(perf.orders).toBe(booked);
    expect(perf.orders).toBe(2);
    expect(perf.deliveredOrders).toBe(1);
    expect(perf.revenue).toBe(delivered.total - delivered.tax - delivered.refundedAmount);
    expect(perf.newCustomers).toBe(1);
    expect(perf.cac).toBe(7_500_00);
    expect(perf.roas).toBeCloseTo(perf.revenue! / 7_500_00);

    // First touch: the buyer's first visit was another campaign, so none of their orders count here.
    const first = (await campaignPerformance(owner, { from, to, model: "first", campaignIds: [c.id] })).get(c.id)!;
    expect(first.orders).toBe(0);
    expect(first.signups).toBe(1);

    // No marketing access → refused; content editor without analytics.view sees no revenue.
    await expect(campaignPerformance(u, { from, to })).rejects.toThrow(/permission/);
    const forContent = (await campaignPerformance(content, { from, to, campaignIds: [c.id] })).get(c.id)!;
    expect(forContent.orders).toBe(2);
    expect(await db.auditLog.count({ where: { entityId: c.id, action: { in: ["campaign.create", "campaign.spend_add"] } } })).toBe(4);
  });

  it("imports the legacy monthly spend once", async () => {
    await db.setting.upsert({ where: { key: "marketing.spend" }, create: { key: "marketing.spend", value: { "2026-09": 12_000_00, "2026-10": 8_000_00 } }, update: { value: { "2026-09": 12_000_00, "2026-10": 8_000_00 } } });
    const a = await importLegacySpend(owner);
    expect(a.imported).toBe(2);
    const b = await importLegacySpend(owner);
    expect(b.imported).toBe(0);
    expect(await db.campaignSpend.aggregate({ where: { campaignId: a.campaignId! }, _sum: { amount: true } })).toMatchObject({ _sum: { amount: 20_000_00 } });
  });
});

describe("referrals", () => {
  let referrer: CurrentUser;
  let code: string;

  beforeAll(async () => {
    await saveReferralSettings(owner, { enabled: true, refereeType: "FLAT", refereeValue: 100_00, refereeMaxDiscount: null, refereeMinSubtotal: 0, referrerReward: 150_00, maxRewardsPerReferrer: 20, maxRewardsPerMonth: 5 });
    referrer = await customer("referrer", { line1: "Sita Niwas 4th floor" });
    code = (await ensureReferralCode(referrer.id)).code;
  });

  it("refuses self-referral and a second friend's code", async () => {
    const self = await claimReferral(referrer.id, code);
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.error).toMatch(/own/);
    const other = await customer("referrer2");
    const otherCode = (await ensureReferralCode(other.id)).code;
    const e = await customer("dup");
    expect((await claimReferral(e.id, code)).ok).toBe(true);
    const again = await claimReferral(e.id, otherCode);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already used/);
    expect(await db.referral.count({ where: { refereeId: e.id } })).toBe(1);
  });

  it("refuses customers who already ordered and holds look-alike accounts", async () => {
    const old = await customer("old");
    await order(old, serviceDay(12, 6));
    const r = await claimReferral(old.id, code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/new customers/);
    const twin = await customer("twin", { line1: "Sita niwas, 4th floor" });
    const held = await claimReferral(twin.id, code);
    expect(held.ok && held.status).toBe("HELD");
    const dec = await decideReferral(owner, held.ok ? held.referralId : "", true, "Same building, different office — checked by phone");
    expect(dec.status).toBe("APPROVED");
    expect(await db.auditLog.count({ where: { action: "referral.approve", entityId: held.ok ? held.referralId : "" } })).toBe(1);
  });

  it("gives the friend the welcome discount and rewards the referrer once, only after delivered + paid", async () => {
    const s = await getReferralSettings();
    const friend = await customer("friend");
    const d = serviceDay(12, 7);
    const box = await primaryBoxOn(d);
    // The managed welcome code can't be typed directly.
    const welcome = await db.coupon.findUniqueOrThrow({ where: { id: s.couponId! } });
    expect((await checkCoupon(welcome.code, { userId: friend.id, base: 500_00, scope: "ORDERS" })).ok).toBe(false);

    const q = await quoteCart(friend, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: friend.addresses[0].id, couponCode: code.toLowerCase() });
    expect(q.couponError).toBeNull();
    expect(q.couponDiscount).toBe(Math.min(100_00, q.subtotal));
    const placed = await order(friend, d, { couponCode: code });
    const o = placed.orders[0];
    expect(o.couponCode).toBe(code);
    const ref = await db.referral.findUniqueOrThrow({ where: { refereeId: friend.id } });
    expect(ref.status).toBe("PENDING");
    expect(await db.couponRedemption.count({ where: { couponId: welcome.id, userId: friend.id } })).toBe(1);

    expect((await settleReferralFor(friend.id))?.outcome).toBe("NOT_YET");
    await db.order.update({ where: { id: o.id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    expect((await settleReferral(ref.id)).outcome).toBe("NOT_YET"); // delivered but not paid
    await db.order.update({ where: { id: o.id }, data: { paymentStatus: "PAID" } });

    const results = await Promise.all([settleReferral(ref.id), settleReferral(ref.id), settleReferral(ref.id)]);
    expect(results.filter((r) => r.outcome === "REWARDED").length).toBe(1);
    expect(results.filter((r) => r.outcome === "ALREADY").length).toBe(2);
    const ledger = await db.creditLedger.findMany({ where: { userId: referrer.id, reason: "REFERRAL" } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(150_00);
    expect(ledger[0].orderId).toBe(o.id);
    const after = await db.referral.findUniqueOrThrow({ where: { id: ref.id } });
    expect(after).toMatchObject({ status: "REWARDED", rewardLedgerId: ledger[0].id, qualifiedOrderId: o.id });
    expect((await settleReferral(ref.id)).outcome).toBe("ALREADY");
    expect(await db.creditLedger.count({ where: { userId: referrer.id, reason: "REFERRAL" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "referral.reward", entityId: ref.id } })).toBe(1);

    // The welcome coupon is first-order only: a second order with the code is refused.
    const q2 = await quoteCart(friend, { lines: [{ kind: "box", id: box.id, date: serviceDay(12, 8), qty: 1 }], addressId: friend.addresses[0].id, couponCode: code });
    expect(q2.couponError).toMatch(/already used|first order/);
  });
});
