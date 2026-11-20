import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveSettings } from "@/lib/settings";
import { bearerFor, call, idem } from "../api-helpers";
import { primaryBoxOn, serviceDay } from "../helpers";
import * as addresses from "@/app/api/v1/addresses/route";
import * as addressById from "@/app/api/v1/addresses/[id]/route";
import * as addressDefault from "@/app/api/v1/addresses/[id]/default/route";
import * as cartQuote from "@/app/api/v1/cart/quote/route";
import * as orders from "@/app/api/v1/orders/route";
import * as orderById from "@/app/api/v1/orders/[id]/route";
import * as orderTimeline from "@/app/api/v1/orders/[id]/timeline/route";
import * as orderCancel from "@/app/api/v1/orders/[id]/cancel/route";
import * as orderSkip from "@/app/api/v1/orders/[id]/skip/route";
import * as orderFeedback from "@/app/api/v1/orders/[id]/feedback/route";
import * as payments from "@/app/api/v1/payments/route";
import * as paymentById from "@/app/api/v1/payments/[id]/route";
import * as paymentStart from "@/app/api/v1/payments/[id]/start/route";
import * as paymentMethod from "@/app/api/v1/payments/[id]/method/route";
import * as subsQuote from "@/app/api/v1/subscriptions/quote/route";
import * as subs from "@/app/api/v1/subscriptions/route";
import * as subById from "@/app/api/v1/subscriptions/[id]/route";
import * as subPause from "@/app/api/v1/subscriptions/[id]/pause/route";
import * as subResume from "@/app/api/v1/subscriptions/[id]/resume/route";
import * as wallet from "@/app/api/v1/wallet/route";
import * as ledger from "@/app/api/v1/wallet/ledger/route";
import * as topups from "@/app/api/v1/wallet/topups/route";
import * as notifications from "@/app/api/v1/notifications/route";
import * as notificationsRead from "@/app/api/v1/notifications/read/route";
import * as tickets from "@/app/api/v1/support/tickets/route";
import * as ticketById from "@/app/api/v1/support/tickets/[id]/route";
import * as ticketMessages from "@/app/api/v1/support/tickets/[id]/messages/route";
import * as profile from "@/app/api/v1/profile/route";
import * as prefs from "@/app/api/v1/profile/preferences/route";
import * as notifPrefs from "@/app/api/v1/profile/notification-preferences/route";
import * as privacyExport from "@/app/api/v1/privacy/export/route";
import * as deletion from "@/app/api/v1/privacy/deletion-request/route";
import * as referrals from "@/app/api/v1/referrals/route";

/** Phase 3: customer endpoints of the mobile API — own records only, IDOR → 404, idempotent money moves. */

const B = "customer.b@demo.dabbabela.local";
const C = "customer.c@demo.dabbabela.local";
let tB: string;
let tC: string;
let bAddressId: string;

beforeAll(async () => {
  await saveSettings({ bankDetails: "Test bank · A/C 000" });
  tB = await bearerFor(B, "demo-pass-123");
  tC = await bearerFor(C, "demo-pass-123");
  const u = await db.user.findUniqueOrThrow({ where: { email: B }, include: { addresses: { where: { archivedAt: null, zoneId: { not: null } }, orderBy: { createdAt: "asc" } } } });
  bAddressId = u.addresses[0]!.id;
});

const addressBody = { label: "Api office", type: "OFFICE", recipientName: "Api Person", phone: "9801234567", line1: "Tinkune road, 2nd floor", area: "New Baneshwor", city: "Kathmandu" };

