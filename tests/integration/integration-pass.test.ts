import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { addDays, dateOnly, isoDate, todayKTM, weekdayOf } from "@/lib/dates";
import { companySpecFor } from "@/server/corporate";
import { getClosures, getLockedDates, orderableDates } from "@/server/calendar";
import { getOffersForDates } from "@/server/menu";
import { placeCartOrder, quoteCart } from "@/server/orders";
import { createCorporateBulkOrder, createManualOrder } from "@/server/orders-admin";
import { createSubscription } from "@/server/subscriptions";
import { generateInvoice, issueInvoice, uninvoicedByCompany } from "@/server/invoices";
import { loadUser } from "../helpers";

/**
 * Integration pass (cross-package requests touching the ordering core): distance fee bands + zone windows,
 * company menu + per-day company share, suspended customers, subscription attribution, kitchen gate dates,
 * contract-aware invoices from the /admin/invoices path.
 */

const tag = Date.now().toString(36);
let owner: Awaited<ReturnType<typeof loadUser>>;
let kitchenId = "";
let baseZoneId = "";
const cleanup = { slots: [] as string[], zones: [] as string[], kitchens: [] as string[] };

// Distinct open service days at the pilot kitchen, well past any cut-off.
let cursor = 0;
async function nextDay(notWeekday?: Weekday) {
  for (;;) {
    const d = addDays(todayKTM(), 3 + cursor++);
    if (weekdayOf(d) === "SAT" || weekdayOf(d) === notWeekday) continue;
    const [closed, locked] = await Promise.all([getClosures(d, d, kitchenId), getLockedDates(d, d, kitchenId)]);
    if (closed.size || locked.size) continue;
    const offer = (await getOffersForDates([d], kitchenId)).get(d);
    if (!offer || offer.closed || !offer.items.some((i) => !i.soldOut)) continue;
    return d;
  }
}
async function boxOn(d: string) {
  const offer = (await getOffersForDates([d], kitchenId)).get(d)!;
  return offer.items.find((i) => !i.soldOut)!.box;
}
async function makeUser(key: string, address: { zoneId: string; lat?: number | null; lng?: number | null }[] = [{ zoneId: baseZoneId }]) {
  const email = `ip-${key}-${tag}@test.local`;
  const u = await db.user.create({ data: { name: `IP ${key}`, email, phoneNumber: `98${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}` } });
  for (const [i, a] of address.entries())
    await db.address.create({ data: { userId: u.id, label: `A${i}`, type: "HOME", recipientName: u.name, phone: "9800000000", line1: `Lane ${i}`, area: "New Baneshwor", zoneId: a.zoneId, lat: a.lat ?? null, lng: a.lng ?? null, isDefault: i === 0 } });
  return { id: u.id, email };
}
async function makeCompany(key: string, extra: { invoiceTermsDays?: number } = {}) {
  return db.company.create({
    data: { name: `IP ${key} ${tag}`, slug: `ip-${key}-${tag}`, billingMode: "COMPANY_PAID", subsidyPct: 100, freeDelivery: true, requireApproval: false, zoneId: baseZoneId, ...extra },
  });
}
async function addMember(companyId: string, key: string, data: { eligibleDays?: Weekday[]; department?: string } = {}) {
  const u = await makeUser(key);
  const m = await db.companyMember.create({ data: { companyId, userId: u.id, status: "ACTIVE", eligibleDays: data.eligibleDays ?? [], department: data.department ?? null } });
  return { ...u, memberId: m.id };
}

beforeAll(async () => {
  owner = await loadUser("owner@test.local");
  kitchenId = (await db.kitchen.findFirstOrThrow({ where: { code: "KTM-1" } })).id;
  baseZoneId = (await db.deliveryZone.findFirstOrThrow({ where: { isActive: true, kitchenId }, orderBy: { sortOrder: "asc" } })).id;
});

afterAll(async () => {
  await db.deliverySlot.updateMany({ where: { id: { in: cleanup.slots } }, data: { isActive: false } });
  await db.deliveryZone.updateMany({ where: { id: { in: cleanup.zones } }, data: { isActive: false } });
  await db.kitchen.updateMany({ where: { id: { in: cleanup.kitchens } }, data: { isActive: false } });
});

