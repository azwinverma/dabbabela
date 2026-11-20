import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { db } from "@/lib/db";
import { createUserWithPassword } from "@/server/seed";
import { saveSettings, getSettings } from "@/lib/settings";
import { bearerFor, call } from "../api-helpers";
import * as signIn from "@/app/api/v1/auth/sign-in/route";
import * as signUp from "@/app/api/v1/auth/sign-up/route";
import * as signOut from "@/app/api/v1/auth/sign-out/route";
import * as verify2fa from "@/app/api/v1/auth/two-factor/verify/route";
import * as enable2fa from "@/app/api/v1/auth/two-factor/enable/route";
import * as confirm2fa from "@/app/api/v1/auth/two-factor/confirm/route";
import * as sessions from "@/app/api/v1/auth/sessions/route";
import * as sessionById from "@/app/api/v1/auth/sessions/[id]/route";
import * as me from "@/app/api/v1/me/route";
import * as devices from "@/app/api/v1/devices/route";
import * as forgot from "@/app/api/v1/auth/password/forgot/route";

/** Phase 3: bearer auth for the mobile API (tests call the route handlers directly). */

async function totpFor(userId: string) {
  const { symmetricDecrypt } = await import("better-auth/crypto");
  const row = await db.twoFactor.findFirstOrThrow({ where: { userId } });
  const secret = await symmetricDecrypt({ key: process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || "dev-only-insecure-secret-change-me-0123456789", data: row.secret });
  return createOTP(secret, { digits: 6, period: 30 }).totp();
}

