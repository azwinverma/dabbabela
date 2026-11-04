import { parseRupees } from "@/lib/money";
import { isValidISODate } from "@/lib/dates";

/** FormData readers for admin actions. Everything is validated again on the server. */
export const f = {
  str: (d: FormData, k: string, max = 2000) => (typeof d.get(k) === "string" ? (d.get(k) as string).trim().slice(0, max) : ""),
  opt: (d: FormData, k: string, max = 2000) => {
    const v = f.str(d, k, max);
    return v ? v : null;
  },
  int: (d: FormData, k: string, fallback = 0, min = -1e9, max = 1e9) => {
    const n = parseInt(f.str(d, k), 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  },
  intOpt: (d: FormData, k: string) => {
    const s = f.str(d, k);
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  },
  num: (d: FormData, k: string, fallback = 0) => {
    const n = parseFloat(f.str(d, k));
    return Number.isFinite(n) ? n : fallback;
  },
  bool: (d: FormData, k: string) => {
    const v = d.get(k);
    return v === "on" || v === "true" || v === "1";
  },
  /** Rupees typed by staff → paisa. Throws a readable error when invalid. */
  money: (d: FormData, k: string, label: string) => {
    const v = parseRupees(f.str(d, k));
    if (v === null || v < 0) throw new FieldError(k, `${label}: enter an amount in rupees`);
    return v;
  },
  moneyOpt: (d: FormData, k: string, label: string) => {
    const s = f.str(d, k);
    if (!s) return null;
    const v = parseRupees(s);
    if (v === null || v < 0) throw new FieldError(k, `${label}: enter an amount in rupees`);
    return v;
  },
  list: (d: FormData, k: string) =>
    f
      .str(d, k, 10000)
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean),
  date: (d: FormData, k: string) => {
    const s = f.str(d, k);
    return s && isValidISODate(s) ? s : null;
  },
  all: (d: FormData, k: string) => d.getAll(k).filter((v): v is string => typeof v === "string"),
};

export class FieldError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
  }
}
