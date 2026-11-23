import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveSettings } from "@/lib/settings";
import { createUserWithPassword } from "@/server/seed";
import { placeCartOrder } from "@/server/orders";
import { bearerFor, call, idem } from "../api-helpers";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";
import * as riderRoutes from "@/app/api/v1/rider/routes/route";
import * as riderRoute from "@/app/api/v1/rider/routes/[id]/route";
import * as riderDays from "@/app/api/v1/rider/days/route";
import * as riderFinish from "@/app/api/v1/rider/routes/[id]/finish/route";
import * as deliver from "@/app/api/v1/rider/stops/[orderId]/deliver/route";
import * as failStop from "@/app/api/v1/rider/stops/[orderId]/fail/route";
import * as kitchens from "@/app/api/v1/kitchen/kitchens/route";
import * as production from "@/app/api/v1/kitchen/production/route";
import * as start from "@/app/api/v1/kitchen/orders/start/route";
import * as packBulk from "@/app/api/v1/kitchen/orders/pack/route";
import * as packOne from "@/app/api/v1/kitchen/orders/[id]/pack/route";
import * as batches from "@/app/api/v1/kitchen/batches/route";
import * as planBatches from "@/app/api/v1/kitchen/batches/plan/route";
import * as advance from "@/app/api/v1/kitchen/batches/[id]/advance/route";
import * as qc from "@/app/api/v1/kitchen/qc/route";
import * as stockAlerts from "@/app/api/v1/kitchen/stock-alerts/route";
import * as board from "@/app/api/v1/dispatch/board/route";
import * as routes from "@/app/api/v1/dispatch/routes/route";
import * as routeOrders from "@/app/api/v1/dispatch/routes/[id]/orders/route";
import * as routeRider from "@/app/api/v1/dispatch/routes/[id]/rider/route";
import * as routeStart from "@/app/api/v1/dispatch/routes/[id]/start/route";
import * as unassign from "@/app/api/v1/dispatch/orders/[orderId]/assignment/route";
import * as autoGroup from "@/app/api/v1/dispatch/auto-group/route";
import * as failed from "@/app/api/v1/dispatch/failed/route";
import * as resolve from "@/app/api/v1/dispatch/failed/[orderId]/resolve/route";

/** Phase 3: rider / kitchen / dispatcher endpoints of /api/v1 (handlers called directly with bearer tokens). */

const PW = "demo-pass-123";
const B = "customer.b@demo.dabbabela.local";
const tag = `apiops${Date.now().toString(36)}`;

let kitchenId: string;
let date: string;
const tokens: Record<string, string> = {};
let orders: { id: string; customerShare: number }[] = [];
let routeId: string;
let rider1Id: string;
let rider2Id: string;

async function cashOrder(d: string) {
  const user = await loadUser(B);
  const box = await primaryBoxOn(d);
  const res = await placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: user.addresses[0].id, method: "CASH" });
  return res.orders[0]!;
}

beforeAll(async () => {
  await saveSettings({ flags: { deliveryOtp: true, deliveryPhoto: false } as never });
  const b = await loadUser(B);
  kitchenId = b.addresses[0]!.zone!.kitchenId;
  date = serviceDay(3, 1);
  const k2 = await db.kitchen.create({ data: { name: "API ops other kitchen", code: `${tag}-K2`.toUpperCase().slice(0, 20) } });
  const scopedChef = await createUserWithPassword(db, { name: "Scoped Chef", email: `${tag}.chef2@test.local`, password: PW, role: "KITCHEN_STAFF" });
  const scopedDisp = await createUserWithPassword(db, { name: "Scoped Dispatcher", email: `${tag}.disp2@test.local`, password: PW, role: "DISPATCHER" });
  await db.user.updateMany({ where: { id: { in: [scopedChef.id, scopedDisp.id] } }, data: { kitchenId: k2.id } });
  const r2 = await createUserWithPassword(db, { name: "Rider Two", email: `${tag}.rider2@test.local`, password: PW, role: "DELIVERY_AGENT" });
  rider2Id = r2.id;
  rider1Id = (await db.user.findUniqueOrThrow({ where: { email: "rider@demo.dabbabela.local" } })).id;
  for (const [k, email] of Object.entries({
    customer: "customer.a@demo.dabbabela.local",
    chef: "chef@demo.dabbabela.local",
    dispatcher: "dispatch@demo.dabbabela.local",
    rider: "rider@demo.dabbabela.local",
    rider2: `${tag}.rider2@test.local`,
    chef2: `${tag}.chef2@test.local`,
    disp2: `${tag}.disp2@test.local`,
  }))
    tokens[k] = await bearerFor(email, PW);
  orders = [];
  for (let i = 0; i < 3; i++) orders.push(await cashOrder(date));
});

