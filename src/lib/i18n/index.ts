import { en, type Dictionary } from "./en";
import { ne } from "./ne";

export type Locale = "en" | "ne";
export const LOCALES: Locale[] = ["en", "ne"];
export const LOCALE_COOKIE = "lang";

export const DICTIONARIES: Record<Locale, Dictionary> = { en, ne };

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "ne";
}

export function dict(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? en;
}

/** "{time}" placeholders. */
export function format(s: string, vars: Record<string, string | number>) {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

/** Pick the localized field of a record: pick(box, "name", "ne") → box.nameNe ?? box.name */
export function pick<T extends Record<string, unknown>>(row: T, field: string, locale: Locale): string {
  if (locale === "ne") {
    const v = row[`${field}Ne`];
    if (typeof v === "string" && v.trim()) return v;
  }
  const base = row[field];
  return typeof base === "string" ? base : "";
}

export type { Dictionary };
