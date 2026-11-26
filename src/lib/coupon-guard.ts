import "server-only";
import { LIMITS, rateLimit, rateLimitPeek, requestIp } from "./rate-limit";

/**
 * Coupon guessing guard (security review 2B, extended to plan quotes): after LIMITS.couponFail wrong codes per IP in
 * the window, codes are no longer checked at all — the quote comes back with "too many coupon attempts". Shared by
 * the cart and plan quotes on the website and in the mobile API, so one IP has ONE budget across all of them.
 */
export const COUPON_BLOCKED = "Too many coupon attempts — try again in a few minutes";

/**
 * Run a quote with a coupon under the guard. `quote(code)` gets the code (or null when blocked) and returns the
 * quote; a wrong code (quote.couponError set) counts one failure.
 */
export async function withCouponGuard<Q extends { couponError: string | null }>(code: string | null | undefined, quote: (code: string | null) => Promise<Q>, ip?: string): Promise<Q> {
  const c = code?.trim() || null;
  if (!c) return quote(null);
  const who = ip ?? (await requestIp());
  if (!(await rateLimitPeek("shop:coupon-fail", who, LIMITS.couponFail.max, LIMITS.couponFail.windowMs))) {
    const q = await quote(null);
    q.couponError = COUPON_BLOCKED;
    return q;
  }
  const q = await quote(c);
  if (q.couponError) await rateLimit("shop:coupon-fail", who, LIMITS.couponFail.max, LIMITS.couponFail.windowMs);
  return q;
}
