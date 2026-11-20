import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";

/**
 * Rate limits for the mobile API. Fixed window in Postgres (`RateLimit` table, shared with Better Auth), one atomic
 * upsert per hit, so it holds across serverless instances. Fails open on a database error (logged).
 *
 * Auth calls made through `auth.api.*` bypass Better Auth's own HTTP limiter, so the v1 auth endpoints limit
 * themselves here (per IP and per email/phone).
 */
export async function rateLimit(bucket: string, id: string, max: number, windowMs: number): Promise<boolean> {
  const key = `rl:${bucket}:${id}`.slice(0, 250);
  const now = BigInt(Date.now());
  const win = BigInt(windowMs);
  try {
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest") VALUES (${randomUUID()}, ${key}, 1, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN ${now} - "RateLimit"."lastRequest" > ${win} THEN 1 ELSE "RateLimit"."count" + 1 END,
        "lastRequest" = CASE WHEN ${now} - "RateLimit"."lastRequest" > ${win} THEN ${now} ELSE "RateLimit"."lastRequest" END
      RETURNING "count"`;
    return Number(rows[0]?.count ?? 1) <= max;
  } catch (e) {
    log.warn("ratelimit.failed", { bucket, error: e });
    return true;
  }
}

/** Sign-in style limits: on in production (and with AUTH_RATE_LIMIT=true), like Better Auth's own switch. */
export function authLimitsOn() {
  if (process.env.AUTH_RATE_LIMIT === "false") return false;
  return process.env.NODE_ENV === "production" || process.env.AUTH_RATE_LIMIT === "true";
}

/** Documented API limits (docs/api/README.md). `auth: true` limits only apply when authLimitsOn(). */
export const API_LIMITS = {
  signIn: { max: 10, windowMs: 5 * 60_000, auth: true }, // per IP; plus signInEmail per email
  signInEmail: { max: 6, windowMs: 5 * 60_000, auth: true },
  signUp: { max: 5, windowMs: 10 * 60_000, auth: true },
  reset: { max: 3, windowMs: 10 * 60_000, auth: true },
  otpSend: { max: 3, windowMs: 5 * 60_000, auth: true },
  otpVerify: { max: 8, windowMs: 5 * 60_000, auth: true },
  twoFactor: { max: 8, windowMs: 5 * 60_000, auth: true },
  checkout: { max: 12, windowMs: 60_000, auth: false }, // place order / subscribe / add meal / renew / top-up, per user
  payStart: { max: 15, windowMs: 60_000, auth: false }, // start / switch a payment, per user
  upload: { max: 10, windowMs: 10 * 60_000, auth: false }, // proof / delivery photo uploads, per user
  write: { max: 60, windowMs: 60_000, auth: false }, // any other write, per user
  read: { max: 300, windowMs: 60_000, auth: false }, // reads, per user (or IP when public)
} as const;

export type LimitName = keyof typeof API_LIMITS;

/** true = allowed. */
export async function hit(name: LimitName, id: string) {
  const l = API_LIMITS[name];
  if (l.auth && !authLimitsOn()) return true;
  return rateLimit(`api:${name}`, id, l.max, l.windowMs);
}
