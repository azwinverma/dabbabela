import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { db } from "./db";
import { log } from "./logger";
import { trustedClientIp } from "./client-ip";

/**
 * Sliding-window rate limiter stored in Postgres (the `RateLimit` table Better Auth also uses), so it works across
 * serverless instances — no schema change. It is the "sliding window counter" approximation: one row per key per
 * fixed window (`<key>:w<window index>`), and a hit is allowed while
 *
 *     hits in the current window + hits in the previous window × (share of the previous window still inside the
 *     sliding window)  ≤  max
 *
 * so a client can no longer burst 2 × max across a window edge (the old fixed-window weakness). One atomic upsert of
 * the current row + a read of the previous row per hit. Old rows are pruned by the housekeeping job
 * (`pruneRateLimits`). Refused hits still count (a client hammering a limited bucket stays limited).
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
  const now = Date.now();
  const w = windowKeys(bucket, id, windowMs, now);
  try {
    const rows = await db.$queryRaw<{ cur: number; prev: number }[]>`
      WITH cur AS (
        INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest") VALUES (${randomUUID()}, ${w.cur}, 1, ${BigInt(now)})
        ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimit"."count" + 1, "lastRequest" = ${BigInt(now)}
        RETURNING "count"
      )
      SELECT (SELECT "count" FROM cur)::int AS cur, COALESCE((SELECT "count" FROM "RateLimit" WHERE "key" = ${w.prev}), 0)::int AS prev`;
    return slidingCount(Number(rows[0]?.cur ?? 1), Number(rows[0]?.prev ?? 0), w.elapsed, windowMs) <= max;
  } catch (e) {
    log.warn("ratelimit.failed", { bucket, failClosed: Boolean(opts.failClosed), error: e });
    return !opts.failClosed;
  }
}

/** Would one more hit be allowed? (Read-only — e.g. "stop checking coupon codes" before quoting.) */
export async function rateLimitPeek(bucket: string, id: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const w = windowKeys(bucket, id, windowMs, now);
  try {
    const rows = await db.rateLimit.findMany({ where: { key: { in: [w.cur, w.prev] } }, select: { key: true, count: true } });
    const cur = rows.find((r) => r.key === w.cur)?.count ?? 0;
    const prev = rows.find((r) => r.key === w.prev)?.count ?? 0;
    return slidingCount(cur + 1, prev, w.elapsed, windowMs) <= max;
  } catch {
    return true;
  }
}

/** Current + previous window rows of a key. */
function windowKeys(bucket: string, id: string, windowMs: number, now: number) {
  const base = `rl:${bucket}:${id}`.slice(0, 230);
  const n = Math.floor(now / Math.max(1, windowMs));
  return { cur: `${base}:w${n}`, prev: `${base}:w${n - 1}`, elapsed: now - n * windowMs };
}

/** Sliding-window estimate (exported for the unit test). */
export function slidingCount(cur: number, prev: number, elapsedInWindow: number, windowMs: number) {
  const weight = Math.max(0, 1 - elapsedInWindow / Math.max(1, windowMs));
  return cur + Math.floor(prev * weight);
}

/** Housekeeping: drop our limiter rows older than any window in use (≤ 1 h) plus margin. Better Auth's rows are left alone. */
export async function pruneRateLimits(olderThanMs = 3 * 3600_000) {
  const cutoff = BigInt(Date.now() - olderThanMs);
  const r = await db.rateLimit.deleteMany({ where: { key: { startsWith: "rl:" }, lastRequest: { lt: cutoff } } });
  return { deleted: r.count };
}

/** Client IP for rate limiting (lib/client-ip trustedClientIp), or "local" when there is none. */
export function clientIpFrom(h: { get(name: string): string | null }): string {
  return trustedClientIp(h) ?? "local";
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
