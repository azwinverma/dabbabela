/**
 * Pure helpers for admin list pages: read paging/sorting/filter state from URL search params and build
 * links back. No server or React imports, so they run anywhere (server pages, client components, tests).
 */
import { isValidISODate } from "@/lib/dates";

export type SearchParamsRecord = Record<string, string | string[] | undefined>;
export type SortDir = "asc" | "desc";
export type ListState<S extends string = string> = { page: number; per: number; sort: S; dir: SortDir };

export const PER_PAGE_OPTIONS = [25, 50, 100] as const;

/** First value of a param (Next gives string | string[] | undefined). Trimmed, capped at 200 chars. */
export function one(sp: SearchParamsRecord, key: string): string | undefined {
  const v = sp[key];
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s ? s.slice(0, 200) : undefined;
}

/**
 * Page, page size and sort from params. `sort` must be one of `sortable` (else the default);
 * `dir` is asc|desc; `per` is one of PER_PAGE_OPTIONS (else `defaults.per`).
 */
export function parseListParams<S extends string>(sp: SearchParamsRecord, opts: { sortable: readonly S[]; sort: S; dir?: SortDir; per?: number }): ListState<S> {
  const page = Math.min(10_000, Math.max(1, parseInt(one(sp, "page") ?? "1", 10) || 1));
  const perRaw = parseInt(one(sp, "per") ?? "", 10);
  const per = (PER_PAGE_OPTIONS as readonly number[]).includes(perRaw) ? perRaw : (opts.per ?? 50);
  const sortRaw = one(sp, "sort");
  const sort = sortRaw && (opts.sortable as readonly string[]).includes(sortRaw) ? (sortRaw as S) : opts.sort;
  const dirRaw = one(sp, "dir");
  const dir: SortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : (opts.dir ?? "desc");
  return { page, per, sort, dir };
}

/** skip/take for Prisma. */
export function pageWindow(state: Pick<ListState, "page" | "per">) {
  return { skip: (state.page - 1) * state.per, take: state.per };
}

export function pageCount(total: number, per: number) {
  return Math.max(1, Math.ceil(total / Math.max(1, per)));
}

/** Kathmandu-day date range from ?from=&to= (YYYY-MM-DD). Invalid values are dropped; swapped ranges are fixed. */
export function parseDateRange(sp: SearchParamsRecord, fromKey = "from", toKey = "to"): { from?: string; to?: string; gte?: Date; lte?: Date } {
  let from = one(sp, fromKey);
  let to = one(sp, toKey);
  if (from && !isValidISODate(from)) from = undefined;
  if (to && !isValidISODate(to)) to = undefined;
  if (from && to && from > to) [from, to] = [to, from];
  return {
    from,
    to,
    gte: from ? new Date(`${from}T00:00:00+05:45`) : undefined,
    lte: to ? new Date(`${to}T23:59:59.999+05:45`) : undefined,
  };
}

/** Prisma `createdAt`-style range filter, or undefined when no bound is set. */
export function dateWhere(range: { gte?: Date; lte?: Date }) {
  if (!range.gte && !range.lte) return undefined;
  return { ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lte: range.lte } : {}) };
}

/** A status param restricted to an allow-list. */
export function parseEnum<T extends string>(sp: SearchParamsRecord, key: string, allowed: readonly T[]): T | undefined {
  const v = one(sp, key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Flatten params to a plain string map (first value of each, empties dropped). */
export function flatParams(sp: SearchParamsRecord | URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (sp instanceof URLSearchParams) {
    sp.forEach((v, k) => {
      if (v.trim() && !(k in out)) out[k] = v.trim();
    });
    return out;
  }
  for (const k of Object.keys(sp)) {
    const v = one(sp, k);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * Link to `basePath` with `params` merged with `patch` (null/"" removes a key).
 * Changing anything other than `page` resets to page 1.
 */
export function hrefWith(basePath: string, params: Record<string, string | undefined>, patch: Record<string, string | number | null | undefined> = {}) {
  const q = new URLSearchParams();
  const resetsPage = Object.keys(patch).some((k) => k !== "page");
  for (const [k, v] of Object.entries(params)) if (v && !(resetsPage && k === "page") && !(k in patch)) q.set(k, v);
  for (const [k, v] of Object.entries(patch)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  if (q.get("page") === "1") q.delete("page");
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

/** Sort link for a column header: first click = `defaultDir`, clicking the active column flips it. */
export function sortHref(basePath: string, params: Record<string, string | undefined>, state: Pick<ListState, "sort" | "dir">, column: string, defaultDir: SortDir = "desc") {
  const dir: SortDir = state.sort === column ? (state.dir === "asc" ? "desc" : "asc") : defaultDir;
  return hrefWith(basePath, params, { sort: column, dir });
}

// ───────────────────────────── Saved views ─────────────────────────────

/** Params never stored in a saved view (paging is transient). */
const VIEW_EXCLUDED = new Set(["page"]);
export const VIEW_MAX_KEYS = 20;
export const VIEW_MAX_VALUE = 200;
export const VIEW_NAME_MAX = 60;
const VIEW_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;
const MODULE = /^[a-z0-9][a-z0-9/_-]{0,59}$/;

export function isValidModule(m: string) {
  return MODULE.test(m);
}

/** Normalise filters for storage: string values only, page dropped, keys validated, sorted, capped. */
export function serializeView(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(params).sort()) {
    if (Object.keys(out).length >= VIEW_MAX_KEYS) break;
    if (VIEW_EXCLUDED.has(k) || !VIEW_KEY.test(k)) continue;
    const raw = params[k];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    const s = String(v).trim();
    if (s) out[k] = s.slice(0, VIEW_MAX_VALUE);
  }
  return out;
}

/** Read a stored SavedView.query (untrusted JSON) back into a safe filter map. */
export function parseView(json: unknown): Record<string, string> {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  return serializeView(json as Record<string, unknown>);
}

/** URL for applying a saved view. */
export function viewHref(basePath: string, query: unknown) {
  return hrefWith(basePath, parseView(query));
}

/** Does the current URL match a saved view exactly (ignoring page)? */
export function sameView(a: Record<string, unknown>, b: Record<string, unknown>) {
  const x = serializeView(a);
  const y = serializeView(b);
  const kx = Object.keys(x);
  return kx.length === Object.keys(y).length && kx.every((k) => x[k] === y[k]);
}

export function cleanViewName(name: string) {
  return name.replace(/\s+/g, " ").trim().slice(0, VIEW_NAME_MAX);
}