describe("permission denial per role", () => {
  it("customer can't use rider / kitchen / dispatch", async () => {
    const t = tokens.customer;
    expect((await call(riderRoutes.GET, "GET", "/rider/routes", { token: t })).status).toBe(403);
    expect((await call(production.GET, "GET", "/kitchen/production", { token: t })).status).toBe(403);
    expect((await call(board.GET, "GET", "/dispatch/board", { token: t })).status).toBe(403);
    const r = await call(start.POST, "POST", "/kitchen/orders/start", { token: t, body: { orderIds: [orders[0]!.id] } });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe("FORBIDDEN");
  });

  it("rider can't do kitchen or dispatch writes; chef can't dispatch; dispatcher can't cook", async () => {
    expect((await call(start.POST, "POST", "/kitchen/orders/start", { token: tokens.rider, body: { orderIds: [orders[0]!.id] } })).status).toBe(403);
    expect((await call(routes.POST, "POST", "/dispatch/routes", { token: tokens.rider, body: { kitchenId, date, name: "x" } })).status).toBe(403);
    expect((await call(board.GET, "GET", "/dispatch/board", { token: tokens.chef })).status).toBe(403);
    expect((await call(routes.POST, "POST", "/dispatch/routes", { token: tokens.chef, body: { kitchenId, date, name: "x" } })).status).toBe(403);
    expect((await call(packOne.POST, "POST", `/kitchen/orders/${orders[0]!.id}/pack`, { token: tokens.dispatcher, params: { id: orders[0]!.id }, body: { itemsOk: true, labelOk: true, allergenOk: true, sealedOk: true } })).status).toBe(403);
  });

  it("no token → 401 everywhere", async () => {
    expect((await call(riderRoutes.GET, "GET", "/rider/routes")).status).toBe(401);
    expect((await call(kitchens.GET, "GET", "/kitchen/kitchens")).status).toBe(401);
    expect((await call(failed.GET, "GET", "/dispatch/failed")).status).toBe(401);
  });
});

