"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AddressType, DietPreference } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { isNepalPhone, normalizeNepalPhone, isNepalMobile } from "@/lib/phone";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n";
import { done, fail, type ActionResult } from "@/lib/action";
import { str, bool } from "@/lib/utils";
import { findZone } from "@/server/coverage";
import { createTicket, replyTicket, TICKET_CATEGORIES } from "@/server/support";
import { cancelOrder, OrderError } from "@/server/orders";
import { skipMeal, unskipMeal, pauseSubscription, resumeSubscription, cancelSubscription, changePlanAddress } from "@/server/subscriptions";
import { audit } from "@/lib/audit";
import { PREF_CHANNELS, PREF_TOPICS } from "./account-constants";

async function me(next = "/account"): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  return u;
}

function msg(e: unknown, fallback = "Something went wrong — try again") {
  if (e instanceof OrderError) return e.message;
  if (e instanceof Error && e.message && e.message.length < 200 && !e.message.includes("prisma")) return e.message;
  return fallback;
}

// ───────── profile ─────────

export async function updateProfileAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/profile");
  const name = str(fd.get("name"));
  const phoneRaw = str(fd.get("phone"));
  const email = str(fd.get("email")).toLowerCase();
  const locale = str(fd.get("locale"));
  if (name.length < 2) return fail("Enter your name", { name: "Required" });
  let phone: string | null = user.phoneNumber;
  if (phoneRaw) {
    if (!isNepalMobile(phoneRaw)) return fail("Enter a Nepal mobile number", { phone: "98/97/96 + 8 digits" });
    phone = normalizeNepalPhone(phoneRaw);
    const taken = await db.user.findFirst({ where: { phoneNumber: phone, id: { not: user.id } } });
    if (taken) return fail("That number is on another account", { phone: "Already registered" });
  }
  const data: { name: string; phoneNumber: string | null; marketingOptIn: boolean; locale?: string; email?: string } = { name: name.slice(0, 80), phoneNumber: phone, marketingOptIn: bool(fd.get("marketingOptIn")) };
  if (isLocale(locale)) {
    data.locale = locale;
    (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  // Phone-only accounts start with a placeholder email and may set a real one once.
  if (email && user.email.endsWith("@phone.dabbabela.local")) {
    if (!z.string().email().safeParse(email).success) return fail("Enter a valid email", { email: "Invalid" });
    if (await db.user.findUnique({ where: { email } })) return fail("That email is on another account", { email: "Taken" });
    data.email = email;
  }
  if (phone !== user.phoneNumber) await db.user.update({ where: { id: user.id }, data: { phoneNumberVerified: false } });
  await db.user.update({ where: { id: user.id }, data });
  revalidatePath("/account", "layout");
  return done("Profile saved");
}

const DIETS: DietPreference[] = ["ANY", "VEG", "EGG_OK", "VEGAN"];

export async function updatePreferencesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/profile");
  const diet = str(fd.get("diet")) as DietPreference;
  const spice = Math.max(0, Math.min(4, parseInt(str(fd.get("spiceTolerance")) || "2", 10)));
  const codes = new Set((await db.allergen.findMany({ select: { code: true } })).map((a) => a.code));
  const allergies = fd.getAll("allergies").map(String).filter((c) => codes.has(c));
  await db.user.update({
    where: { id: user.id },
    data: {
      diet: DIETS.includes(diet) ? diet : "ANY",
      spiceTolerance: spice,
      allergies,
      avoidOnionGarlic: bool(fd.get("avoidOnionGarlic")),
      dietaryNotes: str(fd.get("dietaryNotes")).slice(0, 300) || null,
    },
  });
  revalidatePath("/account/profile");
  return done(allergies.length ? "Saved. Your allergies will be printed on every dabba label." : "Food preferences saved");
}

export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const u = await getCurrentUser();
  if (u) await db.user.update({ where: { id: u.id }, data: { locale } });
  revalidatePath("/", "layout");
}

// ───────── addresses ─────────

const TYPES: AddressType[] = ["HOME", "OFFICE", "SHOP", "COLLEGE", "SITE", "OTHER"];

