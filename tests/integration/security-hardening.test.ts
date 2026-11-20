import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ip: "10.9.8.7", email: null as string | null, sessionId: "test" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest-security", "x-forwarded-for": state.ip }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  return {
    ...real,
    getCurrentUser: async () => {
      if (!state.email) return null;
      const { db } = await import("@/lib/db");
      const { CURRENT_USER_INCLUDE, toCurrentUser } = await import("@/lib/user-context");
      const u = await db.user.findUniqueOrThrow({ where: { email: state.email }, include: CURRENT_USER_INCLUDE });
      return toCurrentUser(u, state.sessionId);
    },
  };
});

import { db } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/rate-limit";
import { staffSessionExpired, staffSessionMaxHours, staffTwoFactorOk } from "@/lib/auth";
import { forgotAction, loginAction, revokeSessionAction } from "@/lib/actions/auth";
import { contactAction } from "@/lib/actions/public";
import { adminSearchAction } from "@/app/admin/_kit/actions";
import { GET as health } from "@/app/api/health/route";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

const created: string[] = [];
let staff2faBefore: boolean;

function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

beforeAll(async () => {
  staff2faBefore = (await getSettings()).flags.staff2fa;
});

afterEach(() => {
  vi.unstubAllEnvs();
  state.email = null;
  state.sessionId = "test";
});

afterAll(async () => {
  await saveSettings({ flags: { ...(await getSettings()).flags, staff2fa: staff2faBefore } });
  await db.session.deleteMany({ where: { userId: { in: created } } });
  await db.user.deleteMany({ where: { id: { in: created } } });
});

