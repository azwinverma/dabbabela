import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { importSPKI, jwtVerify } from "jose";
import { db } from "@/lib/db";
import { notify, processOutbox } from "@/server/notify";
import { deliverPush, pushConfigured, resetPushCache } from "@/server/notify/push";
import { notificationTarget } from "@/lib/notification-target";
import { GET as health } from "@/app/api/health/route";

/** Push sending (FCM HTTP v1) through the notify outbox. Every HTTP call is mocked. */

const T = `${Date.now()}`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SA = { type: "service_account", project_id: "dabba-test", client_email: "push@dabba-test.iam.gserviceaccount.com", private_key: privateKey, token_uri: "https://oauth2.googleapis.com/token" };
const saved = process.env.FCM_SERVICE_ACCOUNT_JSON;

type Call = { url: string; body: string; auth: string | null };
let calls: Call[] = [];
/** FCM mock: token endpoint OK; per device token the given status / error code. */
function mockFcm(byToken: Record<string, { status: number; code?: string }> = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = String(init.body ?? "");
      calls.push({ url: String(url), body, auth: new Headers(init.headers).get("authorization") });
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
      const token = (JSON.parse(body) as { message: { token: string } }).message.token;
      const r = byToken[token] ?? { status: 200 };
      if (r.status === 200) return new Response(JSON.stringify({ name: "projects/dabba-test/messages/1" }), { status: 200 });
      return new Response(JSON.stringify({ error: { code: r.status, status: r.code ?? "INTERNAL", details: r.code ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: r.code }] : [] } }), { status: r.status });
    }),
  );
}
const fcmSends = () => calls.filter((c) => c.url.includes("fcm.googleapis.com"));

let seq = 0;
async function userWithDevices(tokens: string[]) {
  seq++;
  const u = await db.user.create({ data: { name: `Push ${seq}`, email: `push-${seq}-${T}@test.local` } });
  for (const t of tokens) await db.deviceToken.create({ data: { userId: u.id, platform: t.includes("ios") ? "IOS" : "ANDROID", token: `${t}-${T}-${seq}` } });
  return u;
}
const pushRows = (userId: string) => db.outboundMessage.findMany({ where: { channel: "PUSH", to: userId }, orderBy: { createdAt: "asc" } });

beforeAll(() => {
  process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
  resetPushCache();
});
// notify() sends right away outside a request (no `after()`), so FCM is always mocked — never a real network call.
beforeEach(() => mockFcm());
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  if (saved === undefined) delete process.env.FCM_SERVICE_ACCOUNT_JSON;
  else process.env.FCM_SERVICE_ACCOUNT_JSON = saved;
  resetPushCache();
});

