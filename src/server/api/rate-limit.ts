import "server-only";
import { authLimitsOn, LIMITS, rateLimit } from "@/lib/rate-limit";

/**
 * Rate limits for the mobile API, on Phase 2B's Postgres limiter (src/lib/rate-limit.ts — the same buckets and
 * numbers the web auth forms use). Calls made through `auth.api.*` bypass Better Auth's own HTTP limiter, so the v1
 * auth endpoints limit themselves here (per IP and per email/phone). Auth limits follow `authLimitsOn()` like the web.
 */
export { authLimitsOn, rateLimit };

/** Documented API limits (docs/api/README.md). `auth: true` limits only apply when authLimitsOn(). */
export const API_LIMITS = {
  signIn: { ...LIMITS.signIn, auth: true }, // per IP; plus signInEmail per email
  signInEmail: { ...LIMITS.signInEmail, auth: true },
  signUp: { ...LIMITS.signUp, auth: true },
  reset: { ...LIMITS.reset, auth: true }, // per IP and per email
  resetSubmit: { ...LIMITS.resetSubmit, auth: true },
  otpSend: { ...LIMITS.otpSend, auth: true }, // per IP and per phone
  otpVerify: { ...LIMITS.otpVerify, auth: true },
  twoFactor: { ...LIMITS.twoFactor, auth: true },
  checkout: { ...LIMITS.checkout, auth: false }, // place order / subscribe / add meal / renew / top-up, per user
  payStart: { ...LIMITS.payStart, auth: false }, // start / switch a payment, per user
  upload: { ...LIMITS.proofUpload, auth: false }, // proof / delivery photo uploads, per user
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