describe("distance fee bands at checkout (WP-13)", () => {
  it("flat fee without a pin, band fee with a pin, refused beyond the radius; slots limited to the zone's windows", async () => {
    const [inZone, outZone] = await Promise.all([
      db.deliverySlot.create({ data: { kitchenId, label: `IP in ${tag}`, startTime: "12:00", endTime: "12:30", capacity: 500, sortOrder: 90 } }),
      db.deliverySlot.create({ data: { kitchenId, label: `IP out ${tag}`, startTime: "13:00", endTime: "13:30", capacity: 500, sortOrder: 91 } }),
    ]);
    cleanup.slots.push(inZone.id, outZone.id);
    const origin = { lat: 27.7, lng: 85.33 };
    const zone = await db.deliveryZone.create({
      data: {
        name: `IP Banded ${tag}`,
        areas: [`ip-banded-${tag}`],
        kitchenId,
        fee: 3000,
        freeAbove: 999_999_99,
        sortOrder: 999,
        distanceRules: { origin, bands: [{ maxKm: 3, fee: 5000 }, { maxKm: 6, fee: 9000 }], slotIds: [inZone.id] },
      },
    });
    cleanup.zones.push(zone.id);
    const u = await makeUser("banded", [
      { zoneId: zone.id }, // no pin
      { zoneId: zone.id, lat: 27.71, lng: 85.33 }, // ~1.1 km
      { zoneId: zone.id, lat: 27.8, lng: 85.33 }, // ~11 km
    ]);
    const user = await loadUser(u.email);
    const [noPin, near, far] = ["A0", "A1", "A2"].map((l) => user.addresses.find((a) => a.label === l)!);
    const d = await nextDay();
    const lines = [{ kind: "box" as const, id: (await boxOn(d)).id, date: d, qty: 1 }];

    const flat = await quoteCart(user, { lines, addressId: noPin.id });
    expect(flat.ok).toBe(true);
    expect(flat.deliveryFee).toBe(3000);
    const banded = await quoteCart(user, { lines, addressId: near.id });
    expect(banded.ok).toBe(true);
    expect(banded.deliveryFee).toBe(5000);
    expect(banded.total - flat.total).toBe(2000);
    const beyond = await quoteCart(user, { lines, addressId: far.id });
    expect(beyond.ok).toBe(false);
    expect(beyond.error).toMatch(/beyond/);
    expect(beyond.addressProblem).toMatch(/beyond/);
    await expect(placeCartOrder(user, { lines, addressId: far.id, method: "CASH" })).rejects.toThrow(/beyond/);

    // Zone time windows: a window of the same kitchen outside the zone's list is refused.
    await expect(placeCartOrder(user, { lines, addressId: near.id, slotId: outZone.id, method: "CASH" })).rejects.toThrow(/delivery window/);
    const r = await placeCartOrder(user, { lines, addressId: near.id, slotId: inZone.id, method: "CASH" });
    expect(r.orders[0].deliveryFee).toBe(5000);
    expect(r.orders[0].slotId).toBe(inZone.id);
  });
});

