/**
 * Marketing attribution (WP-11): first-touch and last-touch UTM / referrer snapshots.
 *
 * Pure and edge-safe (used by `src/middleware.ts`, the consent route, sign-up and checkout).
 * Nothing is stored until the visitor accepts the notice (`dabba_consent=granted`). What is kept is
 * deliberately small: UTM values, the referring *host* (never its path or query, which can carry personal data),
 * the landing *path* (no query string) and a timestamp.
 */

export const CONSENT_COOKIE = "dabba_consent";
export const FIRST_TOUCH_COOKIE = "dabba_ft";
export const LAST_TOUCH_COOKIE = "dabba_lt";
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 180; // 180 days
export const FIRST_TOUCH_MAX_AGE = 60 * 60 * 24 * 90; // 90 days
export const LAST_TOUCH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type ConsentChoice = "granted" | "denied";

export type Touch = {
  source: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  referrer?: string;
  landing?: string;
  at: string;
};

const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;
const SEARCH_ENGINES = /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia)\./;
const SOCIAL = /(^|\.)(facebook|fb|instagram|tiktok|twitter|x|t|linkedin|youtube|reddit|pinterest|messenger|whatsapp|viber)\./;

/** Trim, drop control/markup characters, cap length. */
function clean(v: string | null | undefined, max = 100): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v
    .replace(/[\u0000-\u001f\u007f<>"'`\\]/g, "")
    .trim()
    .slice(0, max);
  return s || undefined;
}

function hostOf(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.hostname.toLowerCase().replace(/^www\./, "").slice(0, 100) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The touch carried by one page view, or null when it carries no marketing signal
 * (no utm_* parameters and no external referrer).
 */
export function touchFromRequest(url: URL, referrer: string | null | undefined, now: Date = new Date()): Touch | null {
  const utm: Partial<Record<(typeof UTM_KEYS)[number], string>> = {};
  for (const k of UTM_KEYS) {
    const v = clean(url.searchParams.get(`utm_${k}`));
    if (v) utm[k] = k === "source" || k === "medium" ? v.toLowerCase() : v;
  }
  const ownHost = url.hostname.toLowerCase().replace(/^www\./, "");
  const refHost = hostOf(referrer);
  const external = refHost && refHost !== ownHost ? refHost : undefined;
  const landing = clean(url.pathname, 200);
  const at = now.toISOString();
  if (utm.source || utm.campaign || utm.medium) {
    return { source: utm.source ?? external ?? "unknown", ...utm, ...(external ? { referrer: external } : {}), ...(landing ? { landing } : {}), at };
  }
  if (external) {
    const medium = SEARCH_ENGINES.test(`${external}.`) ? "organic" : SOCIAL.test(`${external}.`) ? "social" : "referral";
    return { source: external, medium, referrer: external, ...(landing ? { landing } : {}), at };
  }
  return null;
}

/** First touch for a visitor with no signal: a direct visit. */
export function directTouch(url: URL, now: Date = new Date()): Touch {
  const landing = clean(url.pathname, 200);
  return { source: "direct", medium: "none", ...(landing ? { landing } : {}), at: now.toISOString() };
}

/** Validate a decoded/untrusted object into a Touch (unknown keys dropped). */
export function sanitizeTouch(raw: unknown): Touch | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const source = clean(r.source as string)?.toLowerCase();
  const at = typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? new Date(r.at).toISOString() : null;
  if (!source || !at) return null;
  const out: Touch = { source, at };
  for (const k of ["medium", "campaign", "term", "content", "referrer"] as const) {
    const v = clean(r[k] as string);
    if (v) out[k] = v;
  }
  const landing = clean(r.landing as string, 200);
  if (landing && landing.startsWith("/")) out.landing = landing;
  return out;
}

export function encodeTouch(t: Touch): string {
  return encodeURIComponent(JSON.stringify(t));
}

export function decodeTouch(v: string | null | undefined): Touch | null {
  if (!v) return null;
  try {
    return sanitizeTouch(JSON.parse(decodeURIComponent(v)));
  } catch {
    return null;
  }
}

type CookieReader = { get(name: string): { value: string } | undefined };

export type VisitorAttribution = { consent: ConsentChoice | null; first: Touch | null; last: Touch | null };

/** Read consent + touches from a cookie store (next/headers `cookies()` or `req.cookies`). Touches only count with consent. */
export function readAttribution(cookies: CookieReader): VisitorAttribution {
  const c = cookies.get(CONSENT_COOKIE)?.value;
  const consent: ConsentChoice | null = c === "granted" || c === "denied" ? c : null;
  if (consent !== "granted") return { consent, first: null, last: null };
  return { consent, first: decodeTouch(cookies.get(FIRST_TOUCH_COOKIE)?.value), last: decodeTouch(cookies.get(LAST_TOUCH_COOKIE)?.value) };
}

/** Cookies to write for one consented page view: first touch only if missing, last touch when the view carries a signal. */
export function touchCookieUpdates(existingFirst: string | null | undefined, url: URL, referrer: string | null | undefined, now: Date = new Date()) {
  const touch = touchFromRequest(url, referrer, now);
  const out: { name: string; value: string; maxAge: number }[] = [];
  if (!decodeTouch(existingFirst)) out.push({ name: FIRST_TOUCH_COOKIE, value: encodeTouch(touch ?? directTouch(url, now)), maxAge: FIRST_TOUCH_MAX_AGE });
  if (touch) out.push({ name: LAST_TOUCH_COOKIE, value: encodeTouch(touch), maxAge: LAST_TOUCH_MAX_AGE });
  return out;
}

/** Snapshot stored on User.attribution at sign-up: the first touch flat (as documented) plus the last touch. */
export function userAttributionSnapshot(a: Pick<VisitorAttribution, "first" | "last">): { acquisitionSource: string; attribution: Record<string, unknown> } | null {
  const first = a.first ?? a.last;
  if (!first) return null;
  return { acquisitionSource: first.source, attribution: { ...first, ...(a.last ? { last: a.last } : {}) } };
}

/** Order attribution (placeCartOrder `attribution`): last touch, falling back to first touch. */
export function orderTouch(a: Pick<VisitorAttribution, "first" | "last">): Touch | null {
  return a.last ?? a.first;
}