describe("kitchen", () => {
  it("lists kitchens in scope and the production list", async () => {
    const ks = await call(kitchens.GET, "GET", "/kitchen/kitchens", { token: tokens.chef2 });
    expect(ks.body.data).toHaveLength(1);
    expect(ks.body.data[0].id).not.toBe(kitchenId);
    const p = await call(production.GET, "GET", "/kitchen/production", { token: tokens.chef, query: { kitchenId, date } });
    expect(p.status).toBe(200);
    expect(p.body.data.orders.map((o: { id: string }) => o.id)).toEqual(expect.arrayContaining(orders.map((o) => o.id)));
    // another kitchen's production list → 404 for a scoped chef
    expect((await call(production.GET, "GET", "/kitchen/production", { token: tokens.chef2, query: { kitchenId, date } })).status).toBe(404);
  });

  it("bulk start + bulk pack; out-of-scope orders are rejected / 404", async () => {
    const ids = orders.map((o) => o.id);
    const scoped = await call(start.POST, "POST", "/kitchen/orders/start", { token: tokens.chef2, body: { orderIds: ids } });
    expect(scoped.status).toBe(200);
    expect(scoped.body.data.changed).toEqual([]);
    expect(scoped.body.data.rejected.map((r: { id: string }) => r.id).sort()).toEqual([...ids].sort());
    const s = await call(start.POST, "POST", "/kitchen/orders/start", { token: tokens.chef, body: { orderIds: ids } });
    expect(s.body.data.changed.sort()).toEqual([...ids].sort());
    expect(await db.order.count({ where: { id: { in: ids }, status: "PREPARING" } })).toBe(3);

    const one = await call(packOne.POST, "POST", `/kitchen/orders/${ids[0]}/pack`, { token: tokens.chef2, params: { id: ids[0]! }, body: { itemsOk: true, labelOk: true, allergenOk: true, sealedOk: true } });
    expect(one.status).toBe(404);
    const failCheck = await call(packOne.POST, "POST", `/kitchen/orders/${ids[0]}/pack`, { token: tokens.chef, params: { id: ids[0]! }, body: { itemsOk: true, labelOk: true, allergenOk: false, sealedOk: true } });
    expect(failCheck.body.data.packed).toBe(false);
    const all = { itemsOk: true, labelOk: true, allergenOk: true, sealedOk: true };
    const bulk = await call(packBulk.POST, "POST", "/kitchen/orders/pack", { token: tokens.chef, body: { orders: [...ids.map((orderId) => ({ orderId, ...all })), { orderId: "nope-not-real", ...all }] } });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.packed).toBe(3);
    expect(bulk.body.data.results.find((r: { orderId: string }) => r.orderId === "nope-not-real").packed).toBe(false);
    expect(await db.order.count({ where: { id: { in: ids }, status: "PACKED" } })).toBe(3);
  });

  it("batches, QC and stock alerts", async () => {
    const plan = await call(planBatches.POST, "POST", "/kitchen/batches/plan", { token: tokens.chef, body: { kitchenId, date, bufferPct: 5 } });
    expect(plan.status).toBe(200);
    const list = await call(batches.GET, "GET", "/kitchen/batches", { token: tokens.chef, query: { kitchenId, date } });
    expect(list.body.data.batches.length).toBeGreaterThan(0);
    const b = list.body.data.batches[0];
    expect((await call(advance.POST, "POST", `/kitchen/batches/${b.id}/advance`, { token: tokens.chef2, params: { id: b.id }, body: { to: "COOKING" } })).status).toBe(404);
    const cook = await call(advance.POST, "POST", `/kitchen/batches/${b.id}/advance`, { token: tokens.chef, params: { id: b.id }, body: { to: "COOKING", assignedTo: "Ram" } });
    expect(cook.body.data.status).toBe("COOKING");
    const bad = await call(qc.POST, "POST", "/kitchen/qc", { token: tokens.chef, body: { kitchenId, date, type: "TEMPERATURE", result: "FAIL" } });
    expect(bad.status).toBe(422);
    expect(bad.body.error?.fields).toHaveProperty("note");
    const good = await call(qc.POST, "POST", "/kitchen/qc", { token: tokens.chef, body: { kitchenId, date, type: "TEMPERATURE", result: "PASS", value: "74°C", batchId: b.id } });
    expect(good.status).toBe(201);
    expect((await call(qc.GET, "GET", "/kitchen/qc", { token: tokens.chef, query: { kitchenId, date } })).body.data.checks.length).toBeGreaterThan(0);
    const al = await call(stockAlerts.GET, "GET", "/kitchen/stock-alerts", { token: tokens.chef, query: { kitchenId } });
    expect(al.status).toBe(200);
    expect(Array.isArray(al.body.data.alerts)).toBe(true);
  });
});

