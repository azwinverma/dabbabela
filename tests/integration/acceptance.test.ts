import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * WP-20 security acceptance: IDOR checks through the real server actions.
 *  - customer A can't read/act on customer B's orders, plans, addresses, payments or saved dabbas;
 *  - company admin A can't touch company B's members or order for them;
 *  - kitchen-scoped staff can't act on another kitchen's orders (admin + rider app);
 *  - a replayed idempotency key never hands back another customer's payment.
 * The session is mocked (same contract as the real gates: permission check, else redirect).
 */
const state = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest-acceptance" }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const current = async () => {
    if (!state.email) return null;
    const { loadUser } = await import("../helpers");
    return loadUser(state.email);
  };
  const redirect = (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  };
  const { can } = await import("@/lib/permissions");
  return {
    ...real,
    getCurrentUser: current,
    requireUser: async () => (await current()) ?? redirect("/login"),
    requirePermission: async (perm: Parameters<typeof real.requirePermission>[0]) => {
      const u = await current();
      if (!u || !can(u, perm)) redirect(`/admin/forbidden ${perm}`);
      return u!;
    },
    requireCompanyAdmin: async () => {
      const user = (await current()) ?? redirect("/login");
      const company = real.activeCompany(user);
      if (!company || user.membership?.role !== "ADMIN") redirect("/account?team=forbidden");
      return { user, company: company! };
    },
  };
});

import { db } from "@/lib/db";
import { dateOnly } from "@/lib/dates";
import { placeCartOrder, OrderError } from "@/server/orders";
import { createSubscription } from "@/server/subscriptions";
import { cancelOrderAction, cancelPlanAction, deleteAddressAction, pausePlanAction, setDefaultAddressAction, skipMealAction } from "@/lib/actions/account";
import { deleteCustomBoxAction, renameCustomBoxAction, startPaymentAction, switchMethodAction } from "@/lib/actions/shop";
import { teamOrderAction, updateMemberAction } from "@/app/team/(portal)/actions";
import { changeStatusAction, cancelAction } from "@/app/admin/orders/actions";
import { packingAction } from "@/app/admin/kitchen/actions";
import { deliverAction, failAction } from "@/app/rider/actions";
import { recognised } from "@/server/analytics/revenue";
import { mealRevenueRows } from "@/server/reports-center/sales";
import { mealsBooked } from "@/server/capacity";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

const A = "customer.a@demo.dabbabela.local";
const B = "customer.b@demo.dabbabela.local";
const D = "customer.d@demo.dabbabela.local"; // member of the demo company
const OTHER_ADMIN = "wp20.other-admin@test.local";
const SCOPED = "wp20.scoped-dispatch@test.local";

const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
  return f;
};
/** Run an action as `email`; a thrown redirect counts as a refusal. */
async function as<T>(email: string, fn: () => Promise<T>): Promise<T | { ok: false; thrown: string }> {
  state.email = email;
  try {
    return await fn();
  } catch (e) {
    return { ok: false, thrown: e instanceof Error ? e.message : String(e) };
  } finally {
    state.email = null;
  }
}
const okOf = (r: unknown) => Boolean(r && typeof r === "object" && "ok" in r && (r as { ok: boolean }).ok);

let bOrderId: string;
let bPaymentId: string;
let bSubId: string;
let bPlanMealId: string;
let bAddressId: string;
let bBoxId: string;
let dMemberId: string;
let otherKitchenId: string;
const day = serviceDay(3);

beforeAll(async () => {
  const b = await loadUser(B);
  bAddressId = b.addresses.find((a) => a.zoneId)!.id;
  const box = await primaryBoxOn(day);
  const placed = await placeCartOrder(b, { lines: [{ kind: "box", id: box.id, date: day, qty: 1 }], addressId: bAddressId, method: "CASH", idempotencyKey: "wp20-b-order" });
  bOrderId = placed.orders[0].id;
  bPaymentId = placed.payment.id;
  const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "hapta" } });
  const sub = await createSubscription(b, { planId: plan.id, startDate: serviceDay(4), days: ["SUN", "MON", "TUE", "WED", "THU", "FRI"], addressId: bAddressId, method: "CASH" });
  bSubId = sub.subscription.id;
  bPlanMealId = (await db.order.findFirstOrThrow({ where: { subscriptionId: bSubId, status: "SCHEDULED" }, orderBy: { deliveryDate: "asc" } })).id;
  bBoxId = (await db.customBox.create({ data: { userId: b.id, name: "B's dabba", items: [], price: 10000 } })).id;

  // a second company with its own admin
  const other = await db.company.create({ data: { name: "WP20 Other Co", slug: "wp20-other", joinCode: "WP20OT", billingMode: "COMPANY_PAID" } });
  const admin = await db.user.create({ data: { name: "Other Admin", email: OTHER_ADMIN, emailVerified: true, role: "CUSTOMER" } });
  await db.companyMember.create({ data: { companyId: other.id, userId: admin.id, role: "ADMIN", status: "ACTIVE" } });
  const d = await db.user.findUniqueOrThrow({ where: { email: D }, include: { membership: true } });
  dMemberId = d.membership!.id;

  // a dispatcher scoped to a second kitchen only
  otherKitchenId = (await db.kitchen.create({ data: { name: "WP20 Patan kitchen", code: "WP20-K2" } })).id;
  await db.user.create({ data: { name: "Scoped Dispatcher", email: SCOPED, emailVerified: true, role: "DISPATCHER", kitchenId: otherKitchenId } });
});

