/**
 * Content-Security-Policy with a per-request nonce (set in src/middleware.ts). Edge-safe and pure.
 *
 * - script-src: 'self' + the nonce + 'strict-dynamic'. Next.js reads the nonce from the request's CSP header and
 *   stamps it on its own inline/bootstrap scripts (every page is dynamically rendered — the root layout is
 *   force-dynamic — so each response gets the nonce of its request). Scripts those trusted scripts load (Next
 *   chunks, Turnstile, Sentry) are allowed by 'strict-dynamic'; host allow-lists are ignored by CSP3 browsers but
 *   kept for older ones. No 'unsafe-inline' for scripts in production ('unsafe-eval' only in `next dev`).
 * - style-src keeps 'unsafe-inline' (React style attributes and next/font); styles can't run code.
 * - img-src: self, data/blob (QR codes, previews) and Vercel Blob uploads.
 * - connect-src: self + Sentry ingest (when a DSN is set) + Turnstile.
 * - frame-src: Turnstile's challenge iframe only.
 * - form-action: self + the eSewa form endpoint (Khalti is a redirect, not a form post).
 */
export type CspEnv = {
  dev?: boolean;
  sentryDsn?: string | null;
  esewaFormUrl?: string | null;
  turnstile?: boolean;
};

const TURNSTILE = "https://challenges.cloudflare.com";
const BLOB = "https://*.public.blob.vercel-storage.com";
const ESEWA = ["https://rc-epay.esewa.com.np", "https://epay.esewa.com.np"];

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Sentry DSN → ingest origin (https://o123.ingest.sentry.io), or null. */
export function sentryIngestOrigin(dsn: string | null | undefined): string | null {
  return originOf(dsn);
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function buildCsp(nonce: string, env: CspEnv = {}): string {
  const sentry = sentryIngestOrigin(env.sentryDsn);
  const esewa = originOf(env.esewaFormUrl);
  const formAction = ["'self'", ...ESEWA, ...(esewa && !ESEWA.includes(esewa) ? [esewa] : [])];
  const script = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(env.turnstile ? [TURNSTILE] : []), ...(env.dev ? ["'unsafe-eval'"] : [])];
  const connect = ["'self'", ...(sentry ? [sentry] : []), ...(env.turnstile ? [TURNSTILE] : []), ...(env.dev ? ["ws:", "wss:"] : [])];
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${BLOB}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    `frame-src ${env.turnstile ? TURNSTILE : "'none'"}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `form-action ${formAction.join(" ")}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** The CSP for the current process environment (middleware). */
export function cspFromEnv(nonce: string): string {
  return buildCsp(nonce, {
    dev: process.env.NODE_ENV === "development",
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
    esewaFormUrl: process.env.ESEWA_FORM_URL,
    turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  });
}