describe("addresses", () => {
  it("create links the zone; list; partial update; default; archive; IDOR → 404", async () => {
    const r = await call(addresses.POST, "POST", "/addresses", { token: tB, body: addressBody });
    expect(r.status).toBe(201);
    expect(r.body.data.covered).toBe(true);
    expect(r.body.data.address.zone?.name).toBeTruthy();
    const id = r.body.data.address.id as string;

    const list = await call(addresses.GET, "GET", "/addresses", { token: tB });
    expect(list.body.data.map((a: { id: string }) => a.id)).toContain(id);

    const up = await call(addressById.PATCH, "PATCH", `/addresses/${id}`, { token: tB, params: { id }, body: { label: "Api office 2" } });
    expect(up.status).toBe(200);
    expect(up.body.data.address.label).toBe("Api office 2");
    expect(up.body.data.address.line1).toBe(addressBody.line1);

    // C can't touch B's address
    expect((await call(addressById.PATCH, "PATCH", `/addresses/${id}`, { token: tC, params: { id }, body: { label: "Hacked" } })).status).toBe(404);
    expect((await call(addressById.DELETE, "DELETE", `/addresses/${id}`, { token: tC, params: { id } })).status).toBe(404);
    expect((await call(addressDefault.POST, "POST", `/addresses/${id}/default`, { token: tC, params: { id } })).status).toBe(404);
    expect((await db.address.findUniqueOrThrow({ where: { id } })).label).toBe("Api office 2");

    expect((await call(addressDefault.POST, "POST", `/addresses/${id}/default`, { token: tB, params: { id } })).status).toBe(200);
    expect((await db.address.findUniqueOrThrow({ where: { id } })).isDefault).toBe(true);
    // restore the seed default so other flows keep their address
    await call(addressDefault.POST, "POST", `/addresses/${bAddressId}/default`, { token: tB, params: { id: bAddressId } });

    expect((await call(addressById.DELETE, "DELETE", `/addresses/${id}`, { token: tB, params: { id } })).status).toBe(200);
    expect((await db.address.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
  });

  it("validation errors carry fields; an uncovered area saves with covered=false", async () => {
    const bad = await call(addresses.POST, "POST", "/addresses", { token: tB, body: { ...addressBody, phone: "123" } });
    expect(bad.status).toBe(422);
    expect(bad.body.error?.fields).toHaveProperty("phone");
    const far = await call(addresses.POST, "POST", "/addresses", { token: tB, body: { ...addressBody, area: "Biratnagar", city: "Biratnagar" } });
    expect(far.status).toBe(201);
    expect(far.body.data.covered).toBe(false);
    await call(addressById.DELETE, "DELETE", `/addresses/${far.body.data.address.id}`, { token: tB, params: { id: far.body.data.address.id } });
  });
});

describe("cart + idempotent order placement", () => {
  it("quotes on the server", async () => {
    const d = serviceDay(5, 0);
    const box = await primaryBoxOn(d);
    const r = await call(cartQuote.POST, "POST", "/cart/quote", { token: tB, body: { lines: [{ kind: "box", id: box.id, date: d, qty: 2 }], addressId: bAddressId } });
    expect(r.status).toBe(200);
    expect(r.body.data.ok).toBe(true);
    expect(r.body.data.total).toBeGreaterThan(0);
    expect(Number.isInteger(r.body.data.total)).toBe(true);
    expect(r.body.data.lines[0].qty).toBe(2);
  });

  it("same key → same payment (replayed); different body → 422; no key → 400; another customer's key never returns B's payment", async () => {
    const d = serviceDay(5, 1);
    const box = await primaryBoxOn(d);
    const body = { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: bAddressId, method: "CASH" };

    const noKey = await call(orders.POST, "POST", "/orders", { token: tB, body });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error?.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const key = idem("order");
    const first = await call(orders.POST, "POST", "/orders", { token: tB, body, idem: key });
    expect(first.status).toBe(201);
    expect(first.body.data.next).toBe("DONE"); // cash on delivery
    const paymentId = first.body.data.payment.id as string;
    expect(first.body.data.orders).toHaveLength(1);

    const again = await call(orders.POST, "POST", "/orders", { token: tB, body, idem: key });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body.data.payment.id).toBe(paymentId);
    expect(await db.order.count({ where: { paymentId } })).toBe(1);

    const reused = await call(orders.POST, "POST", "/orders", { token: tB, body: { ...body, lines: [{ ...body.lines[0], qty: 2 }] }, idem: key });
    expect(reused.status).toBe(422);
    expect(reused.body.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const cAddr = (await db.address.findFirstOrThrow({ where: { user: { email: C }, archivedAt: null } })).id;
    const stolen = await call(orders.POST, "POST", "/orders", { token: tC, body: { ...body, addressId: cAddr }, idem: key });
    expect(stolen.status).toBe(422);
    expect(JSON.stringify(stolen.body)).not.toContain(paymentId);
  });
});

describe("orders: list, detail, timeline, cancel, IDOR", () => {
  let orderId: string;
  let paymentId: string;
  beforeAll(async () => {
    const d = serviceDay(5, 2);
    const box = await primaryBoxOn(d);
    const r = await call(orders.POST, "POST", "/orders", { token: tB, idem: idem("o2"), body: { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: bAddressId, method: "ESEWA" } });
    expect(r.status).toBe(201);
    orderId = r.body.data.orders[0].id;
    paymentId = r.body.data.payment.id;
    expect(r.body.data.next).toBe("PAY");
  });

  it("lists with cursor pagination and shows detail + timeline", async () => {
    const page1 = await call(orders.GET, "GET", "/orders", { token: tB, query: { scope: "upcoming", limit: 1 } });
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(1);
    expect(page1.body.meta.nextCursor).toBeTruthy();
    const page2 = await call(orders.GET, "GET", "/orders", { token: tB, query: { scope: "upcoming", limit: 1, cursor: page1.body.meta.nextCursor } });
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);

    const det = await call(orderById.GET, "GET", `/orders/${orderId}`, { token: tB, params: { id: orderId } });
    expect(det.status).toBe(200);
    expect(det.body.data.deliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(det.body.data.actions.cancel).toBe(true);
    expect(det.body.data.actions.pay).toBe(true);
    expect(det.body.data.deliveryOtp).toBeNull();
    expect(det.body.data).not.toHaveProperty("kitchenNote");

    const tl = await call(orderTimeline.GET, "GET", `/orders/${orderId}/timeline`, { token: tB, params: { id: orderId } });
    expect(tl.body.data.events.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(tl.body.data)).not.toContain("actorId");
  });

  it("another customer gets 404 on detail, timeline, cancel, skip, feedback, payment detail/start/method", async () => {
    const p = { id: orderId };
    expect((await call(orderById.GET, "GET", `/orders/${orderId}`, { token: tC, params: p })).status).toBe(404);
    expect((await call(orderTimeline.GET, "GET", `/orders/${orderId}/timeline`, { token: tC, params: p })).status).toBe(404);
    expect((await call(orderCancel.POST, "POST", `/orders/${orderId}/cancel`, { token: tC, params: p, idem: idem("x") })).status).toBe(404);
    expect((await call(orderSkip.POST, "POST", `/orders/${orderId}/skip`, { token: tC, params: p, idem: idem("x") })).status).toBe(404);
    expect((await call(orderFeedback.POST, "POST", `/orders/${orderId}/feedback`, { token: tC, params: p, body: { rating: 1 } })).status).toBe(404);
    const pp = { id: paymentId };
    expect((await call(paymentById.GET, "GET", `/payments/${paymentId}`, { token: tC, params: pp })).status).toBe(404);
    expect((await call(paymentStart.POST, "POST", `/payments/${paymentId}/start`, { token: tC, params: pp })).status).toBe(404);
    expect((await call(paymentMethod.POST, "POST", `/payments/${paymentId}/method`, { token: tC, params: pp, idem: idem("x"), body: { method: "CASH" } })).status).toBe(404);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).not.toBe("CANCELLED");
  });

  it("payment detail + eSewa start returns a form to post in the in-app browser", async () => {
    const det = await call(paymentById.GET, "GET", `/payments/${paymentId}`, { token: tB, params: { id: paymentId } });
    expect(det.status).toBe(200);
    expect(det.body.data.status).toBe("PENDING");
    expect(det.body.data.switchableMethods).toContain("CASH");
    const s = await call(paymentStart.POST, "POST", `/payments/${paymentId}/start`, { token: tB, params: { id: paymentId } });
    expect(s.status).toBe(200);
    expect(s.body.data.kind).toBe("esewa");
    expect(s.body.data.method).toBe("POST");
    expect(s.body.data.fields).toHaveProperty("signature");
    expect(s.body.data.returnUrlPrefixes.some((u: string) => u.endsWith("/thank-you/"))).toBe(true);
    const list = await call(payments.GET, "GET", "/payments", { token: tB });
    expect(list.body.data.map((p: { id: string }) => p.id)).toContain(paymentId);
    expect(list.body.meta.totals).toHaveProperty("walletBalance");
  });

  it("customer cancels own order before the cut-off", async () => {
    const r = await call(orderCancel.POST, "POST", `/orders/${orderId}/cancel`, { token: tB, params: { id: orderId }, idem: idem("cancel"), body: { reason: "Plans changed" } });
    expect(r.status).toBe(200);
    expect(r.body.data.settlement).toBe("NONE");
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CANCELLED");
  });
});

describe("wallet", () => {
  it("balance + ledger; top-up refused while the flag is off", async () => {
    const w = await call(wallet.GET, "GET", "/wallet", { token: tB });
    expect(w.status).toBe(200);
    expect(Number.isInteger(w.body.data.balance)).toBe(true);
    expect(w.body.data.topup.enabled).toBe(false);
    const l = await call(ledger.GET, "GET", "/wallet/ledger", { token: tB });
    expect(l.status).toBe(200);
    expect(l.body.meta.balance).toBe(w.body.data.balance);
    const t = await call(topups.POST, "POST", "/wallet/topups", { token: tB, idem: idem("top"), body: { amount: 50000, method: "ESEWA" } });
    expect(t.status).toBe(404);
    expect(t.body.error?.code).toBe("FEATURE_DISABLED");
  });
});

describe("subscriptions", () => {
  it("quote → create (cash, idempotent) → detail → pause → resume; IDOR → 404", async () => {
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "hapta" } });
    const input = { planId: plan.id, startDate: serviceDay(6), days: ["MON", "TUE", "WED"], addressId: bAddressId };
    const q = await call(subsQuote.POST, "POST", "/subscriptions/quote", { token: tB, body: input });
    expect(q.status).toBe(200);
    expect(q.body.data.mealsTotal).toBeGreaterThan(0);

    const key = idem("sub");
    const c1 = await call(subs.POST, "POST", "/subscriptions", { token: tB, idem: key, body: { ...input, method: "CASH" } });
    expect(c1.status).toBe(201);
    const subId = c1.body.data.subscription.id as string;
    const c2 = await call(subs.POST, "POST", "/subscriptions", { token: tB, idem: key, body: { ...input, method: "CASH" } });
    expect(c2.body.data.subscription.id).toBe(subId);
    expect(await db.subscription.count({ where: { id: subId } })).toBe(1);

    const list = await call(subs.GET, "GET", "/subscriptions", { token: tB });
    expect(list.body.data.map((s: { id: string }) => s.id)).toContain(subId);
    const det = await call(subById.GET, "GET", `/subscriptions/${subId}`, { token: tB, params: { id: subId } });
    expect(det.status).toBe(200);
    expect(det.body.data.meals.length).toBe(q.body.data.mealsTotal);
    expect((await call(subById.GET, "GET", `/subscriptions/${subId}`, { token: tC, params: { id: subId } })).status).toBe(404);
    expect((await call(subPause.POST, "POST", `/subscriptions/${subId}/pause`, { token: tC, params: { id: subId } })).status).toBe(404);

    const p = await call(subPause.POST, "POST", `/subscriptions/${subId}/pause`, { token: tB, params: { id: subId }, body: { reason: "Travelling" } });
    expect(p.status).toBe(200);
    expect(p.body.data.paused).toBeGreaterThan(0);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: subId } })).status).toBe("PAUSED");
    const r = await call(subResume.POST, "POST", `/subscriptions/${subId}/resume`, { token: tB, params: { id: subId } });
    expect(r.status).toBe(200);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: subId } })).status).toBe("ACTIVE");
  });
});

