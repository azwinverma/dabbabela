import type { Paging, Row } from "./types";

/** Hard cap on exported rows (one export = one request). */
export const EXPORT_CAP = 50_000;

/** Page of an already-aggregated (bounded) result set. */
export function pageOf<T>(rows: T[], p: Paging): T[] {
  return p.all ? rows.slice(0, EXPORT_CAP) : rows.slice((p.page - 1) * p.per, p.page * p.per);
}

/** skip/take for list reports queried page by page. */
export function windowOf(p: Paging) {
  return p.all ? { skip: 0, take: EXPORT_CAP } : { skip: (p.page - 1) * p.per, take: p.per };
}

export function sumOf<T>(rows: T[], pick: (r: T) => number | null | undefined) {
  return rows.reduce((a, r) => a + (pick(r) ?? 0), 0);
}

/** Totals row: Σ of the given numeric keys over all rows (not just the page). */
export function totalsOf(rows: Row[], keys: string[], label: Row = {}): Row {
  const out: Row = { ...label };
  for (const k of keys) out[k] = rows.reduce((a, r) => a + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
  return out;
}

export const ratio = (a: number, b: number) => (b ? a / b : null);
