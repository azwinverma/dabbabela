import { REDACTED, isSecretKey, redactSecrets, redactString } from "./redact";

/**
 * PII scrubbing for Sentry events (server, edge and browser). Builds on the audit redaction helper (secret keys,
 * bearer tokens, JWTs, card numbers) and additionally removes what an error tracker must never hold here:
 * emails, phone numbers, payment / gateway references, cookies, auth headers, request bodies and query strings.
 * Pure (no server imports) so the browser config can use it too.
 */

/** Keys whose values are personal data or payment references (matched on the lower-cased key without separators). */
const PII_KEYS = [
  "email", "phone", "phonenumber", "mobile", "address", "line1", "line2", "landmark", "ip", "ipaddress", "remoteip", "useragent",
  "name", "fullname", "contactname", "reference", "providerref", "bankreference", "pidx", "transactionuuid", "transactioncode",
  "refid", "proofurl", "joincode", "code", "otp", "data",
];
const PII_SET = new Set(PII_KEYS);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Nepal mobiles (+977 / 977 / bare 9[678]xxxxxxxx) and landlines like 01-4xxxxxx, plus any long digit run.
const PHONE = /(?:\+?977[\s-]?)?(?:9[678]\d{8}|0\d{1,2}[\s-]?\d{6,7})\b/g;
// Our payment references (PAY-…, plan PLN-…, attempt suffixes) — order numbers (DB2611…) are kept: not personal.
const PAYREF = /\b(?:PAY|PLN|INV|RF|TOPUP)-[A-Z0-9-]{4,}\b/gi;
const LONG_DIGITS = /\b\d{9,}\b/g;

export function scrubText(s: string): string {
  return redactString(s).replace(EMAIL, "[email]").replace(PHONE, "[phone]").replace(PAYREF, "[ref]").replace(LONG_DIGITS, "[number]");
}

function normKey(k: string) {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Deep-scrub any JSON-ish value: secrets (audit helper) + PII keys + PII-looking strings. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth]";
  const v = depth === 0 ? redactSecrets(value) : value;
  if (typeof v === "string") return scrubText(v);
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = isSecretKey(k) || PII_SET.has(normKey(k)) ? REDACTED : scrubValue(x, depth + 1);
    return out;
  }
  return v;
}

function stripQuery(url: unknown) {
  if (typeof url !== "string") return url;
  const i = url.search(/[?#]/);
  return scrubText(i === -1 ? url : url.slice(0, i));
}

/** Minimal structural type of what we touch on a Sentry event (keeps this file SDK-independent). */
type EventLike = {
  user?: Record<string, unknown> | null;
  request?: { url?: string; query_string?: unknown; cookies?: unknown; headers?: Record<string, string>; data?: unknown; env?: unknown } | null;
  message?: string;
  exception?: { values?: { value?: string; stacktrace?: { frames?: { vars?: unknown }[] } }[] };
  breadcrumbs?: { message?: string; data?: unknown; category?: string }[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  transaction?: string;
  [k: string]: unknown;
};

const KEEP_HEADERS = new Set(["user-agent-family", "content-type", "accept", "x-request-id", "x-vercel-id", "referer-host"]);

/** Ignore noise that isn't a bug (aborted navigations, Next's redirect/not-found control flow, bots). */
export function isIgnorable(event: EventLike, hint?: { originalException?: unknown }): boolean {
  const err = hint?.originalException as { digest?: string; name?: string; message?: string } | undefined;
  const digest = typeof err?.digest === "string" ? err.digest : "";
  if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return true;
  const msg = `${err?.message ?? ""} ${event.exception?.values?.[0]?.value ?? event.message ?? ""}`;
  return /AbortError|ResizeObserver loop|Load failed|NetworkError when attempting to fetch|Failed to fetch dynamically imported module/i.test(msg);
}

/** Sentry `beforeSend` / `beforeSendTransaction`: drop noise, scrub PII. Returns null to drop the event. */
export function scrubEvent<E extends EventLike>(event: E, hint?: { originalException?: unknown }): E | null {
  if (isIgnorable(event, hint)) return null;
  // Keep only an opaque user id (never email / ip / username).
  if (event.user) event.user = typeof event.user.id === "string" ? { id: event.user.id } : {};
  if (event.request) {
    const r = event.request;
    r.url = stripQuery(r.url) as string | undefined;
    delete r.query_string;
    delete r.cookies;
    delete r.data;
    delete r.env;
    if (r.headers) r.headers = Object.fromEntries(Object.entries(r.headers).filter(([k]) => KEEP_HEADERS.has(k.toLowerCase())));
  }
  if (typeof event.message === "string") event.message = scrubText(event.message);
  if (typeof event.transaction === "string") event.transaction = stripQuery(event.transaction) as string;
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === "string") ex.value = scrubText(ex.value);
    for (const f of ex.stacktrace?.frames ?? []) if (f.vars) f.vars = scrubValue(f.vars);
  }
  if (event.breadcrumbs)
    event.breadcrumbs = event.breadcrumbs.map((b) => ({ ...b, message: typeof b.message === "string" ? scrubText(b.message) : b.message, data: b.data ? (scrubValue(b.data) as Record<string, unknown>) : b.data }));
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as Record<string, unknown>;
  if (event.tags) event.tags = scrubValue(event.tags) as Record<string, unknown>;
  return event;
}

/** Breadcrumb filter: drop console noise from the browser and scrub the rest. */
export function scrubBreadcrumb<B extends { category?: string; message?: string; data?: unknown }>(b: B): B | null {
  if (b.category === "console" && !/error/i.test(String((b as { level?: string }).level ?? ""))) return null;
  return { ...b, message: typeof b.message === "string" ? scrubText(b.message) : b.message, data: b.data ? scrubValue(b.data) : b.data };
}