describe("company menu + per-day company share (WP-12)", () => {
  it("refuses dabbas outside the company menu for company-billed members", async () => {
    const c = await makeCompany("menu");
    const m = await addMember(c.id, "menu-m");
    const d = await nextDay();
    const box = await boxOn(d);
    const other = await db.lunchBox.findFirstOrThrow({ where: { id: { not: box.id } } });
    await db.companyMenuItem.create({ data: { companyId: c.id, boxId: other.id } });
    const user = await loadUser(m.email);
    const lines = [{ kind: "box" as const, id: box.id, date: d, qty: 1 }];
    const q = await quoteCart(user, { lines, addressId: user.addresses[0].id });
    expect(q.ok).toBe(false);
    expect(q.error).toMatch(/lunch menu/);
    await expect(placeCartOrder(user, { lines, addressId: user.addresses[0].id, method: "CASH" })).rejects.toThrow(/lunch menu/);
    await db.companyMenuItem.create({ data: { companyId: c.id, boxId: box.id } });
    expect((await quoteCart(user, { lines, addressId: user.addresses[0].id })).ok).toBe(true);
  });

  it("bills the company only for eligible days without zeroing the share of the others", async () => {
    const c = await makeCompany("perday");
    const d1 = await nextDay();
    const d2 = await nextDay(weekdayOf(d1));
    const m = await addMember(c.id, "perday-m", { eligibleDays: [weekdayOf(d1)] });
    const user = await loadUser(m.email);
    const lines = [
      { kind: "box" as const, id: (await boxOn(d1)).id, date: d1, qty: 1 },
      { kind: "box" as const, id: (await boxOn(d2)).id, date: d2, qty: 1 },
    ];
    // The old cart-wide spec gave the company nothing for this cart.
    expect((await companySpecFor(m.id, c, [d1, d2]))?.allowanceRemaining).toBe(0);
    const q = await quoteCart(user, { lines, addressId: user.addresses[0].id });
    expect(q.ok).toBe(true);
    const day1 = q.days.find((x) => x.date === d1)!;
    const day2 = q.days.find((x) => x.date === d2)!;
    expect(day1.companyShare).toBe(day1.total);
    expect(day1.customerShare).toBe(0);
    expect(day2.companyShare).toBe(0);
    expect(day2.customerShare).toBe(day2.total);
    expect(q.companyShare).toBe(day1.total);
    const r = await placeCartOrder(user, { lines, addressId: user.addresses[0].id, method: "CASH" });
    const byDate = new Map(r.orders.map((o) => [isoDate(o.deliveryDate), o]));
    expect(byDate.get(d1)!.companyShare).toBe(day1.total);
    expect(byDate.get(d2)!.companyShare).toBe(0);
  });

  it("staff bulk orders apply the company menu and department budget", async () => {
    const c = await makeCompany("bulk");
    const d = await nextDay();
    const box = await boxOn(d);
    const other = await db.lunchBox.findFirstOrThrow({ where: { id: { not: box.id } } });
    await db.companyMenuItem.createMany({ data: [{ companyId: c.id, boxId: box.id }] });
    const ok = await addMember(c.id, "bulk-ok", { department: "Ops" });
    const tight = await addMember(c.id, "bulk-tight", { department: "Sales" });
    await db.departmentBudget.create({ data: { companyId: c.id, department: "Sales", month: d.slice(0, 7), amount: 100 } });
    const res = await createCorporateBulkOrder(owner, {
      companyId: c.id,
      date: d,
      idempotencyKey: `ip-bulk-${tag}`,
      lines: [
        { memberId: ok.memberId, boxId: other.id },
        { memberId: tight.memberId, boxId: box.id },
      ],
    });
    expect(res.results.find((r) => r.memberId === ok.memberId)).toMatchObject({ ok: false, message: expect.stringMatching(/lunch menu/) });
    expect(res.results.find((r) => r.memberId === tight.memberId)).toMatchObject({ ok: false, message: expect.stringMatching(/Over budget/) });
    const good = await createCorporateBulkOrder(owner, { companyId: c.id, date: d, idempotencyKey: `ip-bulk2-${tag}`, lines: [{ memberId: ok.memberId, boxId: box.id }] });
    expect(good.results[0].ok).toBe(true);
  });
});

describe("suspended customers (WP-11)", () => {
  it("staff, bulk and direct (team) orders refuse a suspended or deleted account", async () => {
    const u = await makeUser("suspended");
    await db.user.update({ where: { id: u.id }, data: { isActive: false } });
    const customer = await loadUser(u.email);
    const d = await nextDay();
    const lines = [{ kind: "box" as const, id: (await boxOn(d)).id, date: d, qty: 1 }];
    await expect(createManualOrder(owner, { customerId: u.id, addressId: customer.addresses[0].id, lines, method: "CASH", idempotencyKey: `ip-susp-${tag}`, reason: "Phoned in" })).rejects.toThrow(/suspended/);
    // The team order path goes through placeCartOrder.
    await expect(placeCartOrder(customer, { lines, addressId: customer.addresses[0].id, method: "CASH" })).rejects.toThrow(/suspended/);

    const c = await makeCompany("susp");
    const m = await addMember(c.id, "susp-m");
    await db.user.update({ where: { id: m.id }, data: { deletedAt: new Date() } });
    const res = await createCorporateBulkOrder(owner, { companyId: c.id, date: d, idempotencyKey: `ip-susp-bulk-${tag}`, lines: [{ memberId: m.memberId, boxId: lines[0].id }] });
    expect(res.results[0]).toMatchObject({ ok: false, message: expect.stringMatching(/suspended/) });
    expect(await db.order.count({ where: { userId: { in: [u.id, m.id] } } })).toBe(0);
  });
});

describe("subscription attribution (WP-11)", () => {
  it("stores the campaign id on the subscription when the campaign exists", async () => {
    const plan = await db.mealPlan.findFirstOrThrow({ where: { slug: "hapta", isActive: true } });
    const campaign = await db.campaign.create({ data: { name: `IP campaign ${tag}`, channel: "FACEBOOK", utmCampaign: `ip-${tag}` } });
    const u = await makeUser("sub-attr");
    const user = await loadUser(u.email);
    const days: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI"];
    const start = addDays(todayKTM(), 40);
    const sub = await createSubscription(user, { planId: plan.id, startDate: start, days, addressId: user.addresses[0].id, method: "CASH", attribution: { source: "facebook", campaign: `ip-${tag}`, campaignId: campaign.id } });
    expect(sub.subscription.campaignId).toBe(campaign.id);
    const u2 = await makeUser("sub-attr2");
    const user2 = await loadUser(u2.email);
    const sub2 = await createSubscription(user2, { planId: plan.id, startDate: start, days, addressId: user2.addresses[0].id, method: "CASH", attribution: { campaignId: "not-a-campaign" } });
    expect(sub2.subscription.campaignId).toBeNull();
  });
});