describe("notifications", () => {
  it("lists with unread count and marks read (own only)", async () => {
    const u = await db.user.findUniqueOrThrow({ where: { email: B } });
    const n = await db.notification.create({ data: { userId: u.id, type: "test", title: "Api test note" } });
    const l = await call(notifications.GET, "GET", "/notifications", { token: tB });
    expect(l.body.meta.unread).toBeGreaterThanOrEqual(1);
    // C marking B's notification does nothing
    expect((await call(notificationsRead.POST, "POST", "/notifications/read", { token: tC, body: { id: n.id } })).body.data.marked).toBe(0);
    expect((await call(notificationsRead.POST, "POST", "/notifications/read", { token: tB, body: { id: n.id } })).body.data.marked).toBe(1);
    expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).not.toBeNull();
  });
});

describe("support", () => {
  it("create, read, reply; another customer gets 404", async () => {
    const t = await call(tickets.POST, "POST", "/support/tickets", { token: tB, body: { subject: "Late lunch", body: "My dabba came late today", category: "DELIVERY" } });
    expect(t.status).toBe(201);
    const id = t.body.data.id as string;
    expect((await call(tickets.GET, "GET", "/support/tickets", { token: tB })).body.data.map((x: { id: string }) => x.id)).toContain(id);
    const internalAuthor = await db.user.findFirstOrThrow({ where: { role: "SUPPORT" } });
    await db.supportMessage.create({ data: { ticketId: id, authorId: internalAuthor.id, body: "INTERNAL ONLY", internal: true } });
    const det = await call(ticketById.GET, "GET", `/support/tickets/${id}`, { token: tB, params: { id } });
    expect(det.body.data.messages).toHaveLength(1);
    expect(JSON.stringify(det.body)).not.toContain("INTERNAL ONLY");
    expect((await call(ticketMessages.POST, "POST", `/support/tickets/${id}/messages`, { token: tB, params: { id }, body: { body: "Any update?" } })).status).toBe(200);
    expect((await call(ticketById.GET, "GET", `/support/tickets/${id}`, { token: tC, params: { id } })).status).toBe(404);
    expect((await call(ticketMessages.POST, "POST", `/support/tickets/${id}/messages`, { token: tC, params: { id }, body: { body: "hi" } })).status).toBe(404);
  });
});

