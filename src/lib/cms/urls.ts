/**
 * URL allow-lists for CMS content (client-safe, no DB).
 * Links: site paths ("/menu", "/info/terms#refunds"), https://, mailto:, tel:, "#anchor".
 * Images: bundled assets ("/brand/x.svg") or https:// URLs (save-time check: must be in the MediaAsset library).
 * Anything else (javascript:, data:, protocol-relative "//", backslashes, whitespace, control characters) is refused.
 */

const CONTROL = /[\u0000-\u001f\u007f\\]/;

export function isSafeHref(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s.length > 500 || CONTROL.test(s) || /\s/.test(s)) return false;
  if (/^\/(?!\/)/.test(s)) return true; // site path
  if (/^#[\w-]*$/.test(s)) return true;
  if (/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(s)) return true;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(s)) return true;
  if (/^tel:\+?[\d-]{5,20}$/i.test(s)) return true;
  return false;
}

export function isSafeImage(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s.length > 500 || CONTROL.test(s) || /\s/.test(s)) return false;
  if (/^\/(?!\/)[\w\-./]+\.(svg|png|jpe?g|webp|avif|gif)$/i.test(s)) return !s.includes("..");
  return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\/\S*$/i.test(s);
}

/** Internal path, for redirects and canonical overrides. */
export function isSitePath(v: unknown): v is string {
  return typeof v === "string" && /^\/(?!\/)[A-Za-z0-9\-._~/%]*$/.test(v) && !v.includes("..") && v.length <= 300;
}

/** Normalise a request path for redirect lookup: no query, no trailing slash (except "/"), lower-case. */
export function normalisePath(p: string) {
  let s = (p.split(/[?#]/)[0] ?? "").trim();
  if (!s.startsWith("/")) s = `/${s}`;
  s = s.replace(/\/{2,}/g, "/");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return s.toLowerCase();
}
