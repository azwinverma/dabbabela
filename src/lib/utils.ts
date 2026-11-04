import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const npr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Rs 1,40,000 style (South Asian digit grouping). */
export function rs(amount: number | null | undefined) {
  return `Rs ${npr.format(Math.round(amount ?? 0))}`;
}

export function num(n: number | null | undefined) {
  return npr.format(Math.round(n ?? 0));
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomCode(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function str(v: FormDataEntryValue | null | undefined) {
  return typeof v === "string" ? v.trim() : "";
}

export function intOr(v: FormDataEntryValue | null | undefined, fallback = 0) {
  const n = parseInt(str(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function bool(v: FormDataEntryValue | null | undefined) {
  return v === "on" || v === "true" || v === "1";
}

export function lines(v: FormDataEntryValue | null | undefined) {
  return str(v)
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function phoneValid(phone: string) {
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length >= 7 && digits.length <= 14;
}
