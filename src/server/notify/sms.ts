import "server-only";
import { log } from "@/lib/logger";

export type SmsResult = { ok: boolean; skipped?: boolean; error?: string };

/**
 * SMS adapter. Providers: "sparrow" (Sparrow SMS, Nepal) or "aakash" (Aakash SMS, Nepal).
 * Needs merchant sender-ID approval from the provider — until then SMS_PROVIDER stays unset
 * and messages are skipped (OTP sign-in is hidden by the phoneOtp flag).
 */
export function smsConfigured() {
  const p = process.env.SMS_PROVIDER;
  if (p === "sparrow") return Boolean(process.env.SPARROW_TOKEN && process.env.SPARROW_FROM);
  if (p === "aakash") return Boolean(process.env.AAKASH_TOKEN);
  if (p === "console") return process.env.NODE_ENV !== "production";
  return false;
}

/** to: +977XXXXXXXXXX */
export async function deliverSms(to: string, text: string): Promise<SmsResult> {
  const provider = process.env.SMS_PROVIDER;
  const local = to.replace(/^\+977/, "");
  try {
    if (provider === "console" && process.env.NODE_ENV !== "production") {
      // Development only: print so OTP flows can be tested locally.
      console.log(`[sms:console] → ${to}: ${text}`);
      return { ok: true };
    }
    if (provider === "sparrow" && smsConfigured()) {
      const res = await fetch("https://api.sparrowsms.com/v2/sms/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: process.env.SPARROW_TOKEN!, from: process.env.SPARROW_FROM!, to: local, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { ok: false, error: `Sparrow HTTP ${res.status}` };
      return { ok: true };
    }
    if (provider === "aakash" && smsConfigured()) {
      const res = await fetch("https://sms.aakashsms.com/sms/v3/send", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ auth_token: process.env.AAKASH_TOKEN!, to: local, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { ok: false, error: `Aakash HTTP ${res.status}` };
      return { ok: true };
    }
    log.info("sms.skipped_no_provider", { to });
    return { ok: false, skipped: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
