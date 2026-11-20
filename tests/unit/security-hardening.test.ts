import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCsp, generateNonce, sentryIngestOrigin } from "@/lib/csp";
import { scrubEvent, scrubText, scrubValue } from "@/lib/sentry-scrub";
import { verifyTurnstile, turnstileEnabled } from "@/lib/turnstile";
import { can, isGranular, SYSTEM_GRANTS } from "@/lib/permissions";
import { KIND_PERMISSION } from "@/server/approvals";

describe("nonce CSP", () => {
  it("uses a fresh nonce with strict-dynamic and no unsafe-inline scripts in production", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    const csp = buildCsp(a);
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe(`script-src 'self' 'nonce-${a}' 'strict-dynamic'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("img-src 'self' data: blob: https://*.public.blob.vercel-storage.com");
    expect(csp).toContain("form-action 'self' https://rc-epay.esewa.com.np https://epay.esewa.com.np");
  });

  it("adds only the origins that are configured", () => {
    const csp = buildCsp("n", { sentryDsn: "https://abc123@o42.ingest.us.sentry.io/77", turnstile: true, esewaFormUrl: "https://pay.example.np/api/epay/main/v2/form", dev: true });
    expect(csp).toContain("connect-src 'self' https://o42.ingest.us.sentry.io https://challenges.cloudflare.com ws: wss:");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toMatch(/form-action [^;]*https:\/\/pay\.example\.np/);
    expect(csp).toMatch(/script-src [^;]*'unsafe-eval'/); // next dev only
    expect(sentryIngestOrigin("not a url")).toBeNull();
    expect(sentryIngestOrigin("javascript:alert(1)")).toBeNull();
  });
});

describe("Sentry PII scrubbing", () => {
  it("removes emails, phones and payment references from text", () => {
    expect(scrubText("user ram@example.com paid PAY-LX9K2-ABCDE from 9812345678 / +977 9801234567")).toBe("user [email] paid [ref] from [phone] / [phone]");
    expect(scrubText("order DB2611201234 failed")).toBe("order DB2611201234 failed"); // order numbers aren't personal
  });

  it("redacts secret and PII keys deeply (reusing the audit redaction)", () => {
    const out = scrubValue({ password: "hunter22", token: "abc", user: { email: "a@b.co", phoneNumber: "9812345678", note: "call 9812345678" }, pidx: "kh-1", providerRef: "esw-9", ok: 1 }) as Record<string, unknown>;
    expect(out.password).toBe("[redacted]");
    expect(out.token).toBe("[redacted]");
    expect(out.pidx).toBe("[redacted]");
    expect(out.providerRef).toBe("[redacted]");
    expect((out.user as Record<string, unknown>).email).toBe("[redacted]");
    expect((out.user as Record<string, unknown>).phoneNumber).toBe("[redacted]");
    expect((out.user as Record<string, unknown>).note).toBe("call [phone]");
    expect(out.ok).toBe(1);
  });

  it("strips request bodies, cookies, query strings and user identity except the id", () => {
    const ev = scrubEvent({
      message: "failed for sita@example.com",
      user: { id: "u1", email: "sita@example.com", ip_address: "1.2.3.4", username: "sita" },
      request: { url: "https://x.np/pay/abc?pidx=SECRET&token=t", query_string: "pidx=SECRET", cookies: { dabba_session: "x" }, data: { password: "p" }, headers: { cookie: "a=b", authorization: "Bearer xyz", "content-type": "text/html" } },
      exception: { values: [{ value: "Bearer abcdefghijklmnop for 9812345678", stacktrace: { frames: [{ vars: { email: "x@y.co", amount: 5 } }] } }] },
      breadcrumbs: [{ message: "fetch /api?email=a@b.co", data: { url: "/x", token: "t" } }],
      extra: { phone: "9812345678", count: 2 },
    })!;
    expect(ev.message).toBe("failed for [email]");
    expect(ev.user).toEqual({ id: "u1" });
    expect(ev.request?.url).toBe("https://x.np/pay/abc");
    expect(ev.request?.query_string).toBeUndefined();
    expect(ev.request?.cookies).toBeUndefined();
    expect(ev.request?.data).toBeUndefined();
    expect(ev.request?.headers).toEqual({ "content-type": "text/html" });
    expect(ev.exception?.values?.[0].value).not.toMatch(/abcdefghijklmnop|9812345678/);
    expect((ev.exception?.values?.[0].stacktrace?.frames?.[0].vars as Record<string, unknown>).email).toBe("[redacted]");
    expect(ev.breadcrumbs?.[0].message).toBe("fetch /api?email=[email]");
    expect((ev.breadcrumbs?.[0].data as Record<string, unknown>).token).toBe("[redacted]");
    expect(ev.extra).toEqual({ phone: "[redacted]", count: 2 });
  });

  it("drops Next control-flow errors and network noise", () => {
    expect(scrubEvent({ message: "x" }, { originalException: Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }) })).toBeNull();
    expect(scrubEvent({ exception: { values: [{ value: "TypeError: Failed to fetch dynamically imported module" }] } })).toBeNull();
    expect(scrubEvent({ message: "real bug" })).not.toBeNull();
  });
});

describe("Turnstile verification", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });
  const on = () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site";
  };
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("is skipped when keys are unset (dev / tests / E2E)", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(turnstileEnabled()).toBe(false);
    expect(await verifyTurnstile(null)).toEqual({ ok: true, skipped: true });
    process.env.TURNSTILE_SECRET_KEY = "only-secret";
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    expect(turnstileEnabled()).toBe(false);
  });

  it("verifies server-side with the secret and the client IP", async () => {
    on();
    const f = reply({ success: true, action: "login" });
    expect((await verifyTurnstile("tok", "1.2.3.4", { expectedAction: "login", fetchImpl: f })).ok).toBe(true);
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("secret");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses missing/invalid tokens and action mismatches", async () => {
    on();
    expect((await verifyTurnstile("", null, { fetchImpl: reply({ success: true }) })).ok).toBe(false);
    expect((await verifyTurnstile("bad", null, { fetchImpl: reply({ success: false, "error-codes": ["invalid-input-response"] }) })).codes).toEqual(["invalid-input-response"]);
    expect((await verifyTurnstile("tok", null, { expectedAction: "login", fetchImpl: reply({ success: true, action: "register" }) })).ok).toBe(false);
  });

  it("fails closed in production when Cloudflare is unreachable, open in dev", async () => {
    on();
    const down = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    vi.stubEnv("NODE_ENV", "production");
    expect((await verifyTurnstile("tok", null, { fetchImpl: down })).ok).toBe(false);
    expect((await verifyTurnstile("tok", null, { fetchImpl: reply({}, 500) })).ok).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect((await verifyTurnstile("tok", null, { fetchImpl: down })).ok).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("approvals permissions", () => {
  it("are registered and granted consistently", () => {
    expect(isGranular("approvals.view")).toBe(true);
    expect(isGranular("approvals.approve")).toBe(true);
    // deciders = whoever could approve refunds; viewers = whoever could request them
    for (const role of ["OWNER", "FINANCE"] as const) expect(SYSTEM_GRANTS[role].has("approvals.approve")).toBe(true);
    for (const role of ["OPERATIONS_MANAGER", "SUPPORT", "KITCHEN_STAFF", "DELIVERY_AGENT", "CUSTOMER"] as const) expect(SYSTEM_GRANTS[role].has("approvals.approve")).toBe(false);
    for (const role of ["OPERATIONS_MANAGER", "SUPPORT", "FINANCE"] as const) expect(SYSTEM_GRANTS[role].has("approvals.view")).toBe(true);
    expect(can("SUPER_ADMIN", "approvals.approve")).toBe(true);
    for (const p of Object.values(KIND_PERMISSION)) expect(can("FINANCE", p)).toBe(true);
  });
});
