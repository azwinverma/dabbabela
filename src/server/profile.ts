import "server-only";
import { z } from "zod";
import type { DietPreference } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isLocale } from "@/lib/i18n";
import { isNepalMobile, normalizeNepalPhone } from "@/lib/phone";
import { PREF_CHANNELS, PREF_TOPICS } from "@/lib/actions/account-constants";

/**
 * Customer profile rules shared by the web account actions (src/lib/actions/account.ts) and the mobile API
 * (/api/v1/profile, /api/v1/privacy). The web action keeps its own cookie/revalidate side effects.
 */

export type ProfileResult = { ok: boolean; message: string; errors?: Record<string, string>; locale?: string };

type ProfileOwner = { id: string; email: string; phoneNumber: string | null };

export async function updateProfile(user: ProfileOwner, input: { name: string; phone: string; email: string; locale: string; marketingOptIn: boolean }): Promise<ProfileResult> {
  const name = input.name.trim();
  const phoneRaw = input.phone.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) return { ok: false, message: "Enter your name", errors: { name: "Required" } };
  let phone: string | null = user.phoneNumber;
  if (phoneRaw) {
    if (!isNepalMobile(phoneRaw)) return { ok: false, message: "Enter a Nepal mobile number", errors: { phone: "98/97/96 + 8 digits" } };
    phone = normalizeNepalPhone(phoneRaw);
    const taken = await db.user.findFirst({ where: { phoneNumber: phone, id: { not: user.id } } });
    if (taken) return { ok: false, message: "That number is on another account", errors: { phone: "Already registered" } };
  }
  const data: { name: string; phoneNumber: string | null; marketingOptIn: boolean; locale?: string; email?: string } = { name: name.slice(0, 80), phoneNumber: phone, marketingOptIn: input.marketingOptIn };
  if (isLocale(input.locale)) data.locale = input.locale;
  // Phone-only accounts start with a placeholder email and may set a real one once.
  if (email && user.email.endsWith("@phone.dabbabela.local")) {
    if (!z.string().email().safeParse(email).success) return { ok: false, message: "Enter a valid email", errors: { email: "Invalid" } };
    if (await db.user.findUnique({ where: { email } })) return { ok: false, message: "That email is on another account", errors: { email: "Taken" } };
    data.email = email;
  }
  if (phone !== user.phoneNumber) await db.user.update({ where: { id: user.id }, data: { phoneNumberVerified: false } });
  await db.user.update({ where: { id: user.id }, data });
  return { ok: true, message: "Profile saved", locale: data.locale };
}

const DIETS: DietPreference[] = ["ANY", "VEG", "EGG_OK", "VEGAN"];

export async function updatePreferences(userId: string, input: { diet: string; spiceTolerance: string | number | null | undefined; allergies: string[]; avoidOnionGarlic: boolean; dietaryNotes: string }): Promise<ProfileResult> {
  const spice = Math.max(0, Math.min(4, parseInt(String(input.spiceTolerance ?? "") || "2", 10)));
  const codes = new Set((await db.allergen.findMany({ select: { code: true } })).map((a) => a.code));
  const allergies = input.allergies.map(String).filter((c) => codes.has(c));
  await db.user.update({
    where: { id: userId },
    data: {
      diet: DIETS.includes(input.diet as DietPreference) ? (input.diet as DietPreference) : "ANY",
      spiceTolerance: Number.isFinite(spice) ? spice : 2,
      allergies,
      avoidOnionGarlic: input.avoidOnionGarlic,
      dietaryNotes: input.dietaryNotes.trim().slice(0, 300) || null,
    },
  });
  return { ok: true, message: allergies.length ? "Saved. Your allergies will be printed on every dabba label." : "Food preferences saved" };
}

export type PrefKey = `${(typeof PREF_TOPICS)[number]}:${(typeof PREF_CHANNELS)[number]}`;

/** Save every topic × channel switch (missing = off), and marketing opt-in from the marketing email/SMS switches. */
export async function saveNotificationPrefs(userId: string, enabled: (key: PrefKey) => boolean) {
  for (const topic of PREF_TOPICS)
    for (const channel of PREF_CHANNELS) {
      const on = enabled(`${topic}:${channel}`);
      await db.notificationPreference.upsert({
        where: { userId_topic_channel: { userId, topic, channel } },
        create: { userId, topic, channel, enabled: on },
        update: { enabled: on },
      });
    }
  await db.user.update({ where: { id: userId }, data: { marketingOptIn: enabled("MARKETING:EMAIL") || enabled("MARKETING:SMS") } });
}

/** Default when no row is stored — same rule as the Account → Notifications form. */
export function prefDefault(topic: string, channel: string, marketingOptIn: boolean) {
  return topic === "MARKETING" ? marketingOptIn && channel !== "SMS" : channel !== "SMS" || topic === "ORDER_UPDATES";
}

/** Current switches (stored rows, else the form's defaults). */
export async function notificationPrefs(userId: string, marketingOptIn: boolean) {
  const rows = await db.notificationPreference.findMany({ where: { userId } });
  const out: { topic: string; channel: string; enabled: boolean }[] = [];
  for (const topic of PREF_TOPICS)
    for (const channel of PREF_CHANNELS) {
      const r = rows.find((x) => x.topic === topic && x.channel === channel);
      out.push({ topic, channel, enabled: r ? r.enabled : prefDefault(topic, channel, marketingOptIn) });
    }
  return out;
}

/** Customer asks for their account to be deleted (handled by staff within 7 days). */
export async function requestDeletion(userId: string, input: { confirm: string; note?: string | null }): Promise<ProfileResult> {
  if (input.confirm.trim().toUpperCase() !== "DELETE") return { ok: false, message: "Type DELETE to confirm", errors: { confirm: "Type DELETE" } };
  const open = await db.dataRequest.findFirst({ where: { userId, type: "DELETE", status: "OPEN" } });
  if (open) return { ok: false, message: "You already have a deletion request open — we'll be in touch" };
  await db.dataRequest.create({ data: { userId, type: "DELETE", note: (input.note ?? "").trim().slice(0, 500) || null } });
  await audit({ actorId: userId, action: "privacy.delete_requested", entity: "User", entityId: userId });
  return { ok: true, message: "Request received. We'll confirm by email within 7 days. Order and tax records we must keep by law are anonymised, not deleted." };
}