describe("dispatcher", () => {
  it("creates a route with stops, assigns + reassigns a rider, dispatches it", async () => {
    const ids = orders.map((o) => o.id);
    const c = await call(routes.POST, "POST", "/dispatch/routes", { token: tokens.dispatcher, body: { kitchenId, date, name: `${tag} route`, orderIds: ids } });
    expect(c.status).toBe(201);
    expect(c.body.data.stops).toBe(3);
    routeId = c.body.data.id;
    // scoped dispatcher of another kitchen: 404 on the board and the route
    expect((await call(board.GET, "GET", "/dispatch/board", { token: tokens.disp2, query: { kitchenId, date } })).status).toBe(404);
    expect((await call(routeRider.PUT, "PUT", `/dispatch/routes/${routeId}/rider`, { token: tokens.disp2, params: { id: routeId }, body: { riderId: rider1Id } })).status).toBe(404);
    expect((await call(routes.POST, "POST", "/dispatch/routes", { token: tokens.disp2, body: { kitchenId, date, name: "nope" } })).status).toBe(404);

    const a1 = await call(routeRider.PUT, "PUT", `/dispatch/routes/${routeId}/rider`, { token: tokens.dispatcher, params: { id: routeId }, body: { riderId: rider2Id } });
    expect(a1.body.data.changed).toBe(true);
    const a2 = await call(routeRider.PUT, "PUT", `/dispatch/routes/${routeId}/rider`, { token: tokens.dispatcher, params: { id: routeId }, body: { riderId: rider1Id } });
    expect(a2.body.data.changed).toBe(true);
    expect(await db.auditLog.count({ where: { action: "dispatch.reassign_rider", entityId: routeId } })).toBe(2);

    // unassign + re-add a stop
    expect((await call(unassign.DELETE, "DELETE", `/dispatch/orders/${ids[2]}/assignment`, { token: tokens.dispatcher, params: { orderId: ids[2]! } })).body.data.removedFrom).toBe(routeId);
    expect((await call(routeOrders.POST, "POST", `/dispatch/routes/${routeId}/orders`, { token: tokens.dispatcher, params: { id: routeId }, body: { orderIds: [ids[2]] } })).body.data.added).toBe(1);

    const bd = await call(board.GET, "GET", "/dispatch/board", { token: tokens.dispatcher, query: { kitchenId, date } });
    expect(bd.status).toBe(200);
    const mine = bd.body.data.routes.find((r: { id: string }) => r.id === routeId);
    expect(mine.stops).toHaveLength(3);
    expect(mine.rider.id).toBe(rider1Id);

    const st = await call(routeStart.POST, "POST", `/dispatch/routes/${routeId}/start`, { token: tokens.dispatcher, params: { id: routeId } });
    expect(st.status).toBe(200);
    expect(st.body.data.out).toBe(3);
    expect(await db.order.count({ where: { id: { in: ids }, status: "OUT_FOR_DELIVERY" } })).toBe(3);
  });

  it("auto-group answers for an empty day", async () => {
    const r = await call(autoGroup.POST, "POST", "/dispatch/auto-group", { token: tokens.dispatcher, body: { kitchenId, date: serviceDay(300, 0) } }); // far ahead: other files book orders ~40 days out
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ routes: 0, stops: 0 });
  });
});

