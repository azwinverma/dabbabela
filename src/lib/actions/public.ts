"use server";

import { z } from "zod";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/action";
import { getSettings } from "@/lib/settings";
import { str, intOr } from "@/lib/utils";
import { isNepalPhone, normalizeNepalPhone } from "@/lib/phone";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { createTicket } from "@/server/support";
import { notify } from "@/server/notify";
import { log } from "@/lib/logger";

/** Per-IP form limiter backed by Postgres (works across serverless instances). */
async function allow(bucket: string, max: number, windowMs: number) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
  const key = `form:${bucket}:${ip}`;
  const now = Date.now();
  try {
    const row = await db.rateLimit.findUnique({ where: { key } });
    if (!row || now - Number(row.lastRequest) > windowMs) {
      await db.rateLimit.upsert({ where: { key }, create: { key, count: 1, lastRequest: BigInt(now) }, update: { count: 1, lastRequest: BigInt(now) } });
      return true;
    }
    if (row.count >= max) return false;
    await db.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return true;
  } catch (e) {
    log.warn("ratelimit.failed", { bucket, error: e });
    return true;
  }
}

const TOO_MANY: ActionResult = { ok: false, message: "That's a lot of messages in a short time — please try again in a few minutes." };

function errorsOf(issues: z.ZodIssue[]) {
  const errors: Record<string, string> = {};
  issues.forEach((i) => (errors[String(i.path[0])] = i.message));
  return errors;
}

async function alertTeam(subject: string, summary: string) {
  const s = await getSettings();
  if (s.notifyEmail) void notify("ticket.reply", { email: s.notifyEmail }, { subject, preview: summary });
}

// ───────────── language ─────────────

export async function setLocaleAction(fd: FormData) {
  const locale = str(fd.get("locale"));
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

// ───────────── team / corporate lead ─────────────

const leadSchema = z.object({
  companyName: z.string().trim().min(2, "Your organisation's name").max(120),
  contactName: z.string().trim().min(2, "Your name").max(120),
  email: z.string().trim().email("A valid email"),
  phone: z.string().refine(isNepalPhone, "A Nepal phone number, e.g. 98XXXXXXXX"),
  location: z.string().max(160).optional(),
  message: z.string().max(2000).optional(),
});

export async function leadAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  if (str(fd.get("website"))) return { ok: true, message: "Thanks!" }; // honeypot
  if (!(await allow("lead", 5, 10 * 60_000))) return TOO_MANY;
  const parsed = leadSchema.safeParse({
    companyName: str(fd.get("companyName")),
    contactName: str(fd.get("contactName")),
    email: str(fd.get("email")).toLowerCase(),
    phone: str(fd.get("phone")),
    location: str(fd.get("location")) || undefined,
    message: str(fd.get("message")) || undefined,
  });
  if (!parsed.success) return { ok: false, message: "A few details need fixing.", errors: errorsOf(parsed.error.issues) };
  const headcount = intOr(fd.get("headcount"), 0) || null;
  const mealsPerWeek = intOr(fd.get("mealsPerWeek"), 0) || null;
  const wants = str(fd.get("billing"));
  const trial = fd.get("trial") === "on";
  const message = [parsed.data.message, wants && `Preferred billing: ${wants}`, trial && "Would like a free tasting"].filter(Boolean).join("\n");
  await db.corporateLead.create({
    data: { ...parsed.data, phone: normalizeNepalPhone(parsed.data.phone) ?? parsed.data.phone, message: message || null, headcount, mealsPerWeek, budget: str(fd.get("budget")) || null, source: "website" },
  });
  await alertTeam(`New team enquiry: ${parsed.data.companyName}`, `${parsed.data.contactName} · ${headcount ?? "?"} people · ${parsed.data.location ?? ""}`);
  return { ok: true, message: "Dhanyabad! We'll call you within one working day to talk about your team and a tasting." };
}

// ───────────── contact form → ContactMessage + SupportTicket ─────────────

const contactSchema = z.object({
  name: z.string().trim().min(2, "Your name").max(120),
  email: z.string().trim().email("A valid email"),
  phone: z.string().optional().refine((v) => !v || isNepalPhone(v), "A Nepal phone number"),
  subject: z.string().max(160).optional(),
  category: z.string().max(20).optional(),
  message: z.string().trim().min(5, "A short message").max(4000),
});

export async function contactAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  if (str(fd.get("website"))) return { ok: true, message: "Thanks!" };
  if (!(await allow("contact", 4, 10 * 60_000))) return TOO_MANY;
  const parsed = contactSchema.safeParse({
    name: str(fd.get("name")),
    email: str(fd.get("email")).toLowerCase(),
    phone: str(fd.get("phone")) || undefined,
    subject: str(fd.get("subject")) || undefined,
    category: str(fd.get("category")) || undefined,
    message: str(fd.get("message")),
  });
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", errors: errorsOf(parsed.error.issues) };
  const d = parsed.data;
  const phone = d.phone ? normalizeNepalPhone(d.phone) : null;
  const ticket = await createTicket({ name: d.name, email: d.email, phone, subject: d.subject || "Website message", body: d.message, category: d.category, source: "contact_form" });
  await db.contactMessage.create({ data: { name: d.name, email: d.email, phone, subject: d.subject || null, message: d.message, ticketId: ticket.id } });
  await alertTeam(`Website message from ${d.name}`, d.message.slice(0, 140));
  return { ok: true, message: `Got it — your reference is ${ticket.number}. We reply on working days, usually within a few hours.` };
}

// ───────────── coverage request ─────────────

export async function areaRequestAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  if (str(fd.get("website"))) return { ok: true, message: "Thanks!" };
  if (!(await allow("area", 4, 10 * 60_000))) return TOO_MANY;
  const area = str(fd.get("area"));
  const name = str(fd.get("name"));
  const email = str(fd.get("email")).toLowerCase();
  const phone = str(fd.get("phone"));
  const errors: Record<string, string> = {};
  if (area.length < 2) errors.area = "Which area?";
  if (name.length < 2) errors.name = "Your name";
  if (!z.string().email().safeParse(email).success) errors.email = "A valid email";
  if (phone && !isNepalPhone(phone)) errors.phone = "A Nepal phone number";
  if (Object.keys(errors).length) return { ok: false, message: "Please fix the highlighted fields.", errors };
  const people = intOr(fd.get("people"), 0);
  const ticket = await createTicket({
    name,
    email,
    phone: phone ? normalizeNepalPhone(phone) : null,
    subject: `Area request: ${area}`,
    body: `Please deliver to ${area}.${people ? ` About ${people} people would order.` : ""}\n${str(fd.get("note"))}`.trim(),
    category: "GENERAL",
    source: "contact_form",
  });
  return { ok: true, message: `Thanks — we've noted ${area} (ref ${ticket.number}). We'll email you when it's on our route.` };
}

// ───────────── newsletter ─────────────

export async function subscribeAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  if (str(fd.get("website"))) return { ok: true, message: "Thanks!" };
  if (!(await allow("newsletter", 5, 10 * 60_000))) return TOO_MANY;
  const email = str(fd.get("email")).toLowerCase();
  if (!z.string().email().safeParse(email).success) return { ok: false, message: "Enter a valid email", errors: { email: "A valid email" } };
  if (fd.get("consent") !== "on") return { ok: false, message: "Tick the box to agree to receive menu emails", errors: { consent: "Required" } };
  await db.subscriber.upsert({ where: { email }, create: { email, source: str(fd.get("source")) || "website" }, update: { unsubscribedAt: null, consentAt: new Date() } });
  return { ok: true, message: "You're on the list. One email a week, no spam." };
}
