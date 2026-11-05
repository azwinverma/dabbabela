import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Lets a test pretend "now" is a given Kathmandu date/time (per-day cut-off checks). null = real clock.
const clock = vi.hoisted(() => ({ now: null as null | { date: string; time: string } }));
vi.mock("@/lib/dates", async (orig) => {
  const real = await orig<typeof import("@/lib/dates")>();
  return { ...real, ktmNow: () => clock.now ?? real.ktmNow() };
});

import { db } from "@/lib/db";
import { dateOnly, isoDate, weekdayOf, weekStartOf } from "@/lib/dates";
import { defaultKitchenId, placeCartOrder, quoteCart } from "@/server/orders";
import { getClosures, getLockedDates } from "@/server/calendar";
import {
  createCorporateBulkOrder,
  createManualOrder,
  editOrderLines,
  exportOrdersCsv,
  OrderAdminError,
  OrderForbidden,
  reassignDelivery,
  reassignKitchen,
  substituteOrderItem,
  VersionConflict,
} from "@/server/orders-admin";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

const B = "customer.b@demo.dabbabela.local";
const C = "customer.c@demo.dabbabela.local";
let owner: Awaited<ReturnType<typeof loadUser>>;
let chef: Awaited<ReturnType<typeof loadUser>>;
let finance: Awaited<ReturnType<typeof loadUser>>;
let support: Awaited<ReturnType<typeof loadUser>>;
const tag = Date.now().toString(36);
const key = (s: string) => `wp03-${s}-${tag}`;

// Own corporate fixture (no other test touches it).
const fx = {} as { company: string; k2: string; zone: string; m1: string; m2: string; m3: string; u1: string; u2: string };

// Service days no other test has locked or closed (commerce/ops lock some days and leave them locked).
let cursor = 0;
const used = new Set<string>();
async function nextDay() {
  const kitchenId = (await defaultKitchenId())!;
  for (;;) {
    const d = serviceDay(5, cursor++);
    if (used.has(d)) continue;
    const [closed, locked] = await Promise.all([getClosures(d, d, kitchenId), getLockedDates(d, d, kitchenId)]);
    if (closed.size || locked.size) continue;
    used.add(d);
    return d;
  }
}
let manualDay = "";
let bulkDay = "";

async function freshOrder(email: string, date: string, qty = 1, method: "CASH" | "WALLET" = "CASH") {
  const user = await loadUser(email);
  const box = await primaryBoxOn(date);
  const r = await placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date, qty }], addressId: user.addresses[0].id, method });
  return { order: r.orders[0], box, user };
}

beforeAll(async () => {
  [owner, chef, finance, support] = await Promise.all([loadUser("owner@test.local"), loadUser("chef@demo.dabbabela.local"), loadUser("finance@demo.dabbabela.local"), loadUser("support@demo.dabbabela.local")]);
  const zone = await db.deliveryZone.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  fx.zone = zone.id;
  const company = await db.company.create({
    data: { name: `WP03 Co ${tag}`, slug: `wp03-${tag}`, billingMode: "SPLIT", subsidyPct: 50, freeDelivery: true, requireApproval: false, zoneId: zone.id },
  });
  fx.company = company.id;
  const loc = await db.officeLocation.create({ data: { companyId: company.id, name: "WP03 HQ", line1: "WP03 tower", area: "New Baneshwor", zoneId: zone.id } });
  const mk = async (n: number, extra: Record<string, unknown> = {}) => {
    const u = await db.user.create({ data: { name: `WP03 Employee ${n}`, email: `wp03-${n}-${tag}@test.local` } });
    const m = await db.companyMember.create({ data: { companyId: company.id, userId: u.id, status: "ACTIVE", officeLocationId: loc.id, ...extra } });
    return { u, m };
  };
  const e1 = await mk(1);
  const e2 = await mk(2);
  bulkDay = await nextDay();
  const otherDay = (["SUN", "MON", "TUE", "WED", "THU", "FRI"] as const).find((w) => w !== weekdayOf(bulkDay))!;
  const e3 = await mk(3, { eligibleDays: [otherDay] });
  Object.assign(fx, { m1: e1.m.id, m2: e2.m.id, m3: e3.m.id, u1: e1.u.id, u2: e2.u.id });
  const k2 = await db.kitchen.create({ data: { name: `WP03 Kitchen ${tag}`, code: `W3${tag}`.toUpperCase(), dailyCapacity: 1 } });
  fx.k2 = k2.id;
});

