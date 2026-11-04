import { unstable_cache, revalidateTag } from "next/cache";
import type { PaymentMethod, Weekday } from "@prisma/client";
import { db } from "./db";

export type FeatureFlags = {
  phoneOtp: boolean; // SMS OTP sign-in (needs an SMS provider)
  staff2fa: boolean; // require TOTP for staff accounts
  wallet: boolean; // credit wallet as a payment method
  corporatePortal: boolean;
  deliveryOtp: boolean; // riders confirm hand-off with the customer's 4-digit code
  deliveryPhoto: boolean;
  newsletter: boolean;
  feedback: boolean;
  nepaliDates: boolean; // show Bikram Sambat dates (off until a tested library is added)
};

export type SiteSettings = {
  brandName: string;
  brandNameNe: string;
  legalName: string;
  tagline: string;
  taglineNe: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  hours: string;
  panVat: string;
  /** Same-day cut-off (HH:mm Kathmandu). Changes after this are refused for that day. */
  orderCutoff: string;
  /** Days ahead customers can book. */
  advanceDays: number;
  deliveryDays: Weekday[];
  minOrderAmount: number; // paisa per delivery day
  freeDeliveryAbove: number; // paisa per delivery day; 0 = never free by amount
  /** What a plan skip gives back: EXTEND = meal added at the end, CREDIT = meal value to wallet. */
  skipPolicy: "EXTEND" | "CREDIT";
  cancelBeforeCutoff: "FULL_CREDIT" | "FULL_REFUND";
  paymentMethods: Record<PaymentMethod, boolean>;
  bankDetails: string;
  qrImage: string;
  facebook: string;
  instagram: string;
  tiktok: string;
  seoTitle: string;
  seoDescription: string;
  ogImage: string;
  notifyEmail: string;
  builderMinPrice: number; // paisa — no Build-a-Dabba can cost less than this
  builderMaxQty: number;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  flags: FeatureFlags;
};

export const DEFAULT_FLAGS: FeatureFlags = {
  phoneOtp: false,
  staff2fa: true,
  wallet: true,
  corporatePortal: true,
  deliveryOtp: true,
  deliveryPhoto: false,
  newsletter: true,
  feedback: true,
  nepaliDates: false,
};

export const DEFAULT_SETTINGS: SiteSettings = {
  brandName: "Dabba Bela",
  brandNameNe: "डब्बा बेला",
  legalName: "Dabba Bela Pvt. Ltd. (registration pending)",
  tagline: "Your Lunch. Your Way. Ghar Ko Swad.",
  taglineNe: "घरको स्वाद, हरेक दिउँसो।",
  phone: "",
  whatsapp: "",
  email: "hello@example.com",
  address: "Kathmandu",
  hours: "Sun – Fri · 7:00 AM – 3:00 PM",
  panVat: "",
  orderCutoff: "09:30",
  advanceDays: 28,
  deliveryDays: ["SUN", "MON", "TUE", "WED", "THU", "FRI"],
  minOrderAmount: 0,
  freeDeliveryAbove: 100000,
  skipPolicy: "EXTEND",
  cancelBeforeCutoff: "FULL_CREDIT",
  paymentMethods: { ESEWA: true, KHALTI: true, BANK_TRANSFER: true, CASH: true, COMPANY_INVOICE: true, WALLET: true },
  bankDetails: "",
  qrImage: "",
  facebook: "",
  instagram: "",
  tiktok: "",
  seoTitle: "Dabba Bela — home-style lunch dabbas delivered across Kathmandu",
  seoDescription:
    "A weekly-changing menu of dal bhat, choila rolls, noodles and more, cooked each morning and delivered at lunchtime to your office, shop, college or home in Kathmandu. Order a day or plan your week.",
  ogImage: "",
  notifyEmail: "",
  builderMinPrice: 15000,
  builderMaxQty: 3,
  maintenanceMode: false,
  maintenanceMessage: "We are restocking the kitchen. Ordering opens again shortly.",
  flags: DEFAULT_FLAGS,
};

const KEY = "site";

export function mergeSettings(stored: Partial<SiteSettings> | null | undefined): SiteSettings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    paymentMethods: { ...DEFAULT_SETTINGS.paymentMethods, ...(s.paymentMethods ?? {}) },
    flags: { ...DEFAULT_FLAGS, ...(s.flags ?? {}) },
  };
}

async function loadSettings(): Promise<SiteSettings> {
  try {
    const row = await db.setting.findUnique({ where: { key: KEY } });
    return mergeSettings(row?.value as Partial<SiteSettings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const cached = unstable_cache(loadSettings, ["site-settings-v2"], { tags: ["settings"], revalidate: 300 });

/** Cached in Next; direct DB read in scripts/tests (no Next incremental cache there). */
export async function getSettings(): Promise<SiteSettings> {
  if (process.env.VITEST || process.env.SCRIPT_CONTEXT) return loadSettings();
  return cached();
}

export async function saveSettings(patch: Partial<SiteSettings>) {
  const current = await loadSettings();
  const value = mergeSettings({ ...current, ...patch, flags: { ...current.flags, ...(patch.flags ?? {}) } });
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  try {
    revalidateTag("settings");
  } catch {
    /* outside Next (scripts) */
  }
  return value;
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  ESEWA: "eSewa",
  KHALTI: "Khalti",
  BANK_TRANSFER: "Bank transfer / Fonepay QR",
  CASH: "Cash on delivery",
  COMPANY_INVOICE: "Bill my company (monthly invoice)",
  WALLET: "Dabba Bela credit",
};