const addressSchema = z.object({
  label: z.string().trim().min(1, "Give it a name").max(40),
  type: z.enum(["HOME", "OFFICE", "SHOP", "COLLEGE", "SITE", "OTHER"]),
  recipientName: z.string().trim().min(2, "Who receives it?").max(80),
  phone: z.string().trim().refine(isNepalPhone, "Enter a Nepal phone number"),
  placeName: z.string().trim().max(120).optional(),
  line1: z.string().trim().min(3, "Street, tole or building").max(200),
  area: z.string().trim().min(2, "Locality, e.g. Baneshwor").max(80),
  ward: z.coerce.number().int().min(1).max(40).optional(),
  municipality: z.string().trim().max(80).optional(),
  city: z.string().trim().min(2).max(60).default("Kathmandu"),
  landmark: z.string().trim().max(160).optional(),
  instructions: z.string().trim().max(300).optional(),
  lat: z.coerce.number().min(26).max(31).optional(),
  lng: z.coerce.number().min(80).max(89).optional(),
});

export type AddressResult = ActionResult & { addressId?: string; covered?: boolean; zoneName?: string | null };

export async function saveAddressAction(_: AddressResult, fd: FormData): Promise<AddressResult> {
  const user = await me("/account/addresses");
  const opt = (k: string) => str(fd.get(k)) || undefined;
  const parsed = addressSchema.safeParse({
    label: str(fd.get("label")) || "Address",
    type: TYPES.includes(str(fd.get("type")) as AddressType) ? str(fd.get("type")) : "OFFICE",
    recipientName: str(fd.get("recipientName")),
    phone: str(fd.get("phone")),
    placeName: opt("placeName"),
    line1: str(fd.get("line1")),
    area: str(fd.get("area")),
    ward: opt("ward"),
    municipality: opt("municipality"),
    city: opt("city") ?? "Kathmandu",
    landmark: opt("landmark"),
    instructions: opt("instructions"),
    lat: opt("lat"),
    lng: opt("lng"),
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    return fail("Check the highlighted fields", errors);
  }
  const d = parsed.data;
  const zone = await findZone({ area: d.area, ward: d.ward ?? null, municipality: d.municipality ?? null, city: d.city });
  const id = str(fd.get("id"));
  const makeDefault = bool(fd.get("isDefault")) || user.addresses.length === 0;
  const data = {
    ...d,
    phone: normalizeNepalPhone(d.phone)!,
    placeName: d.placeName ?? null,
    ward: d.ward ?? null,
    municipality: d.municipality ?? null,
    landmark: d.landmark ?? null,
    instructions: d.instructions ?? null,
    lat: d.lat ?? null,
    lng: d.lng ?? null,
    zoneId: zone?.id ?? null,
  };
  let addressId = id;
  if (id) {
    const own = user.addresses.find((a) => a.id === id);
    if (!own) return fail("Address not found");
    await db.address.update({ where: { id }, data });
  } else {
    if (user.addresses.length >= 10) return fail("You can keep up to 10 addresses — remove one first");
    addressId = (await db.address.create({ data: { ...data, userId: user.id } })).id;
  }
  if (makeDefault) {
    await db.address.updateMany({ where: { userId: user.id, id: { not: addressId } }, data: { isDefault: false } });
    await db.address.update({ where: { id: addressId }, data: { isDefault: true } });
  }
  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  return {
    ok: true,
    addressId,
    covered: Boolean(zone),
    zoneName: zone?.name ?? null,
    message: zone ? `Saved — we deliver here (${zone.name})` : `Saved. We don't deliver to ${d.area} yet — we'll let you know when we do.`,
  };
}

export async function deleteAddressAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/addresses");
  const id = str(fd.get("id"));
  if (!user.addresses.find((a) => a.id === id)) return fail("Address not found");
  // Archive (orders keep their snapshot); live plans keep delivering to it until moved.
  const live = await db.subscription.count({ where: { addressId: id, status: { in: ["ACTIVE", "PAUSED", "PENDING_PAYMENT"] } } });
  if (live) return fail("A meal plan still delivers here — move the plan to another address first");
  await db.address.update({ where: { id }, data: { archivedAt: new Date(), isDefault: false } });
  revalidatePath("/account/addresses");
  return done("Address removed");
}