afterAll(async () => {
  await db.customBox.deleteMany({ where: { id: bBoxId } });
});

describe("customer A vs customer B", () => {
  it("can't cancel B's order or switch/start B's payment", async () => {
    expect(okOf(await as(A, () => cancelOrderAction({ ok: false }, fd({ orderId: bOrderId }))))).toBe(false);
    expect((await db.order.findUniqueOrThrow({ where: { id: bOrderId } })).status).not.toBe("CANCELLED");
    expect(okOf(await as(A, () => switchMethodAction(bPaymentId, "BANK_TRANSFER")))).toBe(false);
    expect((await db.payment.findUniqueOrThrow({ where: { id: bPaymentId } })).method).toBe("CASH");
    expect(okOf(await as(A, () => startPaymentAction(bPaymentId)))).toBe(false);
  });

  it("can't skip, pause or cancel B's plan", async () => {
    expect(okOf(await as(A, () => skipMealAction({ ok: false }, fd({ orderId: bPlanMealId }))))).toBe(false);
    expect(okOf(await as(A, () => pausePlanAction({ ok: false }, fd({ id: bSubId }))))).toBe(false);
    expect(okOf(await as(A, () => cancelPlanAction({ ok: false }, fd({ id: bSubId, reason: "not mine" }))))).toBe(false);
    expect((await db.order.findUniqueOrThrow({ where: { id: bPlanMealId } })).status).toBe("SCHEDULED");
    expect((await db.subscription.findUniqueOrThrow({ where: { id: bSubId } })).status).not.toMatch(/PAUSED|CANCELLED/);
  });

  it("can't remove or re-default B's address, or rename/delete B's saved dabba", async () => {
    expect(okOf(await as(A, () => deleteAddressAction({ ok: false }, fd({ id: bAddressId }))))).toBe(false);
    expect(okOf(await as(A, () => setDefaultAddressAction({ ok: false }, fd({ id: bAddressId }))))).toBe(false);
    expect((await db.address.findUniqueOrThrow({ where: { id: bAddressId } })).archivedAt).toBeNull();
    await as(A, () => renameCustomBoxAction({ ok: false }, fd({ id: bBoxId, name: "Stolen" })));
    await as(A, () => deleteCustomBoxAction(bBoxId));
    expect((await db.customBox.findUniqueOrThrow({ where: { id: bBoxId } })).name).toBe("B's dabba");
  });

  it("a replayed idempotency key never returns B's payment", async () => {
    const a = await loadUser(A);
    const box = await primaryBoxOn(day);
    await expect(placeCartOrder(a, { lines: [{ kind: "box", id: box.id, date: day, qty: 1 }], addressId: a.addresses.find((x) => x.zoneId)!.id, method: "CASH", idempotencyKey: "wp20-b-order" })).rejects.toBeInstanceOf(OrderError);
  });
});

describe("company admin of another company", () => {
  it("can't change the demo company's members or order lunch for them", async () => {
    expect(okOf(await as(OTHER_ADMIN, () => updateMemberAction({ ok: false }, fd({ memberId: dMemberId, status: "REMOVED" }))))).toBe(false);
    expect((await db.companyMember.findUniqueOrThrow({ where: { id: dMemberId } })).status).toBe("ACTIVE");
    const box = await primaryBoxOn(day);
    const before = await db.order.count({ where: { user: { email: D } } });
    const r = await as(OTHER_ADMIN, () => teamOrderAction({ ok: false }, fd({ date: day, boxId: box.id, memberId: dMemberId })));
    expect(okOf(r)).toBe(false);
    expect(await db.order.count({ where: { user: { email: D } } })).toBe(before);
  });

  it("a plain customer can't use the team portal at all", async () => {
    const r = await as(B, () => updateMemberAction({ ok: false }, fd({ memberId: dMemberId, status: "REMOVED" })));
    expect(r).toMatchObject({ ok: false, thrown: expect.stringContaining("forbidden") });
  });
});