describe("bearer sign-in", () => {
  it("email + password → token that works on /me; cookies are ignored", async () => {
    const token = await bearerFor("customer.b@demo.dabbabela.local", "demo-pass-123");
    const r = await call(me.GET, "GET", "/me", { token });
    expect(r.status).toBe(200);
    expect(r.body.data.user.email).toBe("customer.b@demo.dabbabela.local");
    expect(r.body.data.user.role).toBe("CUSTOMER");
    expect(r.body.data.apps).toEqual({ customer: true, rider: false, kitchen: false, dispatcher: false });
    expect(r.body.data.flags).toHaveProperty("walletTopup");
    // A cookie alone (no bearer) is not a session on /api/v1.
    const cookieOnly = await call(me.GET, "GET", "/me", { headers: { cookie: `dabba.session_token=${encodeURIComponent(token)}` } });
    expect(cookieOnly.status).toBe(401);
    expect(cookieOnly.body.error?.code).toBe("UNAUTHENTICATED");
  });

  it("wrong password → 401 INVALID_CREDENTIALS; malformed token → 401", async () => {
    const r = await call(signIn.POST, "POST", "/auth/sign-in", { body: { email: "customer.b@demo.dabbabela.local", password: "nope-nope-1" } });
    expect(r.status).toBe(401);
    expect(r.body.error?.code).toBe("INVALID_CREDENTIALS");
    expect((await call(me.GET, "GET", "/me", { token: "garbage" })).status).toBe(401);
    expect((await call(me.GET, "GET", "/me", { token: "a.b" })).status).toBe(401);
  });

  it("validation errors use the envelope with fields", async () => {
    const r = await call(signIn.POST, "POST", "/auth/sign-in", { body: { email: "not-an-email" } });
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe("VALIDATION_FAILED");
    expect(r.body.error?.fields).toHaveProperty("email");
  });

  it("refuses cross-origin browser requests", async () => {
    const r = await call(me.GET, "GET", "/me", { headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe("CORS_FORBIDDEN");
  });

  it("sign-out revokes the token", async () => {
    const token = await bearerFor("customer.c@demo.dabbabela.local", "demo-pass-123");
    expect((await call(signOut.POST, "POST", "/auth/sign-out", { token })).status).toBe(200);
    expect((await call(me.GET, "GET", "/me", { token })).status).toBe(401);
  });

  it("password reset request answers the same for unknown emails", async () => {
    const a = await call(forgot.POST, "POST", "/auth/password/forgot", { body: { email: "nobody-here@test.local" } });
    expect(a.status).toBe(200);
    expect(a.body.data.sent).toBe(true);
  });
});

describe("sign-up", () => {
  it("creates a customer and returns a token (201); duplicate phone is refused", async () => {
    const r = await call(signUp.POST, "POST", "/auth/sign-up", { body: { name: "Api Person", email: "api-person@test.local", phone: "9812345670", password: "api-pass-1234" } });
    expect(r.status).toBe(201);
    expect(r.body.data.token).toBeTruthy();
    expect(r.body.data.user.phone).toBe("+9779812345670");
    const m = await call(me.GET, "GET", "/me", { token: r.body.data.token });
    expect(m.body.data.user.role).toBe("CUSTOMER");
    const dup = await call(signUp.POST, "POST", "/auth/sign-up", { body: { name: "Api Two", email: "api-two@test.local", phone: "9812345670", password: "api-pass-1234" } });
    expect(dup.status).toBe(422);
    expect(dup.body.error?.fields).toHaveProperty("phone");
  });
});

describe("sessions + devices", () => {
  it("lists own sessions, revokes others, someone else's session id is 404", async () => {
    const t1 = await bearerFor("customer.d@demo.dabbabela.local", "demo-pass-123");
    const t2 = await bearerFor("customer.d@demo.dabbabela.local", "demo-pass-123");
    const list = await call(sessions.GET, "GET", "/auth/sessions", { token: t1 });
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(t1.split(".")[0]);
    const other = await bearerFor("customer.b@demo.dabbabela.local", "demo-pass-123");
    const otherId = (await call(sessions.GET, "GET", "/auth/sessions", { token: other })).body.data.find((s: { current: boolean }) => s.current).id;
    expect((await call(sessionById.DELETE, "DELETE", `/auth/sessions/${otherId}`, { token: t1, params: { id: otherId } })).status).toBe(404);
    expect((await call(sessions.DELETE, "DELETE", "/auth/sessions", { token: t1 })).body.data.revoked).toBeGreaterThanOrEqual(1);
    expect((await call(me.GET, "GET", "/me", { token: t2 })).status).toBe(401);
    expect((await call(me.GET, "GET", "/me", { token: t1 })).status).toBe(200);
  });

  it("registers, moves and removes push tokens; only own", async () => {
    const a = await bearerFor("customer.b@demo.dabbabela.local", "demo-pass-123");
    const c = await bearerFor("customer.c@demo.dabbabela.local", "demo-pass-123");
    const tok = `fcm-${Date.now()}-abcdefghij`;
    expect((await call(devices.POST, "POST", "/devices", { token: a, body: { token: tok, platform: "ANDROID", appVersion: "1.0.0" } })).status).toBe(200);
    // C can't delete A's token
    expect((await call(devices.DELETE, "DELETE", "/devices", { token: c, body: { token: tok } })).body.data.removed).toBe(0);
    // re-registering on C's sign-in moves it
    await call(devices.POST, "POST", "/devices", { token: c, body: { token: tok, platform: "ANDROID" } });
    const row = await db.deviceToken.findUniqueOrThrow({ where: { token: tok }, include: { user: { select: { email: true } } } });
    expect(row.user.email).toBe("customer.c@demo.dabbabela.local");
    expect((await call(devices.DELETE, "DELETE", "/devices", { token: c, body: { token: tok } })).body.data.removed).toBe(1);
  });
});

describe("staff two-factor", () => {
  const email = "api-2fa-cook@test.local";
  let userId: string;
  beforeAll(async () => {
    const kitchen = await db.kitchen.findFirstOrThrow();
    const u = await createUserWithPassword(db, { name: "Api Cook", email, password: "cook-pass-1234", role: "KITCHEN_STAFF" });
    userId = u.id;
    await db.user.update({ where: { id: userId }, data: { kitchenId: kitchen.id } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("staff without 2FA: signs in, /me says setup required, staff endpoints refuse; enrol → challenge on next sign-in", async () => {
    vi.stubEnv("DISABLE_STAFF_2FA", "false");
    const s = await getSettings();
    if (!s.flags.staff2fa) await saveSettings({ flags: { ...s.flags, staff2fa: true } });
    const token = await bearerFor(email, "cook-pass-1234");
    const m = await call(me.GET, "GET", "/me", { token });
    expect(m.body.data.twoFactor).toMatchObject({ enabled: false, required: true, setupRequired: true });
    expect(m.body.data.apps.kitchen).toBe(false);

    const { GET: production } = await import("@/app/api/v1/kitchen/production/route");
    const denied = await call(production, "GET", "/kitchen/production", { token });
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe("TWO_FACTOR_SETUP_REQUIRED");

    // enrol
    const en = await call(enable2fa.POST, "POST", "/auth/two-factor/enable", { token, body: { password: "cook-pass-1234" } });
    expect(en.status).toBe(200);
    expect(en.body.data.totpURI).toMatch(/^otpauth:\/\//);
    const conf = await call(confirm2fa.POST, "POST", "/auth/two-factor/confirm", { token, body: { code: await totpFor(userId) } });
    expect(conf.status).toBe(200);
    const newToken = conf.body.data.token as string;
    expect(newToken).toBeTruthy();
    const m2 = await call(me.GET, "GET", "/me", { token: newToken });
    expect(m2.body.data.twoFactor.setupRequired).toBe(false);
    expect(m2.body.data.apps.kitchen).toBe(true);
    expect((await call(production, "GET", "/kitchen/production", { token: newToken })).status).toBe(200);

    // next sign-in needs the second step; no token until verified
    const first = await call(signIn.POST, "POST", "/auth/sign-in", { body: { email, password: "cook-pass-1234" } });
    expect(first.status).toBe(200);
    expect(first.body.data.twoFactorRequired).toBe(true);
    expect(first.body.data.token).toBeNull();
    const challengeToken = first.body.data.challengeToken as string;
    const bad = await call(verify2fa.POST, "POST", "/auth/two-factor/verify", { body: { challengeToken, code: "000000" } });
    expect(bad.status).toBe(401);
    const good = await call(verify2fa.POST, "POST", "/auth/two-factor/verify", { body: { challengeToken, code: await totpFor(userId) } });
    expect(good.status).toBe(200);
    expect((await call(me.GET, "GET", "/me", { token: good.body.data.token })).body.data.user.email).toBe(email);
    // the challenge is single-use
    const again = await call(verify2fa.POST, "POST", "/auth/two-factor/verify", { body: { challengeToken, code: await totpFor(userId) } });
    expect(again.status).toBe(401);
  });
});
