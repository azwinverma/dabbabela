import "server-only";
import type { SiteSettings } from "@/lib/settings";
import { topupEnabled } from "@/server/wallet-topup";

/**
 * Shared response shapes for /api/v1. Keep DTOs explicit (never spread Prisma rows): no internal notes, no secrets,
 * money in paisa, timestamps ISO, service dates YYYY-MM-DD.
 */

/** Feature flags the app needs (subset of settings.flags; never internal toggles). */
export function appFlags(s: SiteSettings) {
  return {
    phoneOtp: s.flags.phoneOtp,
    wallet: s.flags.wallet,
    walletTopup: topupEnabled(s),
    corporatePortal: s.flags.corporatePortal,
    deliveryOtp: s.flags.deliveryOtp,
    deliveryPhoto: s.flags.deliveryPhoto,
    feedback: s.flags.feedback,
    freeDelivery: s.flags.freeDelivery,
    staff2fa: s.flags.staff2fa,
  };
}

/**
 * Origin used for gateway return URLs (eSewa/Khalti redirect back to the website's return routes). Configured URL
 * first (NEXT_PUBLIC_SITE_URL, then BETTER_AUTH_URL). X-Forwarded-Host is never trusted in production (security
 * review L8 — a forged header would send the customer back to someone else's site); dev/tests may use it.
 */
export function apiOrigin(req: Request) {
  for (const v of [process.env.NEXT_PUBLIC_SITE_URL, process.env.BETTER_AUTH_URL]) {
    const env = v?.trim().replace(/\/$/, "");
    if (env && /^https?:\/\//.test(env)) return env;
  }
  if (process.env.NODE_ENV !== "production") {
    const host = req.headers.get("x-forwarded-host");
    if (host) return `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return new URL(req.url).origin;
}
