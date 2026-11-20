import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { iso, readJson } from "@/server/api/http";
import { throwIfFailed } from "@/server/api/customer-dto";
import { updateProfile } from "@/server/profile";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function profileOf(userId: string) {
  const u = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, phoneNumber: true, phoneNumberVerified: true, locale: true, marketingOptIn: true, diet: true, spiceTolerance: true, allergies: true, avoidOnionGarlic: true, dietaryNotes: true, createdAt: true },
  });
  const placeholder = u.email.endsWith("@phone.dabbabela.local");
  return {
    id: u.id,
    name: u.name,
    email: placeholder ? null : u.email,
    /** Phone-only accounts may set a real email once (PATCH email). */
    canSetEmail: placeholder,
    phone: u.phoneNumber,
    phoneVerified: Boolean(u.phoneNumberVerified),
    locale: u.locale,
    marketingOptIn: u.marketingOptIn,
    preferences: { diet: u.diet, spiceTolerance: u.spiceTolerance, allergies: u.allergies, avoidOnionGarlic: u.avoidOnionGarlic, dietaryNotes: u.dietaryNotes },
    createdAt: iso(u.createdAt),
  };
}

/** The caller's profile and food preferences. */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => profileOf(user.id));

const patchSchema = z.object({
  name: z.string().max(80).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().max(200).optional(),
  locale: z.enum(["en", "ne"]).optional(),
  marketingOptIn: z.boolean().optional(),
});

/**
 * Update name / Nepal mobile / language / marketing opt-in (same rules as Account → Profile). Omitted fields keep
 * their value. Changing the phone clears its verified flag.
 */
export const PATCH = apiRoute({ auth: "user", limit: "write" }, async ({ req, user }) => {
  const b = await readJson(req, patchSchema);
  const r = await updateProfile(user, {
    name: b.name ?? user.name,
    phone: b.phone ?? user.phoneNumber ?? "",
    email: b.email ?? "",
    locale: b.locale ?? user.locale,
    marketingOptIn: b.marketingOptIn ?? user.marketingOptIn,
  });
  throwIfFailed(r);
  return { message: r.message, profile: await profileOf(user.id) };
});
