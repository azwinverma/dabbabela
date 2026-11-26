import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { addDays, dateOnly, todayKTM } from "@/lib/dates";
import { pruneRateLimits, rateLimit, rateLimitPeek, slidingCount } from "@/lib/rate-limit";
import { COUPON_BLOCKED, withCouponGuard } from "@/lib/coupon-guard";
import { createSubscription, cancelSubscription } from "@/server/subscriptions";
import { approveRefund, markPaymentPaid, processRefund, rejectRefund } from "@/server/payments";
import { ageing, uninvoicedByCompany } from "@/server/invoices";
import { bearerFor, call } from "../api-helpers";
import { loadUser, serviceDay } from "../helpers";
import * as subsQuote from "@/app/api/v1/subscriptions/quote/route";
import * as cartQuote from "@/app/api/v1/cart/quote/route";
import { primaryBoxOn } from "../helpers";

/** 2026-11-26 gap closure: limiter window edge, coupon budget on plan quotes, plan-cancel refund rollback, invoice scope. */

const T = `${Date.now()}`;
let seq = 0;
async function freshCustomer(tag: string) {
  seq++;
  const b = await loadUser("customer.b@demo.dabbabela.local");
  const a = b.addresses[0];
  const u = await db.user.create({ data: { name: `Gap ${tag} ${seq}`, email: `gap-${tag}-${seq}-${T}@test.local`, role: "CUSTOMER" } });
  await db.address.create({ data: { userId: u.id, label: a.label, type: a.type, recipientName: u.name, phone: a.phone, placeName: a.placeName, line1: a.line1, area: a.area, zoneId: a.zoneId, isDefault: true } });
  return loadUser(u.email);
}
async function staff(role: "FINANCE" | "OPERATIONS_MANAGER", tag: string) {
  seq++;
  return db.user.create({ data: { name: `Gap ${role} ${seq}`, email: `gap-${role.toLowerCase()}-${tag}-${seq}-${T}@test.local`, role } });
}

afterEach(() => vi.useRealTimers());

describe("sliding-window rate limiter", () => {
  it("weights the previous window, so a client can't burst 2× max across a window edge", async () => {
    expect(slidingCount(1, 10, 0, 60_000)).toBe(11);
    expect(slidingCount(1, 10, 30_000, 60_000)).toBe(6);
    expect(slidingCount(1, 10, 60_000, 60_000)).toBe(1);
    const W = 60_000;
    const start = Math.ceil(Date.now() / W) * W + 10 * W; // a window boundary in the future
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start - 1_000); // last second of window n
    const id = `edge-${T}`;
    for (let i = 0; i < 5; i++) expect(await rateLimit("gap-edge", id, 5, W)).toBe(true);
    expect(await rateLimit("gap-edge", id, 5, W)).toBe(false);
    vi.setSystemTime(start + 1_000); // first second of window n+1: a fixed window would allow 5 more here
    expect(await rateLimitPeek("gap-edge", id, 5, W)).toBe(false);
    expect(await rateLimit("gap-edge", id, 5, W)).toBe(false);
    vi.setSystemTime(start + W + W / 2); // the burst has slid out
    expect(await rateLimit("gap-edge", id, 5, W)).toBe(true);
  });

  it("prunes old limiter rows but leaves Better Auth's rows", async () => {
    await db.rateLimit.create({ data: { key: `rl:gap-old:${T}:w1`, count: 3, lastRequest: BigInt(Date.now() - 5 * 3600_000) } });
    await db.rateLimit.create({ data: { key: `ba-gap-${T}`, count: 3, lastRequest: BigInt(Date.now() - 5 * 3600_000) } });
    await pruneRateLimits();
    expect(await db.rateLimit.count({ where: { key: `rl:gap-old:${T}:w1` } })).toBe(0);
    expect(await db.rateLimit.count({ where: { key: `ba-gap-${T}` } })).toBe(1);
  });
});

describe("coupon budget", () => {
  it("wrong codes on plan quotes count toward the same per-IP budget as cart quotes (web + API)", async () => {
    const ip = "198.51.100.201";
    const q = async (code: string | null) => ({ couponError: code ? "No such coupon" : null, code });
    for (let i = 0; i < 9; i++) expect((await withCouponGuard(`NOPE${i}`, q, ip)).couponError).toBe("No such coupon");
    // 10th wrong code through the API plan quote, 11th through the API cart quote → blocked (codes not checked).
    const u = await loadUser("customer.b@demo.dabbabela.local");
    const token = await bearerFor(u.email, "demo-pass-123");
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "do-hapta" } });
    const tenth = await call(subsQuote.POST, "POST", "/subscriptions/quote", { token, ip, body: { planId: plan.id, startDate: serviceDay(9), days: ["MON", "WED"], addressId: u.addresses[0].id, couponCode: "NOPE-PLAN" } });
    expect(tenth.status).toBe(200);
    expect(tenth.body.data.couponError).toBeTruthy();
    expect(tenth.body.data.couponError).not.toBe(COUPON_BLOCKED);
    const date = serviceDay(9, 2);
    const box = await primaryBoxOn(date);
    const eleventh = await call(cartQuote.POST, "POST", "/cart/quote", { token, ip, body: { lines: [{ kind: "box", id: box.id, date, qty: 1 }], couponCode: "NOPE-CART" } });
    expect(eleventh.body.data.couponError).toBe(COUPON_BLOCKED);
    const planBlocked = await call(subsQuote.POST, "POST", "/subscriptions/quote", { token, ip, body: { planId: plan.id, startDate: serviceDay(9), days: ["MON", "WED"], addressId: u.addresses[0].id, couponCode: "ANY" } });
    expect(planBlocked.body.data.couponError).toBe(COUPON_BLOCKED);
    // No code → no coupon check at all, never blocked.
    expect((await withCouponGuard(null, q, ip)).couponError).toBeNull();
  });
});

