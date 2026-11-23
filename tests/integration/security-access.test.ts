import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { todayKTM } from "@/lib/dates";
import { rateLimit } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { kitchenScope } from "@/lib/user-context";
import { placeCartOrder, setOrderStatus } from "@/server/orders";
import { assignOrders, createRoute, deliverStop, startRoute, type DispatchActor } from "@/server/dispatch";
import { applySupplierCredit, creditUncreditedReturns, voidSupplierCredit } from "@/server/finance/supplier-credits";
import { createSupplierInvoice } from "@/server/finance/payables";
import { createPurchaseOrder, receivePurchase, returnToSupplier, setPurchaseStatus } from "@/server/inventory";
import { esewaConfig } from "@/server/payments/esewa";
import { esewaConfigured, khaltiConfigured } from "@/server/payments/methods";
import { apiOrigin } from "@/server/api/dto";
import { bearerFor, call } from "../api-helpers";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

/**
 * Regression tests for the access / hardening findings of the 2026-11 security review (M3, M4, L1, L2, L4, L5, L7,
 * L8, 2FA + sign-up limits). Symbols added by the fix are imported lazily so each test fails on its own assertion
 * against the pre-fix code.
 */

const B = "customer.b@demo.dabbabela.local";
const C = "customer.c@demo.dabbabela.local";
const stamp = Date.now();
let seq = 0;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ───────────── M3 ─────────────

describe("M3 hand-off code brute force", () => {
  let kitchenId: string;
  let dispatcher: DispatchActor;
  beforeAll(async () => {
    kitchenId = (await loadUser(B)).addresses[0].zone!.kitchenId;
    dispatcher = await loadUser("dispatch@demo.dabbabela.local");
  });

  it("locks the stop after 5 wrong codes (parallel tries included) until dispatch unlocks it", async () => {
    const date = serviceDay(16, 0);
    const rider = await db.user.create({ data: { name: "OTP Rider", email: `sec-otp-rider-${stamp}@test.local`, role: "DELIVERY_AGENT", kitchenId } });
    const user = await loadUser(B);
    const res = await placeCartOrder(user, { lines: [{ kind: "box", id: (await primaryBoxOn(date)).id, date, qty: 1 }], addressId: user.addresses[0].id, method: "CASH" });
    const o = res.orders[0];
    await setOrderStatus([o.id], "PREPARING", null);
    await setOrderStatus([o.id], "PACKED", null);
    const route = await createRoute({ kitchenId, date, name: `sec-otp-${stamp}`, riderId: rider.id });
    await assignOrders(route.id, [o.id]);
    await startRoute(route.id, dispatcher.id);
    const fresh = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    const wrong = fresh.deliveryOtp === "0000" ? "1111" : "0000";
    const asRider = { id: rider.id, isStaff: false };
    const tries = await Promise.allSettled(Array.from({ length: 8 }, () => deliverStop(o.id, asRider, { otp: wrong, cashCollected: o.customerShare })));
    expect(tries.every((t) => t.status === "rejected")).toBe(true);
    expect(await db.deliveryEvent.count({ where: { orderId: o.id, otpOk: false } })).toBe(5); // counting stops at the lock
    // Even the right code is refused now.
    await expect(deliverStop(o.id, asRider, { otp: fresh.deliveryOtp!, cashCollected: o.customerShare })).rejects.toThrow(/locked/);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("OUT_FOR_DELIVERY");
    expect(await db.auditLog.count({ where: { action: "delivery.otp_locked", entityId: o.id } })).toBe(1);
    const { unlockHandoffCode } = await import("@/server/dispatch");
    await unlockHandoffCode(o.id, dispatcher, "Called the customer — they confirmed");
    expect(await db.auditLog.count({ where: { action: "delivery.otp_unlock", entityId: o.id } })).toBe(1);
    await deliverStop(o.id, asRider, { otp: fresh.deliveryOtp!, cashCollected: o.customerShare });
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("DELIVERED");
  });
});

// ───────────── M4 ─────────────