afterAll(() => {
  clock.now = null;
});

describe("manual / phone orders", () => {
  it("prices on the server (equal to the customer quote), snapshots packaging and records staff source", async () => {
    const d = (manualDay = await nextDay());
    const box = await primaryBoxOn(d);
    const original = box.packagingCost;
    await db.lunchBox.update({ where: { id: box.id }, data: { packagingCost: 1500 } });
    try {
      const customer = await loadUser(B);
      const lines = [{ kind: "box" as const, id: box.id, date: d, qty: 2 }];
      const q = await quoteCart(customer, { lines, addressId: customer.addresses[0].id });
      expect(q.ok).toBe(true);
      const r = await createManualOrder(owner, { customerId: customer.id, addressId: customer.addresses[0].id, lines, method: "CASH", idempotencyKey: key("manual-1"), reason: "Phoned in" });
      expect(r.replayed).toBe(false);
      const o = await db.order.findUniqueOrThrow({ where: { id: r.orders[0].id } });
      expect(o.total).toBe(q.total);
      expect(o.customerShare).toBe(q.customerShare);
      expect(o.source).toBe("ADMIN");
      expect(o.placedById).toBe(owner.id);
      expect(o.packagingCost).toBe(1500 * 2);
      expect(await db.auditLog.count({ where: { action: "order.create_manual", entityId: o.id } })).toBe(1);
    } finally {
      await db.lunchBox.update({ where: { id: box.id }, data: { packagingCost: original } });
    }
  });

  it("is idempotent: a retried submit (even for a new customer) creates one customer, one payment, one order", async () => {
    const d = await nextDay();
    const box = await primaryBoxOn(d);
    const phone = `98${String(Date.now()).slice(-8)}`;
    const input = {
      newCustomer: { name: "Walk-in Ram", phone },
      newAddress: { line1: "Durbar Marg 4", area: "Durbar Marg", zoneId: fx.zone },
      lines: [{ kind: "box" as const, id: box.id, date: d, qty: 1 }],
      method: "BANK_TRANSFER" as const,
      idempotencyKey: key("manual-2"),
    };
    const a = await createManualOrder(owner, input);
    const b = await createManualOrder(owner, input);
    expect(b.replayed).toBe(true);
    expect(b.orders.map((o) => o.id)).toEqual(a.orders.map((o) => o.id));
    expect(await db.payment.count({ where: { idempotencyKey: `staff:${key("manual-2")}` } })).toBe(1);
    expect(await db.user.count({ where: { phoneNumber: `+977${phone}` } })).toBe(1);
    expect(a.orders[0].status).toBe("PENDING_PAYMENT"); // bank transfer waits for verification (controlled transitions)
  });

  it("stores the attribution snapshot on the order", async () => {
    const d = await nextDay();
    const user = await loadUser(C);
    const box = await primaryBoxOn(d);
    const r = await placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: user.addresses[0].id, method: "CASH", attribution: { source: "facebook", medium: "cpc", campaignId: "does-not-exist", evil: { x: 1 } } as never });
    const o = await db.order.findUniqueOrThrow({ where: { id: r.orders[0].id } });
    expect(o.attribution).toEqual({ source: "facebook", medium: "cpc" });
    expect(o.campaignId).toBeNull();
  });
});

