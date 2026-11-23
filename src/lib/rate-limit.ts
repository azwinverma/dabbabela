import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { db } from "./db";
import { log } from "./logger";

/**
 * Fixed-window rate limiter stored in Postgres (the `RateLimit` table Better Auth also uses), so it works across
 * serverless instances. One atomic upsert per hit: a new window resets the count, otherwise it increments.
 *
 * Why we need it next to Better Auth's own limiter: Better Auth only rate-limits requests that go through its HTTP
 * handler (/api/auth/*). Our sign-in / sign-up / reset forms are server actions calling `auth.api.*` directly, which
 * bypasses that limiter — so those actions call `rateLimit()` themselves.
 *
 * On a database error: fails OPEN by default (browsing / reads must not go down with the limiter) but logs it;
 * `failClosed: true` (auth, OTP, 2FA, hand-off codes, money endpoints) refuses instead — an attacker who can make the
 * limiter error must not get unlimited guesses.
 */
export async function rateLimit(bucket: string, id: string, max: number, windowMs: number, opts: { failClosed?: boolean } = {}): Promise<boolean> {
  const key = `rl:${bucket}:${id}`.slice(0, 250);
  const now = Date.now();
  try {
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest") VALUES (${randomUUID()}, ${key}, 1, ${BigInt(now)})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN ${BigInt(now)} - "RateLimit"."lastRequest" > ${BigInt(windowMs)} THEN 1 ELSE "RateLimit"."count" + 1 END,
        "lastRequest" = CASE WHEN ${BigInt(now)} - "RateLimit"."lastRequest" > ${BigInt(windowMs)} THEN ${BigInt(now)} ELSE "RateLimit"."lastRequest" END
      RETURNING "count"`;
    return Number(rows[0]?.count ?? 1) <= max;
  } catch (e) {
    log.warn("ratelimit.failed", { bucket, failClosed: Boolean(opts.failClosed), error: e });
    return !opts.failClosed;
  }
}

const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;

/**
 * The client IP for rate limiting, from headers the platform sets (security review L2). Never the left-most
 * X-Forwarded-For value — a client can put anything there. Order:
 *   1. on Vercel (`VERCEL` env set): `x-vercel-forwarded-for`, then `x-real-ip` — both set by Vercel's edge, which
 *      overwrites client-supplied values;
 *   2. otherwise the RIGHT-most X-Forwarded-For hop, i.e. the address our own nearest proxy saw (TRUSTED_PROXY_HOPS
 *      = how many proxies we run in front of the app that each append one hop; default 1). Off Vercel the app must
 *      sit behind such a proxy (docs/SECURITY.md);
 *   3. "local" when nothing usable is there (dev, tests).
 */
export function clientIpFrom(h: { get(name: string): string | null }): string {
  if (process.env.VERCEL) {
    const platform = (h.get("x-vercel-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
    if (IP_RE.test(platform)) return platform;
  }
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const trusted = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);
  const ip = hops.length ? hops[Math.max(0, hops.length - trusted)] : "";
  return IP_RE.test(ip) ? ip : "local";
}

/** Client IP of the current request (see clientIpFrom), or "local". */
export async function requestIp(): Promise<string> {
  try {
    return clientIpFrom(await headers());
  } catch {
    return "local";
  }
}

/** Per-IP limit for the current request. */
export async function rateLimitIp(bucket: string, max: number, windowMs: number, opts: { failClosed?: boolean } = {}) {
  return rateLimit(bucket, await requestIp(), max, windowMs, opts);
}

/**
 * Sign-in style limits are on in production (and when AUTH_RATE_LIMIT=true), matching Better Auth's own switch, so
 * local dev and the E2E suite (many logins from one IP) aren't throttled.
 */
export function authLimitsOn() {
  // Explicit opt-out for the E2E server (a production build hammered with logins from one IP); never set it live.
  if (process.env.AUTH_RATE_LIMIT === "false") return false;
  return process.env.NODE_ENV === "production" || process.env.AUTH_RATE_LIMIT === "true";
}

/** The documented limits (one place, so docs/SECURITY.md and tests can refer to them). */
export const LIMITS = {
  signIn: { max: 10, windowMs: 5 * 60_000 }, // per IP; plus per email below
  signInEmail: { max: 6, windowMs: 5 * 60_000 },
  signUp: { max: 5, windowMs: 10 * 60_000 },
  reset: { max: 3, windowMs: 10 * 60_000 }, // request a reset link, per IP and per email
  resetSubmit: { max: 10, windowMs: 10 * 60_000 },
  otpSend: { max: 3, windowMs: 5 * 60_000 }, // per IP and per phone (SMS cost)
  otpVerify: { max: 8, windowMs: 5 * 60_000 },
  twoFactor: { max: 8, windowMs: 5 * 60_000 }, // per IP, and per sign-in challenge (pending user)
  signUpApi: { max: 3, windowMs: 60 * 60_000 }, // mobile sign-up (no Turnstile possible): per IP and per email, stricter
  handoffOtp: { max: 30, windowMs: 10 * 60_000 }, // hand-off code tries per rider (plus the 5-wrong-codes lock per order)
  checkout: { max: 12, windowMs: 60_000 }, // place order / subscribe, per user
  payStart: { max: 15, windowMs: 60_000 }, // start / switch a payment, per user
  payReturn: { max: 30, windowMs: 60_000 }, // gateway return verification, per IP
  couponFail: { max: 10, windowMs: 10 * 60_000 }, // wrong coupon codes, per IP
  proofUpload: { max: 10, windowMs: 10 * 60_000 },
} as const;
