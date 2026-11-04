/**
 * Nepal phone numbers.
 * Mobile: 10 digits starting 96/97/98 (NTC, Ncell, Smart…), optional +977 / 977 / 0 prefix.
 * Landline: area code (1–2 digits after 0) + 6–7 digits, e.g. 01-4412345, 061-523456.
 */

export function normalizeNepalPhone(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+977")) d = d.slice(4);
  else if (d.startsWith("00977")) d = d.slice(5);
  else if (d.startsWith("977") && d.length >= 12) d = d.slice(3);
  d = d.replace(/\D/g, "");
  if (/^9[678]\d{8}$/.test(d)) return `+977${d}`;
  // landline: 0 + area code + number (8–9 digits total after the 0)
  if (/^0\d{7,9}$/.test(d)) return `+977${d.slice(1)}`;
  if (/^[1-8]\d{6,8}$/.test(d)) return `+977${d}`;
  return null;
}

export function isNepalMobile(input: string) {
  const n = normalizeNepalPhone(input);
  return Boolean(n && /^\+9779[678]\d{8}$/.test(n));
}

export function isNepalPhone(input: string) {
  return normalizeNepalPhone(input) !== null;
}

/** "+9779812345678" → "981-234-5678" */
export function formatNepalPhone(e164: string | null | undefined) {
  if (!e164) return "";
  const d = e164.replace(/^\+977/, "");
  if (/^9\d{9}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `0${d}`;
}

/** Mask for staff without PII access: 981-•••-•678 */
export function maskPhone(e164: string | null | undefined) {
  const f = formatNepalPhone(e164);
  if (f.length < 6) return f ? "•••" : "";
  return `${f.slice(0, 3)}-•••-•${f.slice(-3)}`;
}

export function maskEmail(email: string | null | undefined) {
  if (!email) return "";
  const [u, dom] = email.split("@");
  if (!dom) return "•••";
  return `${u.slice(0, 2)}•••@${dom}`;
}

/** wa.me link (WhatsApp click-to-chat fallback — no automated sends). */
export function whatsappLink(e164OrDigits: string, text?: string) {
  const digits = e164OrDigits.replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