describe("plan-cancel REFUND settlement", () => {
  it("rejecting the refund rolls the cancelled meals' refunded amounts back; processing marks them refunded", async () => {
    const ops = await staff("OPERATIONS_MANAGER", "ops");
    const fin = await staff("FINANCE", "fin");
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "do-hapta" } });

    const u = await freshCustomer("rej");
    const sub = await createSubscription(u, { planId: plan.id, startDate: serviceDay(9), days: ["SUN", "TUE"], addressId: u.addresses[0].id, method: "ESEWA" });
    await markPaymentPaid(sub.payment.id, { amount: sub.payment.amount });
    await cancelSubscription(sub.subscription.id, { id: ops.id, isStaff: true }, { reason: "moving", settlement: "REFUND" });
    const [refund] = await db.refund.findMany({ where: { paymentId: sub.payment.id } });
    const meals = () => db.order.findMany({ where: { subscriptionId: sub.subscription.id, status: "CANCELLED" } });
    const before = await meals();
    expect(before.reduce((a, o) => a + o.refundedAmount, 0)).toBe(refund.amount);
    await rejectRefund(refund.id, fin.id, "Customer asked for credit instead");
    const after = await meals();
    expect(after.reduce((a, o) => a + o.refundedAmount, 0)).toBe(0);
    expect(after.every((o) => o.paymentStatus === "PAID")).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: sub.payment.id } })).refundedAmount).toBe(0);
    expect(await db.auditLog.count({ where: { action: "refund.reject", entityId: refund.id } })).toBe(1);

    // Processed path: money back → meals REFUNDED, figures unchanged.
    const v = await freshCustomer("proc");
    const sub2 = await createSubscription(v, { planId: plan.id, startDate: serviceDay(9), days: ["SUN", "TUE"], addressId: v.addresses[0].id, method: "ESEWA" });
    await markPaymentPaid(sub2.payment.id, { amount: sub2.payment.amount });
    await cancelSubscription(sub2.subscription.id, { id: ops.id, isStaff: true }, { reason: "moving", settlement: "REFUND" });
    const [r2] = await db.refund.findMany({ where: { paymentId: sub2.payment.id } });
    const payer = await staff("FINANCE", "payer");
    if (r2.amount >= 200000) await db.refund.update({ where: { id: r2.id }, data: { status: "APPROVED", approvedById: fin.id } });
    else await approveRefund(r2.id, fin.id);
    await processRefund(r2.id, payer.id, { providerRef: `ESEWA-REF-${T}` });
    const done = await db.order.findMany({ where: { subscriptionId: sub2.subscription.id, status: "CANCELLED" } });
    expect(done.reduce((a, o) => a + o.refundedAmount, 0)).toBe(r2.amount);
    expect(done.every((o) => o.paymentStatus === "REFUNDED" || o.paymentStatus === "PARTIALLY_REFUNDED")).toBe(true);
  });
});

describe("invoice page company scope", () => {
  it("ageing and not-yet-invoiced honour a staff member's company scope", async () => {
    const a = await db.company.create({ data: { name: `Gap A ${T}`, slug: `gap-a-${T}` } });
    const b = await db.company.create({ data: { name: `Gap B ${T}`, slug: `gap-b-${T}` } });
    const today = todayKTM();
    for (const c of [a, b])
      await db.invoice.create({ data: { number: `INV-GAP-${c.slug}`, companyId: c.id, status: "ISSUED", periodStart: dateOnly(addDays(today, -10)), periodEnd: dateOnly(addDays(today, -1)), billingName: c.name, subtotal: 10_000, total: 10_000 } });
    const scoped = await ageing([a.id]);
    expect(scoped.rows.map((r) => r.company)).toEqual([a.name]);
    expect(scoped.buckets.total).toBe(10_000);
    expect((await ageing([])).rows).toEqual([]);
    expect((await ageing()).rows.some((r) => r.company === b.name)).toBe(true);
    expect(await uninvoicedByCompany([])).toEqual([]);
    expect((await uninvoicedByCompany([a.id])).every((r) => r.companyId === a.id)).toBe(true);
  });
});