describe("corporate", () => {
  it("bulk order: one order per eligible employee with the company split; ineligible refused; replay safe", async () => {
    const d = bulkDay;
    const box = await primaryBoxOn(d);
    const input = { companyId: fx.company, date: d, lines: [{ memberId: fx.m1, boxId: box.id }, { memberId: fx.m2, boxId: box.id, qty: 2 }, { memberId: fx.m3, boxId: box.id }], idempotencyKey: key("bulk-1") };
    const r = await createCorporateBulkOrder(owner, input);
    const ok = r.results.filter((x) => x.ok);
    expect(ok.length).toBe(2);
    expect(r.results.find((x) => x.memberId === fx.m3)!.message).toMatch(/Not eligible/);
    const orders = await db.order.findMany({ where: { id: { in: ok.flatMap((x) => x.orderIds) } } });
    expect(orders.length).toBe(2);
    for (const o of orders) {
      expect(o.companyId).toBe(fx.company);
      expect(o.source).toBe("CORPORATE");
      expect(o.placedById).toBe(owner.id);
      expect(o.companyShare + o.customerShare).toBe(o.total);
      expect(Math.abs(o.companyShare - o.customerShare)).toBeLessThanOrEqual(1); // 50% subsidy
    }
    expect(r.totals.companyShare).toBe(orders.reduce((a, o) => a + o.companyShare, 0));
    const again = await createCorporateBulkOrder(owner, input);
    expect(again.results.filter((x) => x.ok).every((x) => x.replayed)).toBe(true);
    expect(await db.order.count({ where: { companyId: fx.company, deliveryDate: dateOnly(d) } })).toBe(2);
  });

  it("applies the active contract's negotiated per-dabba price", async () => {
    const d = await nextDay();
    const box = await primaryBoxOn(d);
    const member = await loadUser(`wp03-1-${tag}@test.local`);
    const before = await quoteCart(member, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: member.addresses[0]?.id });
    expect(before.lines[0].unitPrice).toBe(box.price);
    const c = await db.corporateContract.create({ data: { companyId: fx.company, title: "WP03", startsOn: dateOnly(serviceDay(0)), status: "ACTIVE", boxPrices: { [box.id]: 12345 } } });
    const after = await quoteCart(member, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: member.addresses[0]?.id });
    expect(after.lines[0].unitPrice).toBe(12345);
    expect(after.subtotal).toBe(12345);
    await db.corporateContract.update({ where: { id: c.id }, data: { status: "ENDED" } });
    const ended = await quoteCart(member, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: member.addresses[0]?.id });
    expect(ended.lines[0].unitPrice).toBe(box.price);
  });
});

describe("per-day cut-off at checkout", () => {
  it("uses the menu day's cut-off, and the company override when earlier", async () => {
    const fd = serviceDay(50);
    const box = await primaryBoxOn(fd);
    const menu = await db.weeklyMenu.create({
      data: { title: `WP03 cutoff ${tag}`, weekStart: dateOnly(weekStartOf(fd)), status: "PUBLISHED", publishedAt: new Date(), days: { create: [{ day: weekdayOf(fd), cutoffOverride: "09:00", items: { create: [{ boxId: box.id, isPrimary: true }] } }] } },
      include: { days: true },
    });
    try {
      clock.now = { date: fd, time: "10:00" };
      const b = await loadUser(B);
      const lines = [{ kind: "box" as const, id: box.id, date: fd, qty: 1 }];
      const early = await quoteCart(b, { lines, addressId: b.addresses[0].id });
      expect(early.ok).toBe(false);
      expect(early.lines[0].problem).toMatch(/close at 09:00/);

      await db.menuDay.update({ where: { id: menu.days[0].id }, data: { cutoffOverride: "11:00" } });
      const late = await quoteCart(b, { lines, addressId: b.addresses[0].id });
      expect(late.lines[0].problem).toBeNull(); // later than the global 09:30, the day's own cut-off wins

      await db.company.update({ where: { id: fx.company }, data: { cutoffOverride: "09:45" } });
      const member = await loadUser(`wp03-2-${tag}@test.local`);
      const co = await quoteCart(member, { lines, addressId: member.addresses[0]?.id });
      expect(co.lines[0].problem).toMatch(/close at 09:45/);
    } finally {
      clock.now = null;
      await db.company.update({ where: { id: fx.company }, data: { cutoffOverride: null } });
      await db.weeklyMenu.delete({ where: { id: menu.id } });
    }
  });
});

