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
 * Fails open on a database error (a limiter outage must not take sign-in down) but logs it.
 */
export async function rateLimit(bucket: string, id: string, max: number, windowMs: number): Promise<boolean> {
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
    log.warn("ratelimit.failed", { bucket, error: e });
    return true;
  }
}

/** First client IP from the proxy headers (Vercel sets x-forwarded-for), or "local". */
export async function requestIp(): Promise<string> {
  try {
    const h = await headers();
    const raw = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
    return /^[0-9a-fA-F:.]{3,45}$/.test(raw) ? raw : "local";
  } catch {
    return "local";
  }
}

/** Per-IP limit for the current request. */
export async function rateLimitIp(bucket: string, max: number, windowMs: number) {
  return rateLimit(bucket, await requestIp(), max, windowMs);
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
  twoFactor: { max: 8, windowMs: 5 * 60_000 },
  checkout: { max: 12, windowMs: 60_000 }, // place order / subscribe, per user
  payStart: { max: 15, windowMs: 60_000 }, // start / switch a payment, per user
  payReturn: { max: 30, windowMs: 60_000 }, // gateway return verification, per IP
  couponFail: { max: 10, windowMs: 10 * 60_000 }, // wrong coupon codes, per IP
  proofUpload: { max: 10, windowMs: 10 * 60_000 },
} as const;
