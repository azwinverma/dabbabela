import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getSettings, saveSettings, type SiteSettings } from "@/lib/settings";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";
import { cancelOrder, placeCartOrder, adjustOrder } from "@/server/orders";
import { cancelSubscription, createSubscription, skipMeal, unskipMeal } from "@/server/subscriptions";
import { approveRefund, handleEsewaReturn, markPaymentPaid, processRefund, requestRefund, requestRefundTx, startPayment, switchPaymentMethod } from "@/server/payments";
import { esewaConfig, esewaSign } from "@/server/payments/esewa";
import { walletBalance } from "@/server/ledger";
import { cancelTopup, startTopup, topupLimits } from "@/server/wallet-topup";
import { issueCredit, issueCreditOrRequest } from "@/server/crm";
import { decisionBlocker } from "@/server/approvals";

// Modules added by the fix are imported lazily, so that against the pre-fix code each test fails on its own
// assertion (the exploit succeeding) rather than the whole file failing to load.
const limits = () => import("@/server/money-limits");

/**
 * Regression tests for the money findings of the 2026-11 security review (docs/SECURITY.md "Security review fixes").
 * Each test is the review's proof of concept turned around: it failed (the exploit worked) before the fix.
 * Concurrency is exercised with Promise.all / allSettled against the real database.
 */

const B = "customer.b@demo.dabbabela.local";
let seq = 0;
let original: SiteSettings;
let ops: Awaited<ReturnType<typeof loadUser>>;

/** A fresh customer with a copy of demo customer B's (zoned) address — own wallet, own orders. */
async function freshCustomer(tag: string) {
  seq++;
  const b = await loadUser(B);
  const a = b.addresses[0];
  const u = await db.user.create({ data: { name: `Sec ${tag} ${seq}`, email: `sec-${tag}-${seq}-${Date.now()}@test.local`, role: "CUSTOMER", phoneNumber: null } });
  await db.address.create({ data: { userId: u.id, label: a.label, type: a.type, recipientName: u.name, phone: a.phone, placeName: a.placeName, line1: a.line1, area: a.area, zoneId: a.zoneId, isDefault: true } });
  return loadUser(u.email);
}

async function staff(role: "FINANCE" | "SUPPORT" | "OPERATIONS_MANAGER" | "KITCHEN_STAFF", tag: string, kitchenId: string | null = null) {
  seq++;
  const u = await db.user.create({ data: { name: `Sec ${role} ${seq}`, email: `sec-${role.toLowerCase()}-${tag}-${seq}-${Date.now()}@test.local`, role, kitchenId } });
  return loadUser(u.email);
}