describe("order edits", () => {
  it("line edit before the cut-off re-quotes, records an adjustment + charge, never rewrites totals", async () => {
    const d = await nextDay();
    const { order, box } = await freshOrder(C, d, 1);
    const r = await editOrderLines(owner, order.id, { version: order.version, items: [{ itemId: (await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).id, qty: 2 }], reason: "Customer called for one more" });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, adjustments: true } });
    expect(after.total).toBe(order.total);
    expect(after.customerShare).toBe(order.customerShare);
    expect(after.items[0].quantity).toBe(2);
    expect(after.version).toBe(order.version + 1);
    expect(r.delta.subtotal).toBe(box.price);
    expect(after.adjustments.map((a) => a.amount)).toEqual([r.delta.customer]);
    expect(r.chargePayment?.status).toBe("PENDING");
    const charge = await db.payment.findUniqueOrThrow({ where: { id: r.chargePayment!.id } });
    expect(charge.amount).toBe(r.delta.customer);
    expect(await db.auditLog.count({ where: { action: "order.edit_lines", entityId: order.id } })).toBe(1);

    // Stale version → conflict.
    await expect(editOrderLines(owner, order.id, { version: order.version, items: [{ itemId: after.items[0].id, qty: 1 }], reason: "Again" })).rejects.toBeInstanceOf(VersionConflict);
  });

  it("a reduction on a paid order goes back as wallet credit", async () => {
    const d = await nextDay();
    const { order } = await freshOrder(C, d, 2);
    await db.payment.update({ where: { id: order.paymentId! }, data: { status: "PAID", paidAt: new Date() } });
    await db.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const r = await editOrderLines(owner, order.id, { version: order.version, items: [{ itemId: item.id, qty: 1 }], reason: "One colleague is away" });
    expect(r.delta.customer).toBeLessThan(0);
    const credit = await db.creditLedger.findFirstOrThrow({ where: { orderId: order.id, reason: "ADJUSTMENT" } });
    expect(credit.amount).toBe(-r.delta.customer);
    const p = await db.payment.findUniqueOrThrow({ where: { id: order.paymentId! } });
    expect(p.amount).toBe(order.customerShare); // payment record untouched
  });

  it("refuses edits after the cut-off / kitchen lock", async () => {
    const d = await nextDay();
    const { order } = await freshOrder(C, d, 1);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await db.dayLock.create({ data: { kitchenId: order.kitchenId, date: dateOnly(d), orderCount: 0 } });
    try {
      await expect(editOrderLines(owner, order.id, { version: order.version, items: [{ itemId: item.id, qty: 2 }], reason: "Too late" })).rejects.toThrow(/closed/);
      await expect(reassignKitchen(owner, order.id, { version: order.version, kitchenId: fx.k2, reason: "Too late" })).rejects.toThrow(/closed/);
      expect((await db.orderItem.findUniqueOrThrow({ where: { id: item.id } })).quantity).toBe(1);
    } finally {
      await db.dayLock.delete({ where: { kitchenId_date: { kitchenId: order.kitchenId, date: dateOnly(d) } } });
    }
  });

  it("applies an approved substitution: new components snapshot, customization row and price difference", async () => {
    const d = await nextDay();
    const box = await primaryBoxOn(d);
    const from = box.items[0].menuItem;
    const to = await db.menuItem.findFirstOrThrow({ where: { id: { notIn: box.items.map((i) => i.menuItemId) }, allergens: { none: {} }, isActive: true } as never });
    const sub = await db.boxSubstitution.upsert({
      where: { boxId_fromItemId_toItemId: { boxId: box.id, fromItemId: from.id, toItemId: to.id } },
      create: { boxId: box.id, fromItemId: from.id, toItemId: to.id, priceDelta: 2000 },
      update: { priceDelta: 2000, isActive: true },
    });
    try {
      const { order } = await freshOrder(C, d, 1);
      const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      const r = await substituteOrderItem(owner, order.id, { version: order.version, itemId: item.id, substitutionId: sub.id, reason: "Out of stock" });
      const after = await db.orderItem.findUniqueOrThrow({ where: { id: item.id }, include: { customizations: true } });
      const comps = after.components as { menuItemId: string; substitutedFrom?: string }[];
      expect(comps.some((c) => c.menuItemId === to.id && c.substitutedFrom === from.name)).toBe(true);
      expect(comps.some((c) => c.menuItemId === from.id)).toBe(false);
      expect(after.unitPrice).toBe(item.unitPrice + 2000);
      expect(after.customizations.some((c) => c.kind === "SUBSTITUTE" && c.priceDelta === 2000)).toBe(true);
      expect(r.delta.subtotal).toBe(2000);
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).total).toBe(order.total);
      await expect(substituteOrderItem(owner, order.id, { version: r.version, itemId: item.id, substitutionId: sub.id, reason: "Twice" })).rejects.toThrow(/isn't in this dabba/);
    } finally {
      await db.boxSubstitution.delete({ where: { id: sub.id } });
    }
  });
});

