/**
 * Money is stored and computed as integer paisa (Rs 1 = 100 paisa).
 * Convert only at the edges: parsing form input and formatting for display.
 */

const grouping = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const groupingDec = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Format paisa as "Rs 1,250" (or "Rs 226.50" when there are paisa). */
export function rs(paisa: number | null | undefined, opts: { locale?: string; decimals?: boolean } = {}) {
  const p = Math.round(paisa ?? 0);
  const neg = p < 0;
  const abs = Math.abs(p);
  const showDec = opts.decimals ?? abs % 100 !== 0;
  const body = showDec ? groupingDec.format(abs / 100) : grouping.format(Math.round(abs / 100));
  const sym = opts.locale === "ne" ? "रु" : "Rs";
  return `${neg ? "−" : ""}${sym} ${body}`;
}

/** Whole-rupee number for inputs ("200" or "226.50"). */
export function rupeesInput(paisa: number | null | undefined) {
  const p = Math.round(paisa ?? 0);
  return p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2);
}

/** Parse a rupee amount typed by staff ("1,250", "226.5") into paisa. Returns null when invalid. */
export function parseRupees(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (typeof input !== "string") return null;
  const clean = input.replace(/[,\s]|Rs\.?|रु/gi, "");
  if (!clean) return null;
  if (!/^[-+]?\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.replace(/^[-+]/, "").split(".");
  const value = parseInt(whole, 10) * 100 + parseInt((frac + "00").slice(0, 2), 10);
  return clean.startsWith("-") ? -value : value;
}

export function paisaOr(input: unknown, fallback = 0) {
  return parseRupees(input) ?? fallback;
}

/** Split an integer total across weights so the parts add up exactly (largest remainder). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!total || !sum) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map((r) => Math.floor(r));
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    parts[i] += 1;
    rest -= 1;
  }
  return parts;
}

/** Percentage of an amount in paisa, rounded half-up. */
export function percentOf(paisa: number, pct: number) {
  return Math.round((paisa * pct) / 100);
}

/** Basis-point share (1300 = 13%). */
export function bpsOf(paisa: number, bps: number) {
  return Math.round((paisa * bps) / 10000);
}

/** VAT contained in an inclusive amount: amount × r / (1 + r). */
export function inclusiveTax(paisa: number, bps: number) {
  return Math.round((paisa * bps) / (10000 + bps));
}