const key = (t: string) => `sec-${t}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function esewaData(uuid: string, amountPaisa: number) {
  const amount = String(amountPaisa / 100);
  const body = { transaction_code: `T${Date.now()}${seq}`, status: "COMPLETE", total_amount: amount, transaction_uuid: uuid, product_code: esewaConfig().productCode, signed_field_names: "total_amount,transaction_uuid,product_code" };
  const sig = esewaSign(`total_amount=${amount},transaction_uuid=${uuid},product_code=${body.product_code}`);
  return Buffer.from(JSON.stringify({ ...body, signature: sig })).toString("base64");
}

/** Complete a gateway attempt through the real eSewa return handler (status API stubbed to COMPLETE). */
async function payAttempt(paymentId: string, attempt: { providerRef: string; amount: number }) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "COMPLETE" }), { status: 200 })));
  try {
    return await handleEsewaReturn(paymentId, esewaData(attempt.providerRef, attempt.amount));
  } finally {
    vi.unstubAllGlobals();
  }
}

async function cart(u: Awaited<ReturnType<typeof loadUser>>, days: string[], method: "ESEWA" | "CASH" | "WALLET" = "ESEWA") {
  const lines = [];
  for (const d of days) lines.push({ kind: "box" as const, id: (await primaryBoxOn(d)).id, date: d, qty: 1 });
  return placeCartOrder(u, { lines, addressId: u.addresses[0].id, method, idempotencyKey: key("cart") });
}

beforeAll(async () => {
  original = await getSettings();
  await saveSettings({
    bankDetails: original.bankDetails || "Test bank",
    flags: { ...original.flags, wallet: true, walletTopup: true },
    paymentMethods: { ...original.paymentMethods, ESEWA: true, CASH: true, WALLET: true, BANK_TRANSFER: true },
    approvalThreshold: 200000,
    staffDailyMoneyLimit: 500000,
  });
  ops = await loadUser("ops@demo.dabbabela.local");
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await saveSettings({ flags: original.flags, paymentMethods: original.paymentMethods, bankDetails: original.bankDetails, approvalThreshold: original.approvalThreshold, staffDailyMoneyLimit: original.staffDailyMoneyLimit, skipPolicy: original.skipPolicy });
});

// ───────────── C1 ─────────────

describe("C1 plan cancel race", () => {
  it("three parallel cancels credit the plan's value exactly once", async () => {
    const u = await freshCustomer("c1");
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "do-hapta" } });
    const sub = await createSubscription(u, { planId: plan.id, startDate: serviceDay(9), days: ["MON", "WED"], addressId: u.addresses[0].id, method: "ESEWA" });
    await markPaymentPaid(sub.payment.id, { amount: sub.payment.amount });
    const before = await walletBalance(u.id);
    const rs = await Promise.allSettled([1, 2, 3].map(() => cancelSubscription(sub.subscription.id, { id: u.id, isStaff: false }, { userId: u.id, reason: "race" })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const credited = (await walletBalance(u.id)) - before;
    expect(credited).toBeGreaterThan(0);
    expect(credited).toBeLessThanOrEqual(sub.payment.amount);
    const p = await db.payment.findUniqueOrThrow({ where: { id: sub.payment.id } });
    expect(p.refundedAmount).toBe(credited);
    expect(p.refundedAmount).toBeLessThanOrEqual(p.amount);
  });

  it("parallel staff cancels with a REFUND settlement create one refund request, inside the refundable cap", async () => {
    const u = await freshCustomer("c1r");
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "do-hapta" } });
    const sub = await createSubscription(u, { planId: plan.id, startDate: serviceDay(9), days: ["SUN", "TUE"], addressId: u.addresses[0].id, method: "ESEWA" });
    await markPaymentPaid(sub.payment.id, { amount: sub.payment.amount });
    const rs = await Promise.allSettled([1, 2, 3].map(() => cancelSubscription(sub.subscription.id, { id: ops.id, isStaff: true }, { reason: "race", settlement: "REFUND" })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refunds = await db.refund.findMany({ where: { paymentId: sub.payment.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBeLessThanOrEqual(sub.payment.amount);
    expect(refunds[0].method).toBe("ORIGINAL");
  });

  it("processRefund re-checks the cap: duplicate approved refunds can't pay out more than the payment", async () => {
    const u = await freshCustomer("c1p");
    const res = await cart(u, [serviceDay(9, 1)]);
    await markPaymentPaid(res.payment.id, { amount: res.payment.amount });
    const fin = await staff("FINANCE", "c1p");
    // Simulate the legacy race: two full-amount refunds written without requestRefundTx's cap.
    const mk = () => db.refund.create({ data: { paymentId: res.payment.id, amount: res.payment.amount, reason: "dup", method: "WALLET_CREDIT", requestedById: ops.id, status: "APPROVED", approvedById: fin.id } });
    const [r1, r2] = [await mk(), await mk()];
    const out = await Promise.allSettled([processRefund(r1.id, fin.id, {}), processRefund(r2.id, fin.id, {})]);
    expect(out.filter((r) => r.status === "fulfilled")).toHaveLength(0); // both refuse while the approved total exceeds what's left
    await db.refund.update({ where: { id: r2.id }, data: { status: "REJECTED" } });
    await processRefund(r1.id, fin.id, {});
    const p = await db.payment.findUniqueOrThrow({ where: { id: res.payment.id } });
    expect(p.refundedAmount).toBe(p.amount);
    await db.refund.update({ where: { id: r2.id }, data: { status: "APPROVED" } });
    await expect(processRefund(r2.id, fin.id, {})).rejects.toThrow(/left to refund/);
  });
});

// ───────────── H1 ─────────────

describe("H1 partial cancel + stale gateway amount", () => {
  it("credits the cancelled days ONCE and the remaining day stays paid (end-to-end eSewa return)", async () => {
    const u = await freshCustomer("h1");
    const days = [serviceDay(10, 0), serviceDay(10, 1), serviceDay(10, 2)];
    const res = await cart(u, days);
    await startPayment(res.payment.id, u.id, "http://localhost:3100");
    const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { paymentId: res.payment.id } });
    await cancelOrder(res.orders[0].id, { id: u.id, isStaff: false }, { reason: "x", userId: u.id });
    await cancelOrder(res.orders[1].id, { id: u.id, isStaff: false }, { reason: "x", userId: u.id });
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("EXPIRED");
    const before = await walletBalance(u.id);
    const r = await payAttempt(res.payment.id, attempt); // the customer completes the ORIGINAL (stale) form
    expect(r.ok).toBe(true);
    const credited = (await walletBalance(u.id)) - before;
    expect(credited).toBe(res.orders[0].customerShare + res.orders[1].customerShare); // not twice
    const o3 = await db.order.findUniqueOrThrow({ where: { id: res.orders[2].id } });
    expect(o3).toMatchObject({ status: "SCHEDULED", paymentStatus: "PAID" });
    const p = await db.payment.findUniqueOrThrow({ where: { id: res.payment.id } });
    expect(p).toMatchObject({ amount: attempt.amount, refundedAmount: credited, status: "PARTIALLY_REFUNDED" });
  });

  it("paying the reduced amount credits nothing and never marks the cancelled day refunded", async () => {
    const u = await freshCustomer("h1b");
    const res = await cart(u, [serviceDay(10, 3), serviceDay(10, 4)]);
    await cancelOrder(res.orders[0].id, { id: u.id, isStaff: false }, { reason: "x", userId: u.id });
    await startPayment(res.payment.id, u.id, "http://localhost:3100");
    const fresh = await db.paymentAttempt.findFirstOrThrow({ where: { paymentId: res.payment.id, status: "STARTED" } });
    expect(fresh.amount).toBe(res.orders[1].customerShare);
    const before = await walletBalance(u.id);
    expect((await payAttempt(res.payment.id, fresh)).ok).toBe(true);
    expect((await walletBalance(u.id)) - before).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: res.orders[0].id } })).paymentStatus).not.toBe("REFUNDED");
    expect((await db.order.findUniqueOrThrow({ where: { id: res.orders[1].id } })).paymentStatus).toBe("PAID");
  });
});

// ───────────── H2 ─────────────

describe("H2 skip race", () => {
  async function paidPlanMeal(tag: string, offset: number) {
    const u = await freshCustomer(tag);
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "hapta" } });
    const sub = await createSubscription(u, { planId: plan.id, startDate: serviceDay(offset), days: ["SUN", "MON", "TUE", "WED"], addressId: u.addresses[0].id, method: "ESEWA" });
    await markPaymentPaid(sub.payment.id, { amount: sub.payment.amount });
    const meal = await db.order.findFirstOrThrow({ where: { subscriptionId: sub.subscription.id, status: "SCHEDULED" }, orderBy: { deliveryDate: "asc" } });
    return { u, sub, meal };
  }

  it("CREDIT: three parallel skips credit the meal once", async () => {
    await saveSettings({ skipPolicy: "CREDIT" });
    try {
      const { u, meal } = await paidPlanMeal("h2c", 11);
      const before = await walletBalance(u.id);
      const rs = await Promise.allSettled([1, 2, 3].map(() => skipMeal(meal.id, { id: u.id, isStaff: false }, u.id)));
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await walletBalance(u.id)) - before).toBe(meal.customerShare);
    } finally {
      await saveSettings({ skipPolicy: original.skipPolicy });
    }
  });

  it("EXTEND: three parallel skips append one meal; parallel unskips remove one", async () => {
    await saveSettings({ skipPolicy: "EXTEND" });
    try {
      const { u, sub, meal } = await paidPlanMeal("h2e", 12);
      const live = () => db.order.count({ where: { subscriptionId: sub.subscription.id, status: { in: ["SCHEDULED", "PENDING_PAYMENT"] } } });
      const n0 = await live();
      const rs = await Promise.allSettled([1, 2, 3].map(() => skipMeal(meal.id, { id: u.id, isStaff: false }, u.id)));
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await live()).toBe(n0); // one skipped, exactly one appended
      const un = await Promise.allSettled([1, 2, 3].map(() => unskipMeal(meal.id, { id: u.id, isStaff: false }, u.id)));
      expect(un.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await live()).toBe(n0);
    } finally {
      await saveSettings({ skipPolicy: original.skipPolicy });
    }
  });
});

// ───────────── M1 ─────────────

describe("M1 stale attempt for a grown amount", () => {
  it("refuses an underpayment for every purpose: no PAID, alert raised, payment stays pending", async () => {
    const u = await freshCustomer("m1");
    const res = await cart(u, [serviceDay(13, 0)]);
    const r = await markPaymentPaid(res.payment.id, { amount: 1 });
    expect(r).toMatchObject({ mismatch: true, refused: "UNDERPAID" });
    expect((await db.payment.findUniqueOrThrow({ where: { id: res.payment.id } })).status).toBe("PENDING");
    expect((await db.order.findUniqueOrThrow({ where: { id: res.orders[0].id } })).paymentStatus).toBe("PENDING");
    expect(await db.alert.count({ where: { type: "GATEWAY_MISMATCH", entityId: res.payment.id } })).toBe(1);
  });

  it("method switch expires started sessions; the old session can't pay off a grown payment", async () => {
    const u = await freshCustomer("m1b");
    const res = await cart(u, [serviceDay(13, 1)]);
    await startPayment(res.payment.id, u.id, "http://localhost:3100");
    const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { paymentId: res.payment.id } });
    await switchPaymentMethod(res.payment.id, u.id, "CASH");
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("EXPIRED");
    await db.payment.update({ where: { id: res.payment.id }, data: { amount: { increment: 50000 } } }); // what a DUE_LATER swap does
    const r = await payAttempt(res.payment.id, attempt);
    expect(r.ok).toBe(false);
    const p = await db.payment.findUniqueOrThrow({ where: { id: res.payment.id } });
    expect(p.status).toBe("PENDING");
    expect((await db.order.findUniqueOrThrow({ where: { id: res.orders[0].id } })).paymentStatus).toBe("UNPAID");
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("MISMATCH");
  });
});

// ───────────── L6 ─────────────

describe("L6 wallet switch race", () => {
  it("two parallel switches to WALLET debit once", async () => {
    const u = await freshCustomer("l6");
    const res = await cart(u, [serviceDay(13, 2)]);
    await db.creditLedger.create({ data: { userId: u.id, amount: res.payment.amount * 3, reason: "GOODWILL", note: "test" } });
    const before = await walletBalance(u.id);
    await Promise.allSettled([1, 2].map(() => switchPaymentMethod(res.payment.id, u.id, "WALLET")));
    expect(before - (await walletBalance(u.id))).toBe(res.payment.amount);
    expect((await db.payment.findUniqueOrThrow({ where: { id: res.payment.id } })).status).toBe("PAID");
  });
});

// ───────────── M2 ─────────────

describe("M2 top-up limits", () => {
  it("a cancelled top-up is never credited (refused + alert); cancel/restart can't exceed the limits", async () => {
    const u = await freshCustomer("m2");
    const s = await getSettings();
    const ids: { id: string; attempt: { providerRef: string; amount: number } }[] = [];
    for (let i = 0; i < 4; i++) {
      const t = await startTopup(u, { amount: s.walletTopupMax, method: "ESEWA", idempotencyKey: key(`m2-${i}`) });
      await startPayment(t.payment.id, u.id, "http://localhost:3100");
      const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { paymentId: t.payment.id } });
      await cancelTopup(u.id, t.payment.id);
      expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("EXPIRED");
      ids.push({ id: t.payment.id, attempt });
    }
    for (const t of ids) await payAttempt(t.id, t.attempt);
    expect(await walletBalance(u.id)).toBe(0);
    for (const t of ids) expect((await db.payment.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("CANCELLED");
    expect(await db.alert.count({ where: { type: "GATEWAY_MISMATCH", entityId: { in: ids.map((t) => t.id) } } })).toBe(ids.length);
  });

  it("a pending top-up from a previous day still counts toward the balance cap", async () => {
    const u = await freshCustomer("m2b");
    const s = await getSettings();
    const t = await startTopup(u, { amount: s.walletTopupMax, method: "ESEWA", idempotencyKey: key("m2b") });
    await db.payment.update({ where: { id: t.payment.id }, data: { createdAt: new Date(Date.now() - 2 * 24 * 3600_000) } });
    const l = await topupLimits(u.id);
    expect(l.pendingToday).toBe(s.walletTopupMax);
    expect(l.maxNow).toBeLessThanOrEqual(s.walletBalanceCap - s.walletTopupMax);
  });
});

// ───────────── H3 ─────────────

describe("H3 order adjustments can't mint credit", () => {
  it("negative adjustments are capped at the order's remaining customer share", async () => {
    const u = await freshCustomer("h3");
    const res = await cart(u, [serviceDay(14, 0)]);
    await markPaymentPaid(res.payment.id, { amount: res.payment.amount });
    const share = res.orders[0].customerShare;
    const half = Math.floor(share / 2);
    await adjustOrder(res.orders[0].id, ops.id, -half, "cold food");
    const { adjustableCredit } = await import("@/server/orders");
    expect(await adjustableCredit(res.orders[0].id)).toBe(share - half);
    await expect(adjustOrder(res.orders[0].id, ops.id, -(share - half + 1), "again")).rejects.toThrow(/At most/);
    // parallel attempts can't overshoot either
    await Promise.allSettled([1, 2, 3].map(() => adjustOrder(res.orders[0].id, ops.id, -(share - half), "race")));
    const credit = await db.creditLedger.aggregate({ where: { orderId: res.orders[0].id, reason: "ADJUSTMENT" }, _sum: { amount: true } });
    expect(credit._sum.amount).toBe(share);
    await expect(adjustOrder(res.orders[0].id, ops.id, -1, "more")).rejects.toThrow(/Nothing more/);
  });
});

// ───────────── H4 ─────────────

describe("H4 threshold splitting, daily limit, segregation of duties", () => {
  it("refunds on one payment are summed toward the threshold (no splitting)", async () => {
    const { NeedsApprovalError } = await limits();
    await saveSettings({ approvalThreshold: 20000 }); // Rs 200
    try {
      const u = await freshCustomer("h4a");
      const res = await cart(u, [serviceDay(14, 1), serviceDay(14, 2)]);
      await markPaymentPaid(res.payment.id, { amount: res.payment.amount });
      const fin = await staff("FINANCE", "h4a");
      await requestRefund({ paymentId: res.payment.id, amount: 15000, reason: "part 1", method: "BANK", actorId: fin.id });
      await expect(requestRefund({ paymentId: res.payment.id, amount: 5000, reason: "part 2", method: "BANK", actorId: fin.id })).rejects.toBeInstanceOf(NeedsApprovalError);
    } finally {
      await saveSettings({ approvalThreshold: 200000 });
    }
  });

  it("a person's rolling-24h refunds + credits are capped (parallel requests included)", async () => {
    const { NeedsApprovalError, staffMoneyUsed24h } = await limits();
    await saveSettings({ staffDailyMoneyLimit: 40000 }); // Rs 400
    try {
      const fin = await staff("FINANCE", "h4b");
      const u = await freshCustomer("h4b");
      const res = await cart(u, [serviceDay(14, 3), serviceDay(14, 4)]);
      await markPaymentPaid(res.payment.id, { amount: res.payment.amount });
      const out = await Promise.allSettled([1, 2, 3, 4].map((i) => requestRefund({ paymentId: res.payment.id, amount: 10000, reason: `p${i}`, method: "WALLET_CREDIT", actorId: fin.id })));
      expect(out.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      expect(out.filter((r) => r.status === "rejected" && r.reason instanceof NeedsApprovalError)).toHaveLength(1);
      expect(await staffMoneyUsed24h(fin.id)).toBe(30000);
      // manual credits count toward the same limit
      await expect(issueCredit(fin, u.id, 10000, "goodwill please")).rejects.toBeInstanceOf(NeedsApprovalError);
      const r = await issueCreditOrRequest(fin, u.id, 10000, "goodwill please");
      expect(r.issued).toBe(false);
    } finally {
      await saveSettings({ staffDailyMoneyLimit: 500000 });
    }
  });

  it("a CASH/BANK refund is paid out by someone other than its requester, and self-approval follows the summed rule", async () => {
    const u = await freshCustomer("h4c");
    const res = await cart(u, [serviceDay(15, 0)]);
    await markPaymentPaid(res.payment.id, { amount: res.payment.amount });
    const fin = await staff("FINANCE", "h4c");
    const fin2 = await staff("FINANCE", "h4c2");
    const r = await requestRefund({ paymentId: res.payment.id, amount: 5000, reason: "cash back", method: "CASH", actorId: fin.id });
    await approveRefund(r.id, fin.id);
    await expect(processRefund(r.id, fin.id, { providerRef: "made-up" })).rejects.toThrow(/Someone else/);
    await processRefund(r.id, fin2.id, { providerRef: "RCPT-1" });
  });

  it("an order paid with wallet credit can only be refunded as credit (closed loop)", async () => {
    const u = await freshCustomer("h4d");
    const d = serviceDay(15, 1);
    const box = await primaryBoxOn(d);
    await db.creditLedger.create({ data: { userId: u.id, amount: 500000, reason: "GOODWILL", note: "test" } });
    const res = await placeCartOrder(u, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: u.addresses[0].id, method: "WALLET", idempotencyKey: key("h4d") });
    const fin = await staff("FINANCE", "h4d");
    await expect(requestRefund({ paymentId: res.payment.id, amount: 1000, reason: "cash out", method: "BANK", actorId: fin.id })).rejects.toThrow(/only be refunded as credit/);
    await expect(db.$transaction((tx) => requestRefundTx(tx, { paymentId: res.payment.id, amount: 1000, reason: "x", method: "ORIGINAL", actorId: fin.id }))).rejects.toThrow(/only be refunded as credit/);
    await requestRefund({ paymentId: res.payment.id, amount: 1000, reason: "credit back", method: "WALLET_CREDIT", actorId: fin.id });
  });

  it("manual credit goes to customers only, inside the actor's kitchen scope; no-kitchen requests need an all-kitchen approver", async () => {
    const { assertCreditTarget } = await limits();
    const fin = await staff("FINANCE", "h4e");
    await expect(assertCreditTarget(fin, fin.id)).rejects.toThrow(/customer accounts/);
    const u = await freshCustomer("h4e");
    await expect(assertCreditTarget({ kitchenIds: ["some-other-kitchen"] }, u.id)).rejects.toThrow(/no orders in your kitchens/);
    await expect(assertCreditTarget(fin, u.id)).resolves.toBeUndefined();
    const scoped = { id: "approver", role: "FINANCE", kitchenIds: ["k1"] };
    expect(decisionBlocker(scoped, { kind: "WALLET_ADJUSTMENT", requestedById: "someone", kitchenId: null })).toMatch(/outside your scope/);
    expect(decisionBlocker({ ...scoped, kitchenIds: null }, { kind: "WALLET_ADJUSTMENT", requestedById: "someone", kitchenId: null })).toBeNull();
  });
});
