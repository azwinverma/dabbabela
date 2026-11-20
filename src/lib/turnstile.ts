import "server-only";
import { log } from "./logger";

/**
 * Cloudflare Turnstile (bot challenge) for sign-up, sign-in, password reset and the public lead / contact / area
 * forms. Env-gated: with `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` both set the widget renders and
 * every protected action verifies the token server-side; with either unset (local dev, tests, E2E) verification is
 * skipped and /api/health reports `turnstile: false`.
 *
 * Verification calls siteverify with a timeout. In production it fails closed (no token, a bad token or Cloudflare
 * unreachable = refused); outside production an unreachable Cloudflare is let through so dev isn't blocked offline.
 */
export const TURNSTILE_FIELD = "cf-turnstile-response";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

export function turnstileEnabled() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

export type TurnstileResult = { ok: boolean; skipped?: boolean; codes?: string[] };

/** Verify a widget token. `expectedAction` (optional) must match the widget's data-action. */
export async function verifyTurnstile(token: string | null | undefined, ip?: string | null, opts: { expectedAction?: string; fetchImpl?: typeof fetch } = {}): Promise<TurnstileResult> {
  if (!turnstileEnabled()) return { ok: true, skipped: true };
  const t = (token ?? "").trim();
  if (!t || t.length > 2048) return { ok: false, codes: ["missing-input-response"] };
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: t });
  if (ip && ip !== "local") body.set("remoteip", ip);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await (opts.fetchImpl ?? fetch)(VERIFY_URL, { method: "POST", body, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`siteverify HTTP ${res.status}`);
    const data = (await res.json()) as { success?: boolean; action?: string; "error-codes"?: string[] };
    if (!data.success) return { ok: false, codes: data["error-codes"] ?? [] };
    if (opts.expectedAction && data.action && data.action !== opts.expectedAction) return { ok: false, codes: ["action-mismatch"] };
    return { ok: true };
  } catch (e) {
    log.warn("turnstile.verify_failed", { error: e instanceof Error ? e.message : String(e) });
    return { ok: process.env.NODE_ENV !== "production", codes: ["verify-unreachable"] };
  } finally {
    clearTimeout(timer);
  }
}

/** Read the token from a submitted form and verify it for the current request's IP. */
export async function checkTurnstile(fd: FormData, expectedAction?: string): Promise<TurnstileResult> {
  if (!turnstileEnabled()) return { ok: true, skipped: true };
  const { requestIp } = await import("./rate-limit");
  const v = fd.get(TURNSTILE_FIELD);
  return verifyTurnstile(typeof v === "string" ? v : null, await requestIp(), { expectedAction });
}

export const TURNSTILE_FAILED = "Please complete the security check and try again.";