export async function setDefaultAddressAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/addresses");
  const id = str(fd.get("id"));
  if (!user.addresses.find((a) => a.id === id)) return fail("Address not found");
  await db.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
  await db.address.update({ where: { id }, data: { isDefault: true } });
  revalidatePath("/account/addresses");
  return done("Default address updated");
}

// ───────── company ─────────

export async function joinCompanyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/profile");
  const code = str(fd.get("code")).toUpperCase();
  if (!code) return fail("Enter the code from your office");
  if (user.membership && user.membership.status !== "REMOVED") return fail(`You're already linked to ${user.membership.company.name}`);
  const company = await db.company.findFirst({ where: { joinCode: code, isActive: true } });
  if (!company) return fail("We don't recognise that code");
  const status = company.requireApproval ? "PENDING" : "ACTIVE";
  await db.companyMember.upsert({
    where: { userId: user.id },
    create: { companyId: company.id, userId: user.id, status },
    update: { companyId: company.id, status, role: "MEMBER" },
  });
  revalidatePath("/account", "layout");
  return done(status === "ACTIVE" ? `You're on the ${company.name} team` : `Request sent — a ${company.name} admin needs to approve it`);
}

export async function leaveCompanyAction(_: ActionResult): Promise<ActionResult> {
  const user = await me("/account/profile");
  if (!user.membership) return fail("You're not on a company account");
  if (user.membership.role === "ADMIN") {
    const admins = await db.companyMember.count({ where: { companyId: user.membership.companyId, role: "ADMIN", status: "ACTIVE" } });
    if (admins <= 1) return fail("You're the only admin — ask us to hand the account to someone else first");
  }
  await db.companyMember.update({ where: { userId: user.id }, data: { status: "REMOVED", role: "MEMBER" } });
  revalidatePath("/account", "layout");
  return done("You've left the company account. New orders use your own pricing.");
}

// ───────── meals & plans ─────────

const actor = (u: CurrentUser) => ({ id: u.id, isStaff: false });

