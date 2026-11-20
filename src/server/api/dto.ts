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

/** Origin used for gateway return URLs (eSewa/Khalti redirect back to the website's return routes). */
export function apiOrigin(req: Request) {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (env && !env.includes("localhost")) return env;
  const host = req.headers.get("x-forwarded-host");
  if (host) return `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  return new URL(req.url).origin;
}