describe("push channel", () => {
  it("queues one PUSH row, sends to every device with title/body + data {link, target}, removes UNREGISTERED tokens", async () => {
    const u = await userWithDevices(["android-a", "ios-b"]);
    const [a, b] = await db.deviceToken.findMany({ where: { userId: u.id }, orderBy: { token: "asc" } });
    mockFcm({ [b.token]: { status: 404, code: "UNREGISTERED" } });
    await notify("order.delivered", { userId: u.id }, { number: "DB-123" }, { link: "/account/orders/ord_1", dedupeKey: `push-test-del-${T}` });
    const rows = await pushRows(u.id);
    expect(rows).toHaveLength(1);
    await processOutbox({ ids: rows.map((r) => r.id) });
    expect((await db.outboundMessage.findUniqueOrThrow({ where: { id: rows[0].id } })).status).toBe("SENT");
    const sends = fcmSends();
    expect(sends).toHaveLength(2);
    expect(sends[0].url).toBe("https://fcm.googleapis.com/v1/projects/dabba-test/messages:send");
    expect(sends[0].auth).toBe("Bearer ya29.test");
    const msg = JSON.parse(sends.find((s) => s.body.includes(a.token))!.body).message;
    expect(msg.notification).toEqual({ title: "Delivered — enjoy!", body: "Tell us how DB-123 tasted." });
    expect(msg.data).toEqual({ type: "order.delivered", link: "/account/orders/ord_1", targetType: "order", targetId: "ord_1" });
    expect(msg.apns.payload.aps.sound).toBe("default");
    // UNREGISTERED → token deleted, the good one kept.
    expect(await db.deviceToken.findMany({ where: { userId: u.id }, select: { id: true } })).toEqual([{ id: a.id }]);
    // The service-account JWT is RS256, signed by the configured key, for the FCM scope.
    const tokenCall = calls.find((c) => c.url.startsWith("https://oauth2.googleapis.com/token"));
    if (tokenCall) {
      const form = new URLSearchParams(tokenCall.body);
      expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      const { payload } = await jwtVerify(form.get("assertion")!, await importSPKI(publicKey, "RS256"), { audience: SA.token_uri, issuer: SA.client_email });
      expect(payload.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    }
  });

  it("never puts the hand-off code on the lock screen", async () => {
    const u = await userWithDevices(["android-otp"]);
    await notify("order.out_for_delivery", { userId: u.id }, { number: "DB-9", otp: "4821" }, { link: "/account/orders/ord_9" });
    const [row] = await pushRows(u.id);
    expect(row.subject).toBe("Your dabba is on the way");
    expect(row.body).not.toContain("4821");
    // The in-app row (inside the app) still has it.
    expect((await db.notification.findFirstOrThrow({ where: { userId: u.id } })).body).toContain("4821");
  });

  it("respects the IN_APP switch for the topic, skips users without devices and templates without push", async () => {
    const off = await userWithDevices(["android-off"]);
    await db.notificationPreference.create({ data: { userId: off.id, topic: "ORDER_UPDATES", channel: "IN_APP", enabled: false } });
    await notify("order.delivered", { userId: off.id }, { number: "DB-1" });
    expect(await pushRows(off.id)).toHaveLength(0);
    // PLAN_REMINDERS still on for that user.
    await notify("plan.reminder", { userId: off.id }, { plan: "Weekly", date: "2026-12-01" }, { link: "/account/plans/sub_1#renew" });
    const [plan] = await pushRows(off.id);
    expect(JSON.parse(plan.body).data).toMatchObject({ targetType: "plan", targetId: "sub_1" });

    const none = await userWithDevices([]);
    await notify("order.delivered", { userId: none.id }, { number: "DB-2" });
    expect(await pushRows(none.id)).toHaveLength(0);

    const u = await userWithDevices(["android-nopush"]);
    await notify("order.cancelled", { userId: u.id }, { number: "DB-3", reason: "x" });
    expect(await pushRows(u.id)).toHaveLength(0);
  });

  it("approval requests reach staff (SECURITY topic ignores switches); rider route assignment pushes", async () => {
    const staff = await userWithDevices(["android-staff"]);
    await db.user.update({ where: { id: staff.id }, data: { role: "FINANCE" } });
    await db.notificationPreference.create({ data: { userId: staff.id, topic: "SECURITY", channel: "IN_APP", enabled: false } });
    await notify("approval.requested", { userId: staff.id }, { summary: "Refund Rs 3,000", requester: "Asha", reason: "cold" }, { link: "/admin/approvals/apr_1" });
    const [row] = await pushRows(staff.id);
    expect(row).toMatchObject({ subject: "Approval needed", body: expect.stringContaining("Asha: Refund Rs 3,000") });
    expect(JSON.parse(row.body).data).toMatchObject({ targetType: "url", link: "/admin/approvals/apr_1" });

    const { createRoute } = await import("@/server/dispatch");
    const rider = await userWithDevices(["android-rider"]);
    const kitchen = await db.kitchen.findFirstOrThrow({ where: { isActive: true } });
    await db.user.update({ where: { id: rider.id }, data: { role: "DELIVERY_AGENT", kitchenId: kitchen.id } });
    const route = await createRoute({ kitchenId: kitchen.id, date: "2026-12-24", name: `Push route ${T}`, riderId: rider.id });
    await expect.poll(async () => (await pushRows(rider.id)).length).toBe(1);
    const [r] = await pushRows(rider.id);
    expect(r.subject).toBe(`New route: Push route ${T}`);
    expect(JSON.parse(r.body).data.link).toBe(`/rider/route/${route.id}`);
  });

  it("transient FCM errors stay queued for retry; all tokens gone → skipped", async () => {
    const u = await userWithDevices(["android-5xx"]);
    const [d] = await db.deviceToken.findMany({ where: { userId: u.id } });
    mockFcm({ [d.token]: { status: 503, code: "UNAVAILABLE" } });
    await notify("payment.received", { userId: u.id }, { amount: "Rs 100", reference: "PAY-1" }, { link: "/thank-you/pay_1" });
    const [row] = await pushRows(u.id);
    await processOutbox({ ids: [row.id] });
    const after = await db.outboundMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: "QUEUED", attempts: 1 });
    expect(after.lastError).toContain("503");

    mockFcm({ [d.token]: { status: 400, code: "UNREGISTERED" } });
    const r = await deliverPush(u.id, { title: "x", body: "y" });
    expect(r).toMatchObject({ ok: false, skipped: true, removed: 1 });
    expect(await db.deviceToken.count({ where: { userId: u.id } })).toBe(0);
  });

  it("is a no-op without FCM_SERVICE_ACCOUNT_JSON (nothing queued) and /api/health reports push", async () => {
    let res = await health();
    expect((await res.json()).integrations.push).toBe(true);
    const keep = process.env.FCM_SERVICE_ACCOUNT_JSON;
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    resetPushCache();
    try {
      expect(pushConfigured()).toBe(false);
      const u = await userWithDevices(["android-unset"]);
      await notify("order.delivered", { userId: u.id }, { number: "DB-4" });
      expect(await pushRows(u.id)).toHaveLength(0);
      expect(await deliverPush(u.id, { title: "t", body: "b" })).toMatchObject({ skipped: true });
      res = await health();
      expect((await res.json()).integrations.push).toBe(false);
      // Garbage is treated as unset too; base64 of the JSON works.
      process.env.FCM_SERVICE_ACCOUNT_JSON = "not json";
      resetPushCache();
      expect(pushConfigured()).toBe(false);
      process.env.FCM_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify(SA)).toString("base64");
      resetPushCache();
      expect(pushConfigured()).toBe(true);
    } finally {
      process.env.FCM_SERVICE_ACCOUNT_JSON = keep;
      resetPushCache();
    }
  });
});

describe("notification targets", () => {
  it("maps web links to app screens", () => {
    expect(notificationTarget("/account/orders/abc")).toEqual({ type: "order", id: "abc" });
    expect(notificationTarget("/account/plans/sub1#renew")).toEqual({ type: "plan", id: "sub1" });
    expect(notificationTarget("/thank-you/p1")).toEqual({ type: "payment", id: "p1" });
    expect(notificationTarget("/pay/p2?status=failed")).toEqual({ type: "payment", id: "p2" });
    expect(notificationTarget("/account/wallet/topup/p3")).toEqual({ type: "payment", id: "p3" });
    expect(notificationTarget("/account/wallet")).toEqual({ type: "wallet" });
    expect(notificationTarget("/account/support/t1")).toEqual({ type: "ticket", id: "t1" });
    expect(notificationTarget("/admin/approvals/a1")).toEqual({ type: "url" });
    expect(notificationTarget(null)).toBeNull();
  });
});