describe("kitchen-scoped staff", () => {
  it("can't change, cancel or pack an order in another kitchen", async () => {
    const order = await db.order.findUniqueOrThrow({ where: { id: bOrderId } });
    expect(order.kitchenId).not.toBe(otherKitchenId);
    // dispatchers hold orders.edit? Either way: refused (no permission → redirect, permission → out of scope)
    expect(okOf(await as(SCOPED, () => changeStatusAction(bOrderId, { ok: false }, fd({ status: "CONFIRMED" }))))).toBe(false);
    expect(okOf(await as(SCOPED, () => cancelAction(bOrderId, { ok: false }, fd({ reason: "scope test", settlement: "NONE" }))))).toBe(false);
    expect(okOf(await as(SCOPED, () => packingAction(bOrderId, { ok: false }, fd({ itemsOk: "on", labelOk: "on", allergenOk: "on", sealedOk: "on" }))))).toBe(false);
    expect((await db.order.findUniqueOrThrow({ where: { id: bOrderId } })).status).toBe(order.status);
  });

  it("can't deliver or fail another kitchen's stop through the rider app (no OTP bypass)", async () => {
    await db.order.update({ where: { id: bOrderId }, data: { status: "OUT_FOR_DELIVERY" } });
    try {
      const r = await as(SCOPED, () => deliverAction(bOrderId, { ok: false }, fd({ cash: "200" })));
      expect(okOf(r)).toBe(false);
      expect(JSON.stringify(r)).toMatch(/scope/i);
      expect(okOf(await as(SCOPED, () => failAction(bOrderId, { ok: false }, fd({ reason: "Customer not reachable" }))))).toBe(false);
      expect((await db.order.findUniqueOrThrow({ where: { id: bOrderId } })).status).toBe("OUT_FOR_DELIVERY");
      expect(await db.deliveryEvent.count({ where: { orderId: bOrderId, type: { in: ["DELIVERED", "FAILED"] } } })).toBe(0);
    } finally {
      await db.order.update({ where: { id: bOrderId }, data: { status: "SCHEDULED" } });
    }
  });

  it("an unscoped dispatcher still can (the fix doesn't block legitimate staff)", async () => {
    const delivDay = (await db.order.findUniqueOrThrow({ where: { id: bOrderId } })).deliveryDate;
    expect(delivDay).toEqual(dateOnly(day));
    await db.order.update({ where: { id: bOrderId }, data: { status: "OUT_FOR_DELIVERY" } });
    const r = await as("dispatch@demo.dabbabela.local", () => failAction(bOrderId, { ok: false }, fd({ reason: "Customer not reachable" })));
    expect(r).toMatchObject({ ok: true });
    expect((await db.order.findUniqueOrThrow({ where: { id: bOrderId } })).status).toBe("FAILED_DELIVERY");
  });
});

describe("metric-to-record reconciliation (single day)", () => {
  // Raw SQL compares DATE columns with Date parameters; these must hold whatever the database session time zone is
  // (the local Postgres runs in Asia/Kathmandu, Neon in UTC) — single-day ranges used to come back empty off UTC.
  it("recognised revenue = Σ delivered orders' (total − VAT − refunded) = Σ revenue-by-meal rows", async () => {
    const d = serviceDay(5);
    const a = await loadUser(A);
    const box = await primaryBoxOn(d);
    const placed = await placeCartOrder(a, { lines: [{ kind: "box", id: box.id, date: d, qty: 2 }], addressId: a.addresses.find((x) => x.zoneId)!.id, method: "CASH", idempotencyKey: "wp20-recon" });
    const id = placed.orders[0].id;
    expect(await mealsBooked(placed.orders[0].kitchenId, d)).toBeGreaterThanOrEqual(2);
    await db.order.update({ where: { id }, data: { status: "DELIVERED" } });
    try {
      const f = { from: d, to: d, kitchenIds: null };
      const delivered = await db.order.findMany({ where: { deliveryDate: dateOnly(d), status: "DELIVERED" }, select: { total: true, tax: true, refundedAmount: true } });
      const records = delivered.reduce((s, o) => s + o.total - o.tax - o.refundedAmount, 0);
      const kpi = await recognised(f);
      const rows = await mealRevenueRows(f);
      expect(delivered.length).toBeGreaterThan(0);
      expect(kpi.value).toBe(records);
      expect(rows.find((r) => r.name === placed.orders[0].items?.[0]?.name || r.name === box.name)?.qty).toBeGreaterThanOrEqual(2);
      expect(Math.abs(rows.reduce((s, r) => s + r.revenue, 0) - kpi.value)).toBeLessThanOrEqual(rows.length); // per-row rounding only
    } finally {
      await db.order.update({ where: { id }, data: { status: "SCHEDULED" } });
    }
  });
});
