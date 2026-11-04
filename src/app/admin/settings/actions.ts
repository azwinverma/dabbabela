"use server";

import type { PaymentMethod, Weekday } from "@prisma/client";
import { audit } from "@/lib/audit";
import { done, type ActionResult } from "@/lib/action";
import { getSettings, saveSettings, DEFAULT_FLAGS, type FeatureFlags, type SiteSettings } from "@/lib/settings";
import { WEEKDAYS } from "@/lib/dates";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

const METHODS: PaymentMethod[] = ["ESEWA", "KHALTI", "BANK_TRANSFER", "CASH", "COMPANY_INVOICE", "WALLET"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function updateSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("settings.edit", async (user) => {
    const before = await getSettings();
    const brandName = f.str(fd, "brandName", 60);
    if (!brandName) throw new FieldError("brandName", "Brand name is required");
    const orderCutoff = f.str(fd, "orderCutoff");
    if (!TIME.test(orderCutoff)) throw new FieldError("orderCutoff", "Use HH:MM, e.g. 09:30");
    const deliveryDays = WEEKDAYS.filter((d) => f.bool(fd, `day_${d}`)) as Weekday[];
    if (!deliveryDays.length) throw new FieldError("deliveryDays", "Pick at least one delivery day");
    const whatsapp = f.str(fd, "whatsapp", 20).replace(/\D/g, "");
    const flags = Object.fromEntries((Object.keys(DEFAULT_FLAGS) as (keyof FeatureFlags)[]).map((k) => [k, f.bool(fd, `flag_${k}`)])) as FeatureFlags;
    if (flags.phoneOtp && !(process.env.SMS_PROVIDER && process.env.SMS_PROVIDER !== "console")) {
      if (process.env.NODE_ENV === "production") throw new FieldError("flag_phoneOtp", "Phone OTP needs an SMS provider (SMS_PROVIDER) first");
    }
    const patch: Partial<SiteSettings> = {
      brandName,
      brandNameNe: f.str(fd, "brandNameNe", 60),
      legalName: f.str(fd, "legalName", 120),
      tagline: f.str(fd, "tagline", 160),
      taglineNe: f.str(fd, "taglineNe", 160),
      phone: f.str(fd, "phone", 30),
      whatsapp,
      email: f.str(fd, "email", 120),
      address: f.str(fd, "address", 200),
      hours: f.str(fd, "hours", 120),
      panVat: f.str(fd, "panVat", 20),
      orderCutoff,
      advanceDays: f.int(fd, "advanceDays", 28, 1, 120),
      deliveryDays,
      minOrderAmount: f.money(fd, "minOrderAmount", "Minimum order"),
      freeDeliveryAbove: f.money(fd, "freeDeliveryAbove", "Free delivery above"),
      skipPolicy: f.str(fd, "skipPolicy") === "CREDIT" ? "CREDIT" : "EXTEND",
      cancelBeforeCutoff: f.str(fd, "cancelBeforeCutoff") === "FULL_REFUND" ? "FULL_REFUND" : "FULL_CREDIT",
      paymentMethods: Object.fromEntries(METHODS.map((m) => [m, f.bool(fd, `pm_${m}`)])) as Record<PaymentMethod, boolean>,
      bankDetails: f.str(fd, "bankDetails", 600),
      qrImage: f.str(fd, "qrImage", 500),
      facebook: f.str(fd, "facebook", 200),
      instagram: f.str(fd, "instagram", 200),
      tiktok: f.str(fd, "tiktok", 200),
      seoTitle: f.str(fd, "seoTitle", 120),
      seoDescription: f.str(fd, "seoDescription", 320),
      ogImage: f.str(fd, "ogImage", 500),
      notifyEmail: f.str(fd, "notifyEmail", 120),
      maintenanceMode: f.bool(fd, "maintenanceMode"),
      maintenanceMessage: f.str(fd, "maintenanceMessage", 300),
      flags,
    };
    const after = await saveSettings(patch);
    const changed = Object.keys(patch).filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((after as Record<string, unknown>)[k]));
    await audit({
      actorId: user.id,
      action: "settings.update",
      entity: "Setting",
      entityId: "site",
      summary: changed.length ? `Changed: ${changed.join(", ")}` : "No changes",
      before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]])),
      after: Object.fromEntries(changed.map((k) => [k, (after as Record<string, unknown>)[k]])),
    });
    return done(changed.length ? `Saved (${changed.length} change${changed.length > 1 ? "s" : ""})` : "Nothing changed");
  }, ["/admin/settings", "/"]);
}
