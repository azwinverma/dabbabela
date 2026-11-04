import type { Weekday } from "@prisma/client";

export const TZ = "Asia/Kathmandu";
export const WEEKDAYS: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export const WEEKDAY_LABEL: Record<Weekday, string> = {
  SUN: "Sunday",
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
};
export const WEEKDAY_NEPALI: Record<Weekday, string> = {
  SUN: "आइतबार",
  MON: "सोमबार",
  TUE: "मंगलबार",
  WED: "बुधबार",
  THU: "बिहीबार",
  FRI: "शुक्रबार",
  SAT: "शनिबार",
};

/** Current date + time in Kathmandu as plain strings. */
export function ktmNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function todayKTM() {
  return ktmNow().date;
}

/** "YYYY-MM-DD" -> Date at UTC midnight (matches @db.Date storage). */
export function dateOnly(s: string) {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Date from a @db.Date column -> "YYYY-MM-DD". */
export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function isValidISODate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dateOnly(s).getTime());
}

export function addDays(s: string, n: number) {
  const d = dateOnly(s);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function weekdayOf(s: string): Weekday {
  return WEEKDAYS[dateOnly(s).getUTCDay()];
}

/** Sunday that starts the (Nepali work) week containing s. */
export function weekStartOf(s: string) {
  return addDays(s, -dateOnly(s).getUTCDay());
}

export function daysBetween(a: string, b: string) {
  return Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86400000);
}

export function formatDay(s: string | Date, style: "short" | "long" | "full" = "short") {
  const d = typeof s === "string" ? dateOnly(s) : s;
  const opts: Intl.DateTimeFormatOptions =
    style === "full"
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
      : style === "long"
        ? { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }
        : { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-GB", opts).format(d);
}

/** Timestamp (createdAt etc.) shown in Kathmandu time. */
export function formatStamp(d: Date | string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(typeof d === "string" ? new Date(d) : d);
}

export function monthRange(ym?: string) {
  const base = ym && /^\d{4}-\d{2}$/.test(ym) ? ym : todayKTM().slice(0, 7);
  const [y, m] = base.split("-").map(Number);
  const start = `${base}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { ym: base, start, end: addDays(next, -1), next };
}