describe("M4 kitchen scope fails closed", () => {
  it("kitchen-bound staff with no kitchen get no kitchens; business-wide roles keep all", async () => {
    expect(kitchenScope({ kitchenId: null, scopes: [], role: "KITCHEN_STAFF" })).toEqual([]);
    expect(kitchenScope({ kitchenId: null, scopes: [], role: "DISPATCHER" })).toEqual([]);
    expect(kitchenScope({ kitchenId: null, scopes: [], role: "DELIVERY_AGENT" })).toEqual([]);
    expect(kitchenScope({ kitchenId: null, scopes: [], role: "SUPPORT", staffRole: { permissions: ["dispatch.edit"] } })).toEqual([]);
    expect(kitchenScope({ kitchenId: null, scopes: [], role: "OWNER" })).toBeNull();
    expect(kitchenScope({ kitchenId: null, scopes: [], role: "FINANCE" })).toBeNull();
    expect(kitchenScope({ kitchenId: null, scopes: [], role: "SUPPORT" })).toBeNull();
    expect(kitchenScope({ kitchenId: "k1", scopes: [{ kitchenId: "k2" }], role: "KITCHEN_STAFF" })).toEqual(["k1", "k2"]);
    // end to end: a chef created without a kitchen sees no kitchen at all
    const chef = await db.user.create({ data: { name: "Unassigned Chef", email: `sec-chef-${stamp}@test.local`, role: "KITCHEN_STAFF" } });
    const u = await loadUser(chef.email);
    expect(u.kitchenIds).toEqual([]);
    const { kitchensFor } = await import("@/components/admin/ops/scope");
    expect(await kitchensFor(u)).toHaveLength(0);
  });

  it("the demo kitchen staff are seeded with a kitchen (E2E keeps working)", async () => {
    for (const email of ["chef@demo.dabbabela.local", "dispatch@demo.dabbabela.local", "rider@demo.dabbabela.local", "stores@demo.dabbabela.local"]) {
      const u = await loadUser(email);
      expect(u.kitchenIds?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

// ───────────── L1 ─────────────

describe("L1 supplier credit void can't be credited again", () => {
  it("void + 'credit uncredited returns' refuses to credit the same goods twice", async () => {
    const owner = await loadUser("owner@test.local");
    const kitchenId = (await db.kitchen.findFirstOrThrow({ where: { code: "KTM-1" } })).id;
    const sup = await db.supplier.create({ data: { name: `Sec Supplier ${stamp}` } });
    const ing = await db.ingredient.create({ data: { name: `Sec Rice ${stamp}`, unit: "KG", costPerUnit: 10000, allergenCodes: [] } });
    const po = await createPurchaseOrder({ supplierId: sup.id, kitchenId, lines: [{ ingredientId: ing.id, quantity: 10, unitCost: 10000 }], actorId: owner.id });
    await setPurchaseStatus(po.id, "SENT");
    const line = await db.purchaseOrderLine.findFirstOrThrow({ where: { poId: po.id } });
    await receivePurchase(po.id, owner.id, [{ lineId: line.id, quantity: 10 }]);
    const { supplierCredit } = await returnToSupplier(owner, { poId: po.id, reason: "Damp", lines: [{ lineId: line.id, quantity: 10 }], credit: { key: `sec${stamp}` } });
    const inv = await createSupplierInvoice(owner, { supplierId: sup.id, poId: null, number: `SEC-INV-${stamp}`, date: todayKTM(), dueDate: todayKTM(), subtotal: 60000, tax: 0 });
    await applySupplierCredit(owner, { creditId: supplierCredit!.id, invoiceId: inv.id, amount: 60000 });
    await voidSupplierCredit(owner, supplierCredit!.id, "Supplier disputes the rest");
    await expect(creditUncreditedReturns(owner, { poId: po.id })).rejects.toThrow(/already has a supplier credit/);
    expect(await db.supplierCredit.count({ where: { poId: po.id } })).toBe(1);
  });
});

// ───────────── L2: client IP + fail-closed limiter ─────────────

describe("L2 rate limiting", () => {
  it("uses the platform IP / right-most proxy hop, never the spoofable left-most X-Forwarded-For value", async () => {
    const { clientIpFrom } = await import("@/lib/rate-limit");
    const h = (o: Record<string, string>) => new Headers(o);
    expect(clientIpFrom(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
    vi.stubEnv("VERCEL", "1");
    expect(clientIpFrom(h({ "x-forwarded-for": "1.2.3.4", "x-vercel-forwarded-for": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIpFrom(h({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
  });

  it("auth / money buckets fail closed when the limiter's database call fails; browsing fails open", async () => {
    vi.spyOn(db, "$queryRaw").mockRejectedValue(new Error("db down"));
    expect(await rateLimit("sec-test", "x", 5, 60_000)).toBe(true);
    expect(await rateLimit("sec-test", "x", 5, 60_000, { failClosed: true } as never)).toBe(false);
  });

  it("2FA verify is limited per challenge (pending user), not only per IP", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT", "true");
    const { POST } = await import("@/app/api/v1/auth/two-factor/verify/route");
    const challengeToken = Buffer.from(`better-auth.two_factor=sec-challenge-${stamp}.signature`).toString("base64url");
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await call(POST, "POST", "/auth/two-factor/verify", { body: { challengeToken, code: "123456" }, ip: `203.0.113.${100 + i}` })).status);
    expect(statuses.slice(0, 8).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(8)).toEqual([429, 429]);
  });

  it("mobile sign-up has stricter per-email limits (no Turnstile in the app)", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT", "true");
    const { POST } = await import("@/app/api/v1/auth/sign-up/route");
    const email = `sec-signup-${stamp}@test.local`;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await call(POST, "POST", "/auth/sign-up", { body: { name: "Sec Signup", email, password: "long-enough-pass-1", phone: `98${String(stamp).slice(-8)}` }, ip: `198.51.100.${150 + i}` })).status);
    expect(statuses[3]).toBe(429);
  });
});

// ───────────── L4 ─────────────

describe("L4 Turnstile action", () => {
  it("a token without the expected action is refused", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site");
    const ok = (body: object) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    expect((await verifyTurnstile("tok", null, { expectedAction: "register", fetchImpl: ok({ success: true }) })).ok).toBe(false);
    expect((await verifyTurnstile("tok", null, { expectedAction: "register", fetchImpl: ok({ success: true, action: "login" }) })).ok).toBe(false);
    expect((await verifyTurnstile("tok", null, { expectedAction: "register", fetchImpl: ok({ success: true, action: "register" }) })).ok).toBe(true);
  });
});

// ───────────── L5 ─────────────

describe("L5 gateways never default to sandbox in live mode", () => {
  it("live keys without explicit endpoints (or with sandbox hosts) switch the gateway off", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENTS_SANDBOX", "");
    vi.stubEnv("ESEWA_PRODUCT_CODE", "LIVECODE");
    vi.stubEnv("ESEWA_SECRET_KEY", "live-secret");
    vi.stubEnv("ESEWA_FORM_URL", "");
    vi.stubEnv("ESEWA_STATUS_URL", "");
    vi.stubEnv("KHALTI_SECRET_KEY", "live-khalti");
    vi.stubEnv("KHALTI_BASE_URL", "https://dev.khalti.com/api/v2");
    expect(esewaConfigured()).toBe(false);
    expect(esewaConfig().formUrl).toBe("");
    expect(khaltiConfigured()).toBe(false);
    vi.stubEnv("ESEWA_FORM_URL", "https://epay.esewa.com.np/api/epay/main/v2/form");
    vi.stubEnv("ESEWA_STATUS_URL", "https://epay.esewa.com.np/api/epay/transaction/status/");
    vi.stubEnv("KHALTI_BASE_URL", "https://khalti.com/api/v2");
    expect(esewaConfigured()).toBe(true);
    expect(khaltiConfigured()).toBe(true);
    vi.stubEnv("PAYMENTS_SANDBOX", "true");
    vi.stubEnv("ESEWA_FORM_URL", "");
    expect(esewaConfig().formUrl).toContain("rc-epay");
  });
});

// ───────────── L7 ─────────────

describe("L7 device token moves are audited and announced", () => {
  it("re-registering another account's push token is audited and the old account is notified", async () => {
    const { POST } = await import("@/app/api/v1/devices/route");
    const [tB, tC] = [await bearerFor(B, "demo-pass-123"), await bearerFor(C, "demo-pass-123")];
    const token = `sec-device-token-${stamp}-${++seq}`;
    expect((await call(POST, "POST", "/devices", { token: tB, body: { token, platform: "ANDROID" } })).status).toBe(200);
    expect((await call(POST, "POST", "/devices", { token: tC, body: { token, platform: "ANDROID" } })).status).toBe(200);
    const userB = await db.user.findUniqueOrThrow({ where: { email: B } });
    const row = await db.deviceToken.findUniqueOrThrow({ where: { token } });
    expect(await db.auditLog.count({ where: { action: "device.moved", entityId: row.id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: userB.id, type: "device.moved" } })).toBeGreaterThanOrEqual(1);
  });
});

// ───────────── L8 ─────────────

describe("L8 gateway return origin", () => {
  it("never trusts X-Forwarded-Host in production; prefers the configured site URL", () => {
    const req = new Request("http://internal:3000/api/v1/payments/x/start", { headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" } });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(apiOrigin(req)).not.toContain("evil.example");
    vi.stubEnv("BETTER_AUTH_URL", "https://dabbabela.example");
    expect(apiOrigin(req)).toBe("https://dabbabela.example");
  });
});