describe("profile + privacy + referrals", () => {
  it("profile read/update, preferences, notification preferences", async () => {
    const g = await call(profile.GET, "GET", "/profile", { token: tC });
    expect(g.body.data.email).toBe(C);
    const p = await call(profile.PATCH, "PATCH", "/profile", { token: tC, body: { name: "Sample Customer C" } });
    expect(p.status).toBe(200);
    const bad = await call(profile.PATCH, "PATCH", "/profile", { token: tC, body: { phone: "12345" } });
    expect(bad.status).toBe(422);
    expect(bad.body.error?.fields).toHaveProperty("phone");
    const pr = await call(prefs.PATCH, "PATCH", "/profile/preferences", { token: tC, body: { diet: "VEG", spiceTolerance: 1 } });
    expect(pr.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { email: C } })).diet).toBe("VEG");
    const np = await call(notifPrefs.PUT, "PUT", "/profile/notification-preferences", { token: tC, body: { preferences: [{ topic: "ORDER_UPDATES", channel: "IN_APP", enabled: true }] } });
    expect(np.status).toBe(200);
    const sms = np.body.data.preferences.find((x: { topic: string; channel: string }) => x.topic === "ORDER_UPDATES" && x.channel === "SMS");
    expect(sms.enabled).toBe(false);
  });

  it("export returns own data (audited); deletion needs DELETE", async () => {
    const e = await call(privacyExport.GET, "GET", "/privacy/export", { token: tC });
    expect(e.status).toBe(200);
    expect(e.body.data.profile.email).toBe(C);
    const u = await db.user.findUniqueOrThrow({ where: { email: C } });
    expect(await db.auditLog.count({ where: { action: "privacy.export", entityId: u.id } })).toBeGreaterThanOrEqual(1);
    const d = await call(deletion.POST, "POST", "/privacy/deletion-request", { token: tC, body: { confirm: "nope" } });
    expect(d.status).toBe(422);
    expect(d.body.error?.fields).toHaveProperty("confirm");
  });

  it("referrals summary", async () => {
    const r = await call(referrals.GET, "GET", "/referrals", { token: tB });
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveProperty("canClaim");
  });

  it("every customer endpoint needs a session", async () => {
    expect((await call(orders.GET, "GET", "/orders")).status).toBe(401);
    expect((await call(wallet.GET, "GET", "/wallet")).status).toBe(401);
    expect((await call(addresses.POST, "POST", "/addresses", { body: addressBody })).status).toBe(401);
  });
});
