import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, dateOnly, todayKTM } from "@/lib/dates";
import { placeCartOrder, setOrderStatus } from "@/server/orders";
import { reassignDelivery } from "@/server/orders-admin";
import {
  acknowledgeChange,
  assignOrders,
  autoGroupRoutes,
  createRoute,
  deleteRiderProfile,
  deliverStop,
  deliveryPerformance,
  failStop,
  failedReason,
  listRiders,
  riderDate,
  riderDayWindow,
  riderRoute,
  riderRoutes,
  routeChanges,
  saveRider,
  setRouteCost,
  setRouteRider,
  startRoute,
  type DispatchActor,
} from "@/server/dispatch";
import { findZone, inValley, parseBandLines, parseZoneRules, quoteCoverage, relinkUncoveredAddresses, validateZoneRules, VALLEY_WILDCARD, zoneFee, zoneRulesJson, zoneSlots } from "@/server/coverage";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

const B = "customer.b@demo.dabbabela.local";
const tag = `wp13${Date.now().toString(36)}`;
const created: { users: string[]; zones: string[] } = { users: [], zones: [] };

async function newRider(name: string, kitchenId: string | null = null) {
  const u = await db.user.create({ data: { name, email: `${tag}.${name.toLowerCase().replace(/\W/g, "")}@test.local`, role: "DELIVERY_AGENT", kitchenId } });
  created.users.push(u.id);
  return u;
}

async function cashOrder(date: string, slotId?: string) {
  const user = await loadUser(B);
  const box = await primaryBoxOn(date);
  const res = await placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date, qty: 1 }], addressId: user.addresses[0].id, method: "CASH", slotId });
  return res.orders[0];
}

async function packed(id: string) {
  await setOrderStatus([id], "PREPARING", null);
  await setOrderStatus([id], "PACKED", null);
}

let kitchenId: string;
let dispatcher: DispatchActor;

beforeAll(async () => {
  const user = await loadUser(B);
  kitchenId = user.addresses[0].zone!.kitchenId;
  dispatcher = await loadUser("dispatch@demo.dabbabela.local");
});

afterAll(async () => {
  await db.deliveryZone.updateMany({ where: { id: { in: created.zones } }, data: { isActive: false } });
  await db.user.updateMany({ where: { id: { in: created.users } }, data: { isActive: false } });
});