describe("kitchen gate in date pickers (WP-07)", () => {
  it("orderableDates / getLockedDates drop paused kitchens and non-working weekdays", async () => {
    const settings = await getSettings();
    const paused = await db.kitchen.create({ data: { name: `IP paused ${tag}`, code: `IP-P-${tag}`, status: "PAUSED", statusNote: "Gas outage" } });
    const weekdayOnly = await db.kitchen.create({ data: { name: `IP weekday ${tag}`, code: `IP-W-${tag}`, workingDays: ["MON"] } });
    cleanup.kitchens.push(paused.id, weekdayOnly.id);
    const from = todayKTM();
    const to = addDays(from, 13);
    expect(await orderableDates(settings, 14, paused.id)).toEqual([]);
    expect((await getLockedDates(from, to, paused.id)).size).toBe(14);
    const dates = await orderableDates(settings, 14, weekdayOnly.id);
    expect(dates.every((x) => weekdayOf(x) === "MON")).toBe(true);
    const locked = await getLockedDates(from, to, weekdayOnly.id);
    for (let x = from; x <= to; x = addDays(x, 1)) expect(locked.has(x)).toBe(weekdayOf(x) !== "MON");
    // The open pilot kitchen still has dates, and the all-kitchen view isn't blocked by one paused kitchen.
    expect((await orderableDates(settings, 5, kitchenId)).length).toBeGreaterThan(0);
    expect((await orderableDates(settings, 5)).length).toBeGreaterThan(0);
    await db.kitchen.updateMany({ where: { id: { in: [paused.id, weekdayOnly.id] } }, data: { isActive: false } });
  });
});

describe("/admin/invoices path (WP-12 → invoices.ts)", () => {
  it("generate/issue apply company-share adjustments and the contract's credit terms; receivables include adjustments", async () => {
    const c = await makeCompany("inv", { invoiceTermsDays: 10 });
    await db.corporateContract.create({ data: { companyId: c.id, title: "IP contract", startsOn: dateOnly(addDays(todayKTM(), -90)), status: "ACTIVE", creditTermsDays: 45 } });
    const m = await addMember(c.id, "inv-m");
    const user = await loadUser(m.email);
    const d = await nextDay();
    const r = await placeCartOrder(user, { lines: [{ kind: "box", id: (await boxOn(d)).id, date: d, qty: 1 }], addressId: user.addresses[0].id, method: "CASH" });
    const past = addDays(todayKTM(), -5);
    const order = await db.order.update({ where: { id: r.orders[0].id }, data: { deliveryDate: dateOnly(past), status: "DELIVERED" } });
    expect(order.companyShare).toBeGreaterThan(0);
    const adj = await db.orderAdjustment.create({ data: { orderId: order.id, amount: 1200, reason: "Company share: extra dabba", actorId: owner.id } });
    await db.orderAdjustment.create({ data: { orderId: order.id, amount: -400, reason: "Customer credit: late", actorId: owner.id } });

    const pending = (await uninvoicedByCompany()).find((p) => p.companyId === c.id)!;
    expect(pending.amount).toBe(order.companyShare + 1200);
    expect(pending.adjustments).toBe(1200);

    const inv = await generateInvoice({ companyId: c.id, periodStart: past, periodEnd: past, actorId: owner.id });
    expect(inv.total).toBe(order.companyShare + 1200);
    const lines = await db.invoiceLine.findMany({ where: { invoiceId: inv.id } });
    expect(lines.some((l) => l.description.includes(`[adj:${adj.id}]`))).toBe(true);
    expect(isoDate(inv.dueDate!)).toBe(addDays(past, 45));
    const issued = await issueInvoice(inv.id, owner.id);
    expect(isoDate(issued.dueDate!)).toBe(addDays(todayKTM(), 45)); // contract terms, not the company's 10 days
    expect((await uninvoicedByCompany()).some((p) => p.companyId === c.id)).toBe(false);
    await expect(generateInvoice({ companyId: c.id, periodStart: past, periodEnd: past, actorId: owner.id })).rejects.toThrow(/Nothing to invoice/);
  });
});