describe("reassignment", () => {
  it("moves an order to another kitchen only when it has capacity", async () => {
    const d = await nextDay();
    const { order } = await freshOrder(B, d, 2);
    await expect(reassignKitchen(owner, order.id, { version: order.version, kitchenId: fx.k2, reason: "Main kitchen gas outage" })).rejects.toThrow(/fully booked/);
    await db.kitchen.update({ where: { id: fx.k2 }, data: { dailyCapacity: 10 } });
    const r = await reassignKitchen(owner, order.id, { version: order.version, kitchenId: fx.k2, reason: "Main kitchen gas outage" });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.kitchenId).toBe(fx.k2);
    expect(after.version).toBe(r.version);
    expect(await db.auditLog.count({ where: { action: "order.reassign_kitchen", entityId: order.id } })).toBe(1);
  });

  it("changes the delivery window within the kitchen (slot checked)", async () => {
    const d = await nextDay();
    const { order } = await freshOrder(B, d, 1);
    const slot = await db.deliverySlot.findFirstOrThrow({ where: { kitchenId: order.kitchenId, isActive: true } });
    const r = await reassignDelivery(owner, order.id, { version: order.version, slotId: slot.id, reason: "Customer asked for later" });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.slotId).toBe(slot.id);
    expect(after.version).toBe(r.version);
    const other = await db.deliverySlot.create({ data: { kitchenId: fx.k2, label: "WP03", startTime: "12:00", endTime: "12:30" } });
    await expect(reassignDelivery(owner, order.id, { version: r.version, slotId: other.id, reason: "Wrong kitchen slot" })).rejects.toThrow(/isn't available/);
  });
});

describe("permissions, scope and export", () => {
  it("refuses staff without the permission or outside their kitchen", async () => {
    const d = await nextDay();
    const box = await primaryBoxOn(d);
    const customer = await loadUser(B);
    const input = { customerId: customer.id, addressId: customer.addresses[0].id, lines: [{ kind: "box" as const, id: box.id, date: d, qty: 1 }], method: "CASH" as const, idempotencyKey: key("forbidden") };
    await expect(createManualOrder(chef, input)).rejects.toBeInstanceOf(OrderForbidden);
    await expect(createManualOrder(finance, input)).rejects.toBeInstanceOf(OrderForbidden);
    await expect(createCorporateBulkOrder(chef, { companyId: fx.company, date: d, lines: [], idempotencyKey: key("bulk-x") })).rejects.toBeInstanceOf(OrderForbidden);
    const { order } = await freshOrder(B, d, 1);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await expect(editOrderLines(finance, order.id, { version: order.version, items: [{ itemId: item.id, qty: 2 }], reason: "nope" })).rejects.toBeInstanceOf(OrderForbidden);
    await expect(reassignKitchen(chef, order.id, { version: order.version, kitchenId: fx.k2, reason: "nope" })).rejects.toBeInstanceOf(OrderForbidden);
    await expect(exportOrdersCsv(support, {})).rejects.toBeInstanceOf(OrderForbidden);
    // Scoped ops manager (only the second kitchen) can't touch an order of the main kitchen.
    const scoped = await db.user.create({ data: { name: "WP03 scoped ops", email: `wp03-ops-${tag}@test.local`, role: "OPERATIONS_MANAGER", kitchenId: fx.k2 } });
    const ops = await loadUser(scoped.email);
    await expect(editOrderLines(ops, order.id, { version: order.version, items: [{ itemId: item.id, qty: 2 }], reason: "scope" })).rejects.toThrow(/scope/);
    expect(await db.order.count({ where: { id: order.id, version: order.version } })).toBe(1);
    // Edits need a reason.
    await expect(editOrderLines(owner, order.id, { version: order.version, items: [{ itemId: item.id, qty: 2 }], reason: "" })).rejects.toBeInstanceOf(OrderAdminError);
  });

  it("exports filtered orders, masks contact details without customers.pii and audits it", async () => {
    const d = manualDay;
    const sp = { from: d, to: d, q: "Sample Customer B" };
    const full = await exportOrdersCsv(owner, sp);
    expect(full.rows).toBeGreaterThan(0);
    expect(full.body).toContain("980-000-0002");
    expect(full.body).toContain("customer.b@demo");
    const masked = await exportOrdersCsv(finance, sp);
    expect(masked.rows).toBe(full.rows);
    expect(masked.body).not.toContain("980-000-0002");
    expect(masked.body).not.toContain("customer.b@demo");
    expect(masked.body).toContain("980-•••-•002");
    expect(await db.auditLog.count({ where: { action: "orders.export", actorId: finance.id } })).toBeGreaterThan(0);
    expect(isoDate(dateOnly(d))).toBe(d);
  });
});