describe("rider profiles", () => {
  it("creates, updates and removes a rider profile with permission + kitchen scope checks", async () => {
    const r = await newRider("Crud Rider");
    const zone = await db.deliveryZone.findFirstOrThrow({ where: { kitchenId, isActive: true } });
    const p = await saveRider(dispatcher, { userId: r.id, vehicle: "Scooter Ba 1 Pa 1", phone: "9800000001", isAvailable: true, zoneIds: [zone.id], kitchenId, notes: "Knows Baneshwor" });
    expect(p.zoneIds).toEqual([zone.id]);
    expect((await db.user.findUniqueOrThrow({ where: { id: r.id } })).kitchenId).toBe(kitchenId);
    expect(await db.auditLog.count({ where: { action: "rider.create", entityId: r.id } })).toBe(1);

    await saveRider(dispatcher, { userId: r.id, vehicle: "Bike", phone: null, isAvailable: false, zoneIds: [], kitchenId, notes: null });
    expect((await db.riderProfile.findUniqueOrThrow({ where: { userId: r.id } })).vehicle).toBe("Bike");
    expect(await db.auditLog.count({ where: { action: "rider.update", entityId: r.id } })).toBe(1);

    // no dispatch.edit → refused
    const finance = await loadUser("finance@demo.dabbabela.local");
    await expect(saveRider(finance, { userId: r.id, isAvailable: true, zoneIds: [], kitchenId })).rejects.toThrow(/permission/);
    // kitchen-scoped dispatcher can't touch another kitchen's rider or move one out of scope
    const scoped: DispatchActor = { ...dispatcher, kitchenIds: ["some-other-kitchen"] };
    await expect(saveRider(scoped, { userId: r.id, isAvailable: true, zoneIds: [], kitchenId })).rejects.toThrow(/outside your scope/);
    expect((await listRiders(scoped)).some((x) => x.id === r.id)).toBe(false);
    expect((await listRiders(dispatcher)).some((x) => x.id === r.id)).toBe(true);
    // only DELIVERY_AGENT users can be linked; zones must belong to the rider's kitchen
    const chef = await db.user.findUniqueOrThrow({ where: { email: "chef@demo.dabbabela.local" } });
    await expect(saveRider(dispatcher, { userId: chef.id, isAvailable: true, zoneIds: [], kitchenId: null })).rejects.toThrow(/delivery rider role/);
    const foreignZone = await db.deliveryZone.findFirst({ where: { kitchenId: { not: kitchenId } } });
    if (foreignZone) await expect(saveRider(dispatcher, { userId: r.id, isAvailable: true, zoneIds: [foreignZone.id], kitchenId })).rejects.toThrow(/rider's kitchen/);

    await deleteRiderProfile(dispatcher, r.id);
    expect(await db.riderProfile.findUnique({ where: { userId: r.id } })).toBeNull();
    expect(await db.auditLog.count({ where: { action: "rider.delete", entityId: r.id } })).toBe(1);
  });

  it("dispatch refuses unavailable riders and riders of another kitchen", async () => {
    const date = addDays(todayKTM(), 3);
    const off = await newRider("Off Rider");
    await saveRider(dispatcher, { userId: off.id, isAvailable: false, zoneIds: [], kitchenId });
    await expect(createRoute({ kitchenId, date, name: `${tag} off`, riderId: off.id })).rejects.toThrow(/unavailable/);
    const elsewhere = await newRider("Elsewhere Rider", "another-kitchen-id");
    const route = await createRoute({ kitchenId, date, name: `${tag} elsewhere` });
    await expect(setRouteRider(route.id, elsewhere.id)).rejects.toThrow(/another kitchen/);
  });
});

describe("zones: distance bands, kitchen mapping, windows", () => {
  it("parses and validates distance bands", () => {
    expect(parseBandLines("3, 0\n6 km, Rs 50\n10 90.5")).toEqual([
      { maxKm: 3, fee: 0 },
      { maxKm: 6, fee: 5000 },
      { maxKm: 10, fee: 9050 },
    ]);
    expect(() => parseBandLines("three km")).toThrow(/km, Rs/);
    expect(() => validateZoneRules({ bands: [{ maxKm: 3, fee: 0 }] })).toThrow(/origin/);
    expect(() => validateZoneRules({ origin: { lat: 27.7, lng: 85.3 }, bands: [{ maxKm: 3, fee: 0 }, { maxKm: 3, fee: 100 }] })).toThrow(/Two bands/);
    expect(parseZoneRules([{ maxKm: 5, fee: 100 }, { maxKm: -1, fee: 2 }])).toEqual({ origin: null, bands: [{ maxKm: 5, fee: 100 }], slotIds: [] });
  });

  it("charges the band fee by distance, flat without a pin, and refuses past the last band", () => {
    const origin = { lat: 27.7, lng: 85.3 };
    const zone = { fee: 4000, distanceRules: zoneRulesJson(validateZoneRules({ origin, bands: [{ maxKm: 6, fee: 6000 }, { maxKm: 3, fee: 2000 }] })) };
    // ~0.01° lat ≈ 1.11 km
    expect(zoneFee(zone, { lat: 27.72, lng: 85.3 })).toMatchObject({ fee: 2000, basis: "distance", beyond: false, band: { maxKm: 3 } });
    expect(zoneFee(zone, { lat: 27.74, lng: 85.3 })).toMatchObject({ fee: 6000, band: { maxKm: 6 } });
    const far = zoneFee(zone, { lat: 27.8, lng: 85.3 });
    expect(far.beyond).toBe(true);
    expect(far.distanceKm).toBeGreaterThan(11);
    expect(zoneFee(zone, null)).toMatchObject({ fee: 4000, basis: "flat" });
    expect(zoneFee({ fee: 4000, distanceRules: null }, { lat: 27.74, lng: 85.3 })).toMatchObject({ fee: 4000, basis: "flat" });
  });

  it("maps an area to its zone's kitchen, windows and fee", async () => {
    const slots = await db.deliverySlot.findMany({ where: { kitchenId, isActive: true }, orderBy: { sortOrder: "asc" } });
    const area = `${tag} Tole`;
    const rules = validateZoneRules({ origin: { lat: 27.7, lng: 85.3 }, bands: [{ maxKm: 3, fee: 0 }, { maxKm: 6, fee: 5000 }], slotIds: [slots[0].id] });
    const z = await db.deliveryZone.create({ data: { name: `${tag} zone`, areas: [area], wards: [], kitchenId, fee: 3000, distanceRules: zoneRulesJson(rules)! } });
    created.zones.push(z.id);
    expect(zoneSlots(z, slots).map((s) => s.id)).toEqual([slots[0].id]);

    const flat = await quoteCoverage({ area });
    expect(flat.serviceable).toBe(true);
    expect(flat.zone!.id).toBe(z.id);
    expect(flat.zone!.kitchenId).toBe(kitchenId);
    expect(flat.fee!.fee).toBe(3000);
    expect(flat.slots.map((s) => s.id)).toEqual([slots[0].id]);

    const banded = await quoteCoverage({ area, lat: 27.74, lng: 85.3 });
    expect(banded.fee).toMatchObject({ fee: 5000, basis: "distance" });
    const far = await quoteCoverage({ area, lat: 27.9, lng: 85.3 });
    expect(far.serviceable).toBe(false);
    expect(far.reason).toMatch(/radius/);
    expect((await quoteCoverage({ area: `${tag} nowhere`, city: "Pokhara" })).serviceable).toBe(false);
  });

  it("serves the whole Kathmandu Valley: Lalitpur/Bhaktapur cities match named zones, the rest falls to the catch-all", async () => {
    const area = `${tag} Patan Tole`;
    const named = await db.deliveryZone.create({ data: { name: `${tag} patan zone`, city: "Kathmandu", areas: [area], wards: [], kitchenId, fee: 3000 } });
    created.zones.push(named.id);
    // a named valley locality typed with city "Lalitpur" still finds its Kathmandu-listed zone
    expect((await findZone({ area, city: "Lalitpur" }))?.id).toBe(named.id);
    expect((await findZone({ area, city: "Lalitpur Metropolitan City" }))?.id).toBe(named.id);

    // the foundation's catch-all zone ("*") covers any other valley address, never one outside it
    const valley = await db.deliveryZone.findFirst({ where: { areas: { has: VALLEY_WILDCARD }, isActive: true } });
    expect(valley).toBeTruthy();
    expect((await findZone({ area: `${tag} Chabahil`, city: "Kathmandu" }))?.id).toBe(valley!.id);
    expect((await findZone({ area: `${tag} Suryabinayak`, city: "Bhaktapur" }))?.id).toBe(valley!.id);
    expect((await findZone({ area: `${tag} Imadol`, municipality: "Mahalaxmi Municipality", city: "Lalitpur" }))?.id).toBe(valley!.id);
    expect(await findZone({ area: `${tag} Lakeside`, city: "Pokhara" })).toBeNull();
    expect(inValley("Kageshwori Manohara")).toBe(true);
    expect(inValley("Pokhara")).toBe(false);

    // saved addresses waiting without a zone get linked
    const u = await db.user.findFirstOrThrow({ where: { role: "CUSTOMER" } });
    const addr = await db.address.create({ data: { userId: u.id, label: `${tag} home`, recipientName: "Test", phone: "9800000000", line1: "Lane 1", area: `${tag} Kalanki`, city: "Kathmandu" } });
    try {
      expect(await relinkUncoveredAddresses()).toBeGreaterThanOrEqual(1);
      expect((await db.address.findUniqueOrThrow({ where: { id: addr.id } })).zoneId).toBe(valley!.id);
    } finally {
      await db.address.delete({ where: { id: addr.id } });
    }
  });
});

describe("dispatch improvements", () => {
  it("groups unrouted orders by slot × zone and records a route cost", async () => {
    const date = serviceDay(21, 0);
    const slots = await db.deliverySlot.findMany({ where: { kitchenId, isActive: true }, orderBy: { sortOrder: "asc" } });
    const a = await cashOrder(date, slots[0].id);
    const b = await cashOrder(date, slots[0].id);
    const c = await cashOrder(date, slots[1].id);
    const g = await autoGroupRoutes(kitchenId, date);
    expect(g.stops).toBeGreaterThanOrEqual(3);
    const asg = await db.deliveryAssignment.findMany({ where: { orderId: { in: [a.id, b.id, c.id] } }, include: { route: true } });
    expect(asg).toHaveLength(3);
    const ra = asg.find((x) => x.orderId === a.id)!.route;
    expect(asg.find((x) => x.orderId === b.id)!.routeId).toBe(ra.id);
    expect(asg.find((x) => x.orderId === c.id)!.routeId).not.toBe(ra.id);
    expect(ra.slotId).toBe(slots[0].id);
    expect((await autoGroupRoutes(kitchenId, date)).stops).toBe(0);
    await setRouteCost(ra.id, 25000);
    expect((await db.deliveryRoute.findUniqueOrThrow({ where: { id: ra.id } })).cost).toBe(25000);
    await expect(setRouteCost(ra.id, -1)).rejects.toThrow();
  });

  it("flags a routed order whose delivery was changed afterwards (WP-03 reassign)", async () => {
    const date = serviceDay(22, 0);
    const slots = await db.deliverySlot.findMany({ where: { kitchenId, isActive: true }, orderBy: { sortOrder: "asc" } });
    const o = await cashOrder(date, slots[0].id);
    const route = await createRoute({ kitchenId, date, name: `${tag} flag`, slotId: slots[0].id });
    await assignOrders(route.id, [o.id]);
    expect((await routeChanges([route.id])).size).toBe(0);
    const owner = await loadUser("owner@test.local");
    await reassignDelivery(owner, o.id, { version: o.version, slotId: slots[1].id, reason: "Customer wants a later window" });
    const flags = (await routeChanges([route.id])).get(o.id)!;
    expect(flags).toEqual(expect.arrayContaining(["Delivery details changed after routing", "Slot no longer matches the route"]));
    await acknowledgeChange(o.id);
    expect((await routeChanges([route.id])).get(o.id)).toEqual(["Slot no longer matches the route"]);
    const later = await createRoute({ kitchenId, date, name: `${tag} later`, slotId: slots[1].id });
    await assignOrders(later.id, [o.id]);
    expect((await routeChanges([route.id, later.id])).size).toBe(0);
  });

  it("requires a failed-delivery reason ('Other' needs details)", async () => {
    expect(() => failedReason("")).toThrow(/what went wrong/i);
    expect(() => failedReason("Other", "")).toThrow(/what went wrong/i);
    expect(failedReason("Other", "Gate locked")).toBe("Other: Gate locked");
    expect(failedReason("Customer not reachable", "called twice")).toBe("Customer not reachable — called twice");

    const date = serviceDay(23, 0);
    const rider = await newRider("Fail Rider", kitchenId);
    const o = await cashOrder(date);
    await packed(o.id);
    const route = await createRoute({ kitchenId, date, name: `${tag} fail`, riderId: rider.id });
    await assignOrders(route.id, [o.id]);
    await startRoute(route.id, dispatcher.id);
    await expect(failStop(o.id, { id: rider.id, isStaff: false }, "  ")).rejects.toThrow(/what went wrong/i);
    await expect(failStop(o.id, { id: rider.id, isStaff: false }, "Other")).rejects.toThrow(/what went wrong/i);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("OUT_FOR_DELIVERY");
    await failStop(o.id, { id: rider.id, isStaff: false }, "Other", "Building gate locked");
    const ev = await db.deliveryEvent.findFirstOrThrow({ where: { orderId: o.id, type: "FAILED" } });
    expect(ev.note).toBe("Other: Building gate locked");
  });
});

describe("rider app scope", () => {
  it("riders see only their own routes, within the date window; past days are read-only", async () => {
    const today = todayKTM();
    const w = riderDayWindow(today);
    expect(riderDate(addDays(today, -30), today)).toBe(today);
    expect(riderDate(addDays(today, 2), today)).toBe(addDays(today, 2));
    expect(riderDate("nonsense", today)).toBe(today);

    const r1 = await newRider("Scope One", kitchenId);
    const r2 = await newRider("Scope Two", kitchenId);
    const a1: DispatchActor = { id: r1.id, role: "DELIVERY_AGENT", kitchenIds: [kitchenId] };
    const a2: DispatchActor = { id: r2.id, role: "DELIVERY_AGENT", kitchenIds: [kitchenId] };
    const day = addDays(today, 2);
    const mine = await createRoute({ kitchenId, date: day, name: `${tag} r1`, riderId: r1.id });
    const theirs = await createRoute({ kitchenId, date: day, name: `${tag} r2`, riderId: r2.id });
    const seen = await riderRoutes(a1, day);
    expect(seen.map((r) => r.id)).toContain(mine.id);
    expect(seen.every((r) => r.riderId === r1.id)).toBe(true);
    expect(await riderRoute(a1, theirs.id)).toBeNull();
    expect((await riderRoute(a2, theirs.id))?.readOnly).toBe(false);
    const staff = (await riderRoutes({ ...dispatcher, kitchenIds: [kitchenId] }, day)).map((r) => r.id);
    expect(staff).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    expect(await riderRoutes({ ...dispatcher, kitchenIds: ["another-kitchen-id"] }, day)).toHaveLength(0);
    await expect(riderRoutes(a1, addDays(w.to, 1))).rejects.toThrow(/Pick a day/);

    // yesterday's route: visible, read-only, rider can't change stops
    const o = await cashOrder(serviceDay(25, 0));
    const yesterday = addDays(today, -1);
    await db.order.update({ where: { id: o.id }, data: { deliveryDate: dateOnly(yesterday), status: "OUT_FOR_DELIVERY" } });
    const past = await createRoute({ kitchenId, date: yesterday, name: `${tag} past`, riderId: r1.id });
    await assignOrders(past.id, [o.id]);
    expect((await riderRoutes(a1, yesterday)).map((r) => r.id)).toContain(past.id);
    expect((await riderRoute(a1, past.id))?.readOnly).toBe(true);
    await expect(failStop(o.id, { id: r1.id, isStaff: false }, "Customer not reachable")).rejects.toThrow(/read-only/);
    await expect(deliverStop(o.id, { id: r1.id, isStaff: false }, { cashCollected: o.customerShare })).rejects.toThrow(/read-only/);
  });
});

describe("delivery performance", () => {
  it("per-rider and per-zone numbers equal the DeliveryEvent records", async () => {
    const date = serviceDay(26, 0);
    const slots = await db.deliverySlot.findMany({ where: { kitchenId, isActive: true }, orderBy: { sortOrder: "asc" } });
    const rider = await newRider("Perf Rider", kitchenId);
    const o1 = await cashOrder(date, slots[0].id);
    const o2 = await cashOrder(date, slots[0].id);
    await packed(o1.id);
    await packed(o2.id);
    const route = await createRoute({ kitchenId, date, name: `${tag} perf`, riderId: rider.id, slotId: slots[0].id });
    await assignOrders(route.id, [o1.id, o2.id]);
    await setRouteCost(route.id, 30000);
    await startRoute(route.id, dispatcher.id);
    const f1 = await db.order.findUniqueOrThrow({ where: { id: o1.id } });
    await deliverStop(o1.id, { id: rider.id, isStaff: false }, { otp: f1.deliveryOtp ?? "", cashCollected: f1.customerShare });
    await failStop(o2.id, { id: rider.id, isStaff: false }, "Office/shop closed");

    const perf = await deliveryPerformance({ from: date, to: date, kitchenIds: [kitchenId] });
    const row = perf.riders.find((r) => r.key === rider.id)!;
    expect(row).toMatchObject({ label: "Perf Rider", delivered: 1, failed: 1, failedRate: 0.5, withSlot: 1, onTime: 1, onTimeRate: 1, days: 1, perDay: 1, cash: f1.customerShare, routes: 1, routeCost: 30000 });

    // totals and zones agree with a direct count of the records
    const events = await db.deliveryEvent.findMany({ where: { order: { deliveryDate: dateOnly(date), kitchenId } }, include: { order: { select: { zoneId: true } } } });
    const count = (t: string, zoneId?: string | null) => events.filter((e) => e.type === t && (zoneId === undefined || e.order.zoneId === zoneId)).length;
    expect(perf.total.delivered).toBe(count("DELIVERED"));
    expect(perf.total.failed).toBe(count("FAILED"));
    expect(perf.total.cash).toBe(events.filter((e) => e.type === "CASH_COLLECTED").reduce((s, e) => s + (e.amount ?? 0), 0));
    const zone = perf.zones.find((z) => z.key === (f1.zoneId ?? "none"))!;
    expect(zone.delivered).toBe(count("DELIVERED", f1.zoneId));
    expect(zone.failed).toBe(count("FAILED", f1.zoneId));
    expect(perf.riders.reduce((s, r) => s + r.delivered, 0)).toBe(perf.total.delivered);
    expect(perf.zones.reduce((s, r) => s + r.failed, 0)).toBe(perf.total.failed);
  });
});