describe("rate limiter", () => {
  it("allows max hits per window, then refuses; a new window resets", async () => {
    const id = `t-${Date.now()}`;
    for (let i = 0; i < 3; i++) expect(await rateLimit("test", id, 3, 60_000)).toBe(true);
    expect(await rateLimit("test", id, 3, 60_000)).toBe(false);
    expect(await rateLimit("test", id, 3, 1)).toBe(true); // window of 1 ms has passed → reset
  });

  it("is atomic under concurrency", async () => {
    const id = `c-${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 10 }, () => rateLimit("test", id, 4, 60_000)));
    expect(results.filter(Boolean)).toHaveLength(4);
  });
});

describe("auth server actions are rate-limited (Better Auth's limiter doesn't see auth.api calls)", () => {
  it("login: per email after 6 attempts, with limits on (production / AUTH_RATE_LIMIT)", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT", "true");
    state.ip = `10.1.${Date.now() % 250}.1`;
    const email = `nobody-${Date.now()}@test.local`;
    for (let i = 0; i < 6; i++) {
      const r = await loginAction({ ok: false }, fd({ email, password: "wrong-password-1" }));
      expect(r.message).not.toMatch(/Too many/);
    }
    expect((await loginAction({ ok: false }, fd({ email, password: "wrong-password-1" }))).message).toMatch(/Too many/);
  });

  it("password reset: 3 per email", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT", "true");
    state.ip = `10.2.${Date.now() % 250}.1`;
    const email = `reset-${Date.now()}@test.local`;
    for (let i = 0; i < 3; i++) expect((await forgotAction({ ok: false }, fd({ email }))).ok).toBe(true);
    expect((await forgotAction({ ok: false }, fd({ email }))).message).toMatch(/Too many/);
  });

  it("limits are off in dev/test so the E2E suite isn't throttled", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT", "");
    const email = `dev-${Date.now()}@test.local`;
    for (let i = 0; i < 8; i++) expect((await loginAction({ ok: false }, fd({ email, password: "wrong-password-1" }))).message).not.toMatch(/Too many/);
  });
});

describe("Turnstile on forms", () => {
  it("rejects a public form without a token when keys are set, accepts when unset", async () => {
    state.ip = `10.3.${Date.now() % 250}.1`;
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site");
    const form = { name: "Ram", email: "ram@example.com", message: "Hello there, a question" };
    expect((await contactAction({ ok: false }, fd(form))).message).toMatch(/security check/);
    expect((await loginAction({ ok: false }, fd({ email: "x@y.co", password: "whatever-123" }))).message).toMatch(/security check/);
    vi.unstubAllEnvs();
    expect((await contactAction({ ok: false }, fd(form))).ok).toBe(true);
  });

  it("health reports turnstile and sentry booleans", async () => {
    const body = await (await health()).json();
    expect(body.integrations.turnstile).toBe(false);
    expect(body.integrations.sentry).toBe(false);
    vi.stubEnv("TURNSTILE_SECRET_KEY", "s");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "k");
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    const on = await (await health()).json();
    expect(on.integrations.turnstile).toBe(true);
    expect(on.integrations.sentry).toBe(true);
  });
});

describe("session hardening", () => {
  it("staff sessions have an absolute lifetime (default 24 h, configurable)", () => {
    expect(staffSessionMaxHours()).toBe(24);
    const now = Date.now();
    expect(staffSessionExpired(new Date(now - 23 * 3600_000), now)).toBe(false);
    expect(staffSessionExpired(new Date(now - 25 * 3600_000), now)).toBe(true);
    vi.stubEnv("STAFF_SESSION_MAX_HOURS", "8");
    expect(staffSessionExpired(new Date(now - 9 * 3600_000), now)).toBe(true);
    vi.stubEnv("STAFF_SESSION_MAX_HOURS", "nonsense");
    expect(staffSessionMaxHours()).toBe(24);
  });

  it("staff 2FA rule also covers the admin kit actions (search returns nothing without 2FA)", async () => {
    vi.stubEnv("DISABLE_STAFF_2FA", "");
    await saveSettings({ flags: { ...(await getSettings()).flags, staff2fa: true } });
    const u = await db.user.create({ data: { name: "No 2FA", email: `no2fa-${Date.now()}@test.local`, role: "OPERATIONS_MANAGER", twoFactorEnabled: false } });
    created.push(u.id);
    expect(await staffTwoFactorOk(u)).toBe(false);
    expect(await staffTwoFactorOk({ role: "CUSTOMER", twoFactorEnabled: false })).toBe(true);
    state.email = u.email;
    expect(await adminSearchAction("DB")).toEqual([]);
    vi.stubEnv("DISABLE_STAFF_2FA", "true");
    expect(await staffTwoFactorOk(u)).toBe(true);
  });

  it("signs out one device by session id (tokens never needed client-side), others, or everywhere", async () => {
    const u = await db.user.create({ data: { name: "Sessions", email: `sessions-${Date.now()}@test.local`, role: "CUSTOMER" } });
    created.push(u.id);
    const exp = new Date(Date.now() + 86400_000);
    const [current, other, third] = await Promise.all(["a", "b", "c"].map((t) => db.session.create({ data: { userId: u.id, token: `tok-${t}-${u.id}`, expiresAt: exp } })));
    const stranger = await db.user.create({ data: { name: "Stranger", email: `stranger-${Date.now()}@test.local` } });
    created.push(stranger.id);
    const foreign = await db.session.create({ data: { userId: stranger.id, token: `tok-x-${stranger.id}`, expiresAt: exp } });
    state.email = u.email;
    state.sessionId = current.id;
    // can't revoke someone else's session (IDOR)
    expect((await revokeSessionAction({ ok: false }, fd({ sessionId: foreign.id }))).ok).toBe(false);
    expect(await db.session.count({ where: { id: foreign.id } })).toBe(1);
    expect((await revokeSessionAction({ ok: false }, fd({ sessionId: other.id }))).ok).toBe(true);
    expect(await db.session.count({ where: { userId: u.id } })).toBe(2);
    expect((await revokeSessionAction({ ok: false }, fd({ all: "1" }))).ok).toBe(true);
    expect((await db.session.findMany({ where: { userId: u.id } })).map((s) => s.id)).toEqual([current.id]);
    void third;
    const r = await revokeSessionAction({ ok: false }, fd({ everywhere: "1" }));
    expect(r.redirectTo).toMatch(/^\/login/);
    expect(await db.session.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: u.id, action: { startsWith: "user.session" } } })).toBe(3);
  });
});

describe("middleware CSP", () => {
  it("sets a per-request nonce CSP on the request (for Next) and the response", () => {
    const res1 = middleware(new NextRequest("http://localhost/menu"));
    const res2 = middleware(new NextRequest("http://localhost/menu"));
    const c1 = res1.headers.get("content-security-policy")!;
    const c2 = res2.headers.get("content-security-policy")!;
    expect(c1).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(c1).not.toBe(c2);
    // forwarded request headers carry the same policy + nonce (Next reads them to nonce its inline scripts)
    expect(res1.headers.get("x-middleware-request-content-security-policy")).toBe(c1);
    const nonce = res1.headers.get("x-middleware-request-x-nonce");
    expect(c1).toContain(`'nonce-${nonce}'`);
    // redirects for protected pages carry it too
    expect(middleware(new NextRequest("http://localhost/admin")).headers.get("content-security-policy")).toMatch(/strict-dynamic/);
  });
});