export async function skipMealAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me();
  try {
    const r = await skipMeal(str(fd.get("orderId")), actor(user), user.id);
    revalidatePath("/account", "layout");
    return done(r.policy === "CREDIT" ? "Skipped — the meal's value is in your credit" : `Skipped — moved to ${r.moved.join(", ") || "the end of your plan"}`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function unskipMealAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me();
  try {
    await unskipMeal(str(fd.get("orderId")), actor(user), user.id);
    revalidatePath("/account", "layout");
    return done("Back on — we'll cook it");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function cancelOrderAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me();
  try {
    const r = await cancelOrder(str(fd.get("orderId")), actor(user), { reason: str(fd.get("reason")) || "Cancelled by customer", userId: user.id });
    revalidatePath("/account", "layout");
    return done(r.settlement === "CREDIT" ? "Cancelled — the amount is back in your credit" : r.settlement === "REFUND" ? "Cancelled — your refund is being processed" : "Cancelled");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function pausePlanAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/plans");
  try {
    const n = await pauseSubscription(str(fd.get("id")), actor(user), { userId: user.id, from: str(fd.get("from")) || undefined, reason: str(fd.get("reason")) || undefined });
    revalidatePath("/account", "layout");
    return done(`Paused — ${n} meal${n === 1 ? "" : "s"} on hold until you resume`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function resumePlanAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/plans");
  try {
    const n = await resumeSubscription(str(fd.get("id")), actor(user), { userId: user.id });
    revalidatePath("/account", "layout");
    return done(`Welcome back — ${n} meal${n === 1 ? "" : "s"} rescheduled`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function cancelPlanAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/plans");
  const reason = str(fd.get("reason"));
  if (reason.length < 3) return fail("Tell us briefly why — it helps us improve", { reason: "Required" });
  try {
    const r = await cancelSubscription(str(fd.get("id")), actor(user), { userId: user.id, reason });
    revalidatePath("/account", "layout");
    return done(`Plan cancelled. ${r.cancelled} upcoming meal${r.cancelled === 1 ? "" : "s"} removed${r.credit ? `; ${(r.credit / 100).toFixed(0)} rupees added to your credit` : ""}.`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function changePlanAddressAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/plans");
  try {
    const n = await changePlanAddress(str(fd.get("id")), user, str(fd.get("addressId")));
    revalidatePath("/account", "layout");
    return done(`${n} upcoming meal${n === 1 ? "" : "s"} will go to the new address`);
  } catch (e) {
    return fail(msg(e));
  }
}

// ───────── feedback & support ─────────

export async function feedbackAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me();
  const orderId = str(fd.get("orderId"));
  const order = await db.order.findFirst({ where: { id: orderId, userId: user.id, status: "DELIVERED" } });
  if (!order) return fail("You can rate a dabba after it's delivered");
  const rating = parseInt(str(fd.get("rating")), 10);
  if (!(rating >= 1 && rating <= 5)) return fail("Pick a rating from 1 to 5");
  const num = (k: string) => {
    const n = parseInt(str(fd.get(k)), 10);
    return n >= 1 && n <= 5 ? n : null;
  };
  const onTime = str(fd.get("onTime"));
  const data = {
    rating,
    taste: num("taste"),
    portion: num("portion"),
    onTime: onTime === "yes" ? true : onTime === "no" ? false : null,
    comment: str(fd.get("comment")).slice(0, 1000) || null,
    publishConsent: bool(fd.get("publishConsent")),
  };
  await db.feedback.upsert({ where: { orderId }, create: { orderId, userId: user.id, ...data }, update: data });
  revalidatePath(`/account/orders/${orderId}`);
  return done("Thank you — the kitchen reads every one");
}

export async function createTicketAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/support");
  const subject = str(fd.get("subject"));
  const body = str(fd.get("body"));
  if (subject.length < 3) return fail("Add a short subject", { subject: "Required" });
  if (body.length < 5) return fail("Tell us what happened", { body: "Required" });
  const category = str(fd.get("category"));
  try {
    const t = await createTicket({
      userId: user.id,
      name: user.name,
      email: user.email,
      phone: user.phoneNumber,
      orderId: str(fd.get("orderId")) || null,
      subject,
      body,
      category: (TICKET_CATEGORIES as readonly string[]).includes(category) ? category : "GENERAL",
      source: "account",
    });
    revalidatePath("/account/support");
    return done(`Ticket ${t.number} opened — we usually reply within working hours`, `/account/support/${t.id}`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function replyTicketAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/support");
  const id = str(fd.get("ticketId"));
  try {
    await replyTicket(id, actor(user), str(fd.get("body")));
    revalidatePath(`/account/support/${id}`);
    return done("Sent");
  } catch (e) {
    return fail(msg(e));
  }
}

// ───────── notifications ─────────

export async function markNotificationsReadAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/notifications");
  const id = str(fd.get("id"));
  await db.notification.updateMany({ where: { userId: user.id, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
  revalidatePath("/account", "layout");
  return done(id ? "Marked as read" : "All caught up");
}


export async function saveNotificationPrefsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/notifications");
  for (const topic of PREF_TOPICS)
    for (const channel of PREF_CHANNELS) {
      const enabled = bool(fd.get(`${topic}:${channel}`));
      await db.notificationPreference.upsert({
        where: { userId_topic_channel: { userId: user.id, topic, channel } },
        create: { userId: user.id, topic, channel, enabled },
        update: { enabled },
      });
    }
  await db.user.update({ where: { id: user.id }, data: { marketingOptIn: bool(fd.get("MARKETING:EMAIL")) || bool(fd.get("MARKETING:SMS")) } });
  return done("Notification settings saved");
}

// ───────── privacy ─────────

export async function requestDeletionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/privacy");
  if (str(fd.get("confirm")).toUpperCase() !== "DELETE") return fail('Type DELETE to confirm', { confirm: "Type DELETE" });
  const open = await db.dataRequest.findFirst({ where: { userId: user.id, type: "DELETE", status: "OPEN" } });
  if (open) return fail("You already have a deletion request open — we'll be in touch");
  await db.dataRequest.create({ data: { userId: user.id, type: "DELETE", note: str(fd.get("note")).slice(0, 500) || null } });
  await audit({ actorId: user.id, action: "privacy.delete_requested", entity: "User", entityId: user.id });
  revalidatePath("/account/privacy");
  return done("Request received. We'll confirm by email within 7 days. Order and tax records we must keep by law are anonymised, not deleted.");
}