describe("rider", () => {
  it("sees only own routes; another rider's route is 404; no hand-off code is exposed", async () => {
    const mine = await call(riderRoutes.GET, "GET", "/rider/routes", { token: tokens.rider, query: { date } });
    expect(mine.status).toBe(200);
    expect(mine.body.data.routes.some((r: { id: string }) => r.id === routeId)).toBe(true);
    const theirs = await call(riderRoutes.GET, "GET", "/rider/routes", { token: tokens.rider2, query: { date } });
    expect(theirs.body.data.routes.some((r: { id: string }) => r.id === routeId)).toBe(false);
    expect((await call(riderRoute.GET, "GET", `/rider/routes/${routeId}`, { token: tokens.rider2, params: { id: routeId } })).status).toBe(404);
    const d = await call(riderRoute.GET, "GET", `/rider/routes/${routeId}`, { token: tokens.rider, params: { id: routeId } });
    expect(d.status).toBe(200);
    expect(d.body.data.stops).toHaveLength(3);
    expect(d.body.data.requires.otp).toBe(true);
    expect(d.body.data.stops[0].cashDue).toBeGreaterThan(0);
    const otps = (await db.order.findMany({ where: { id: { in: orders.map((o) => o.id) } }, select: { deliveryOtp: true } })).map((o) => o.deliveryOtp!);
    const raw = JSON.stringify(d.body);
    expect(raw).not.toContain("deliveryOtp");
    for (const otp of otps) expect(raw).not.toContain(`"${otp}"`);
    expect((await call(riderDays.GET, "GET", "/rider/days", { token: tokens.rider })).body.data.days.some((x: { date: string }) => x.date === date)).toBe(true);
  });

  it("delivers with the customer's code + cash; wrong code is refused; idempotent replay", async () => {
    const o = await db.order.findUniqueOrThrow({ where: { id: orders[0]!.id } });
    const wrong = o.deliveryOtp === "0000" ? "1111" : "0000";
    const bad = await call(deliver.POST, "POST", `/rider/stops/${o.id}/deliver`, { token: tokens.rider, params: { orderId: o.id }, idem: idem("bad"), body: { otp: wrong, cash: o.customerShare } });
    expect(bad.status).toBe(422);
    expect(bad.body.error?.code).toBe("DISPATCH_REJECTED");
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("OUT_FOR_DELIVERY");
    // money-moving: Idempotency-Key required
    const noKey = await call(deliver.POST, "POST", `/rider/stops/${o.id}/deliver`, { token: tokens.rider, params: { orderId: o.id }, body: { otp: o.deliveryOtp, cash: o.customerShare } });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error?.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    // another rider can't deliver it
    expect((await call(deliver.POST, "POST", `/rider/stops/${o.id}/deliver`, { token: tokens.rider2, params: { orderId: o.id }, idem: idem(), body: { otp: o.deliveryOtp, cash: o.customerShare } })).status).toBe(404);

    const key = idem("deliver");
    const body = { otp: o.deliveryOtp, cash: o.customerShare, note: "Left at reception" };
    const ok = await call(deliver.POST, "POST", `/rider/stops/${o.id}/deliver`, { token: tokens.rider, params: { orderId: o.id }, idem: key, body });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID" });
    const replay = await call(deliver.POST, "POST", `/rider/stops/${o.id}/deliver`, { token: tokens.rider, params: { orderId: o.id }, idem: key, body });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect((await db.deliveryRoute.findUniqueOrThrow({ where: { id: routeId } })).cashCollected).toBe(o.customerShare);
    expect(await db.deliveryEvent.count({ where: { orderId: o.id, type: "DELIVERED" } })).toBe(1);
  });

  it("failed delivery with a reason; dispatcher retries it; finish needs every stop closed", async () => {
    const o2 = orders[1]!.id;
    expect((await call(failStop.POST, "POST", `/rider/stops/${o2}/fail`, { token: tokens.rider2, params: { orderId: o2 }, body: { reason: "Office/shop closed" } })).status).toBe(404);
    const noReason = await call(failStop.POST, "POST", `/rider/stops/${o2}/fail`, { token: tokens.rider, params: { orderId: o2 }, body: { reason: "Other" } });
    expect(noReason.status).toBe(422);
    const f = await call(failStop.POST, "POST", `/rider/stops/${o2}/fail`, { token: tokens.rider, params: { orderId: o2 }, body: { reason: "Office/shop closed", detail: "Shutter down" } });
    expect(f.body.data.status).toBe("FAILED_DELIVERY");

    const list = await call(failed.GET, "GET", "/dispatch/failed", { token: tokens.dispatcher, query: { kitchenId, date } });
    expect(list.body.data.failed.find((x: { orderId: string }) => x.orderId === o2).reason).toMatch(/Office\/shop closed/);
    expect((await call(resolve.POST, "POST", `/dispatch/failed/${o2}/resolve`, { token: tokens.disp2, params: { orderId: o2 }, idem: idem(), body: { action: "RETRY", reason: "Customer back at 2pm" } })).status).toBe(404);
    const r = await call(resolve.POST, "POST", `/dispatch/failed/${o2}/resolve`, { token: tokens.dispatcher, params: { orderId: o2 }, idem: idem("res"), body: { action: "RETRY", reason: "Customer back at 2pm" } });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("OUT_FOR_DELIVERY");
    expect(await db.auditLog.count({ where: { action: "dispatch.failed_retry", entityId: o2 } })).toBe(1);

    const early = await call(riderFinish.POST, "POST", `/rider/routes/${routeId}/finish`, { token: tokens.rider, params: { id: routeId } });
    expect(early.status).toBe(422);
    const f2 = await db.order.findUniqueOrThrow({ where: { id: o2 } });
    expect((await call(deliver.POST, "POST", `/rider/stops/${o2}/deliver`, { token: tokens.rider, params: { orderId: o2 }, idem: idem(), body: { otp: f2.deliveryOtp, cash: f2.customerShare } })).status).toBe(200);
    // multipart form (the photo path) works too
    const f3 = await db.order.findUniqueOrThrow({ where: { id: orders[2]!.id } });
    const fd = new FormData();
    fd.set("otp", f3.deliveryOtp!);
    fd.set("cash", String(f3.customerShare));
    const mp = await call(deliver.POST, "POST", `/rider/stops/${f3.id}/deliver`, { token: tokens.rider, params: { orderId: f3.id }, idem: idem(), form: fd });
    expect(mp.status).toBe(200);
    expect(mp.body.data.status).toBe("DELIVERED");
    expect((await call(riderFinish.POST, "POST", `/rider/routes/${routeId}/finish`, { token: tokens.rider2, params: { id: routeId } })).status).toBe(404);
    const done = await call(riderFinish.POST, "POST", `/rider/routes/${routeId}/finish`, { token: tokens.rider, params: { id: routeId } });
    expect(done.body.data.status).toBe("DONE");
  });
});
