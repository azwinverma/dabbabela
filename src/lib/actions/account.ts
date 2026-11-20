"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n";
import { done, fail, type ActionResult } from "@/lib/action";
import { str, bool } from "@/lib/utils";
import { updatePreferences, updateProfile, saveNotificationPrefs, requestDeletion } from "@/server/profile";
import { archiveAddress, saveAddress, setDefaultAddress } from "@/server/addresses";
import { createTicket, replyTicket, TICKET_CATEGORIES } from "@/server/support";
import { cancelOrder, OrderError } from "@/server/orders";
import { skipMeal, unskipMeal, pauseSubscription, resumeSubscription, cancelSubscription, changePlanAddress } from "@/server/subscriptions";

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
  const r = await updateProfile(user, { name: str(fd.get("name")), phone: str(fd.get("phone")), email: str(fd.get("email")), locale: str(fd.get("locale")), marketingOptIn: bool(fd.get("marketingOptIn")) });
  if (!r.ok) return fail(r.message, r.errors);
  if (r.locale) (await cookies()).set(LOCALE_COOKIE, r.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/account", "layout");
  return done(r.message);
}

export async function updatePreferencesAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/profile");
  const r = await updatePreferences(user.id, {
    diet: str(fd.get("diet")),
    spiceTolerance: str(fd.get("spiceTolerance")),
    allergies: fd.getAll("allergies").map(String),
    avoidOnionGarlic: bool(fd.get("avoidOnionGarlic")),
    dietaryNotes: str(fd.get("dietaryNotes")),
  });
  revalidatePath("/account/profile");
  return done(r.message);
}

export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const u = await getCurrentUser();
  if (u) await db.user.update({ where: { id: u.id }, data: { locale } });
  revalidatePath("/", "layout");
}

// ───────── addresses ─────────

export type AddressResult = ActionResult & { addressId?: string; covered?: boolean; zoneName?: string | null };

const ADDRESS_FIELDS = ["label", "type", "recipientName", "phone", "placeName", "line1", "area", "ward", "municipality", "city", "landmark", "instructions", "lat", "lng"] as const;

export async function saveAddressAction(_: AddressResult, fd: FormData): Promise<AddressResult> {
  const user = await me("/account/addresses");
  const raw = Object.fromEntries(ADDRESS_FIELDS.map((k) => [k, fd.get(k)]));
  const r = await saveAddress(user, raw, { id: str(fd.get("id")) || null, isDefault: bool(fd.get("isDefault")) });
  if (!r.ok) return fail(r.message ?? "Check the highlighted fields", r.errors);
  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  return { ok: true, addressId: r.addressId, covered: r.covered, zoneName: r.zoneName, message: r.message };
}

export async function deleteAddressAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/addresses");
  const r = await archiveAddress(user, str(fd.get("id")));
  if (!r.ok) return fail(r.message);
  revalidatePath("/account/addresses");
  return done(r.message);
}

export async function setDefaultAddressAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/addresses");
  const r = await setDefaultAddress(user, str(fd.get("id")));
  if (!r.ok) return fail(r.message);
  revalidatePath("/account/addresses");
  return done(r.message);
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
  await saveNotificationPrefs(user.id, (key) => bool(fd.get(key)));
  return done("Notification settings saved");
}

// ───────── privacy ─────────

export async function requestDeletionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me("/account/privacy");
  const r = await requestDeletion(user.id, { confirm: str(fd.get("confirm")), note: str(fd.get("note")) });
  if (!r.ok) return fail(r.message, r.errors);
  revalidatePath("/account/privacy");
  return done(r.message);
}
