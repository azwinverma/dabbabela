"use server";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAPIError } from "better-auth/api";
import QRCode from "qrcode";
import { auth } from "@/server/auth";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { isStaffRole, staffHome } from "@/lib/permissions";
import { isNepalMobile, normalizeNepalPhone } from "@/lib/phone";
import { audit } from "@/lib/audit";
import { log } from "@/lib/logger";
import { done, fail, type ActionResult } from "@/lib/action";
import { str } from "@/lib/utils";
import { readAttribution } from "@/lib/attribution";
import { storeUserAttribution } from "@/server/crm";
import { afterRegister, preRegisterCheck, registerSchema } from "@/server/registration";
import { authLimitsOn, LIMITS, rateLimit, requestIp } from "@/lib/rate-limit";
import { checkTurnstile, TURNSTILE_FAILED } from "@/lib/turnstile";

const TOO_MANY = "Too many attempts — wait a few minutes and try again";

/**
 * Our own limits for the auth server actions: `auth.api.*` called from a server action skips Better Auth's HTTP
 * rate limiter, so without this the forms would be unlimited. Keys: per IP, and per account identifier when given.
 */
async function limited(name: keyof typeof LIMITS, ...ids: (string | null | undefined)[]) {
  if (!authLimitsOn()) return false;
  const { max, windowMs } = LIMITS[name];
  const ip = await requestIp();
  // Fail closed: a limiter outage must not open unlimited password / OTP / 2FA guessing (L2).
  if (!(await rateLimit(`auth:${name}:ip`, ip, name === "signInEmail" ? LIMITS.signIn.max : max, windowMs, { failClosed: true }))) return true;
  for (const id of ids) if (id && !(await rateLimit(`auth:${name}:id`, id.toLowerCase(), max, windowMs, { failClosed: true }))) return true;
  return false;
}

/** Stable id of the pending 2FA sign-in: a hash of Better Auth's signed two_factor cookie (never the raw value). */
async function twoFactorChallengeId() {
  const c = (await cookies()).getAll().find((x) => /two_factor$/.test(x.name));
  return c?.value ? `2fa:${createHash("sha256").update(c.value).digest("hex").slice(0, 32)}` : null;
}

/** Only same-site relative paths are allowed as ?next= targets. */
function safeNext(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

function authMessage(e: unknown, fallback: string) {
  if (isAPIError(e)) {
    const code = (e.body as { code?: string } | undefined)?.code ?? "";
    if (code.includes("INVALID_EMAIL_OR_PASSWORD")) return "That email and password don't match";
    if (code.includes("USER_ALREADY_EXISTS")) return "An account with this email already exists — log in instead";
    if (code.includes("PASSWORD_TOO_SHORT")) return "Use at least 8 characters";
    if (code.includes("INVALID_TOKEN")) return "This link has expired — ask for a new one";
    if (code.includes("INVALID_CODE") || code.includes("OTP")) return "That code isn't right or has expired";
    if (e.status === "TOO_MANY_REQUESTS" || e.statusCode === 429) return "Too many attempts — wait a minute and try again";
    if (code.includes("INVALID_PASSWORD")) return "Your current password isn't right";
    return (e.body as { message?: string } | undefined)?.message || fallback;
  }
  log.warn("auth.action_error", { error: e });
  return fallback;
}

/** First-touch attribution from the consented cookies onto a new account (stored once, never overwritten). Never throws. */
async function captureAttribution(userId: string) {
  try {
    await storeUserAttribution(userId, readAttribution(await cookies()));
  } catch (e) {
    log.warn("auth.attribution_failed", { error: e });
  }
}

async function landingFor(userId: string, next: string | null) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (u && isStaffRole(u.role)) return next && next.startsWith("/admin") ? next : staffHome(u.role);
  return next ?? "/account";
}

// ───────── sign in ─────────

export async function loginAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = str(fd.get("email")).toLowerCase();
  const password = String(fd.get("password") ?? "");
  const next = safeNext(str(fd.get("next")));
  if (!email || !password) return fail("Enter your email and password");
  if (await limited("signInEmail", email)) return fail(TOO_MANY);
  if (!(await checkTurnstile(fd, "login")).ok) return fail(TURNSTILE_FAILED);
  try {
    const res = (await auth.api.signInEmail({ body: { email, password, rememberMe: true }, headers: await headers() })) as {
      twoFactorRedirect?: boolean;
      user?: { id: string };
    };
    if (res.twoFactorRedirect) return { ok: true, message: "2fa", redirectTo: `/login?step=2fa${next ? `&next=${encodeURIComponent(next)}` : ""}` };
    if (!res.user) return fail("We couldn't log you in");
    return done("Welcome back", await landingFor(res.user.id, next));
  } catch (e) {
    return fail(authMessage(e, "We couldn't log you in"));
  }
}

export async function verifyTwoFactorAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const code = str(fd.get("code")).replace(/\s/g, "");
  const backup = fd.get("mode") === "backup";
  const next = safeNext(str(fd.get("next")));
  if (!code) return fail("Enter the code");
  // Per IP and per pending sign-in (the signed two_factor cookie identifies the user being verified), so rotating IPs
  // doesn't give an attacker more guesses at one account's code.
  if (await limited("twoFactor", await twoFactorChallengeId())) return fail(TOO_MANY);
  try {
    const h = await headers();
    const res = (backup
      ? await auth.api.verifyBackupCode({ body: { code }, headers: h })
      : await auth.api.verifyTOTP({ body: { code, trustDevice: false }, headers: h })) as { user?: { id: string }; token?: string };
    const userId = res.user?.id;
    return done("Verified", userId ? await landingFor(userId, next) : next ?? "/account");
  } catch (e) {
    return fail(authMessage(e, "That code isn't right"));
  }
}

export async function sendOtpAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await getSettings();
  if (!s.flags.phoneOtp) return fail("Mobile sign-in isn't available yet — use your email");
  const phone = normalizeNepalPhone(str(fd.get("phone")));
  if (!phone || !isNepalMobile(phone)) return fail("Enter a Nepal mobile number (98/97/96…)");
  if (await limited("otpSend", phone)) return fail(TOO_MANY);
  if (!(await checkTurnstile(fd, "otp")).ok) return fail(TURNSTILE_FAILED);
  try {
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone }, headers: await headers() });
    return { ok: true, message: `We sent a code to ${phone.replace(/^\+977/, "")}` };
  } catch (e) {
    return fail(authMessage(e, "We couldn't send a code"));
  }
}

export async function verifyOtpAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await getSettings();
  if (!s.flags.phoneOtp) return fail("Mobile sign-in isn't available yet");
  const phone = normalizeNepalPhone(str(fd.get("phone")));
  const code = str(fd.get("code"));
  const next = safeNext(str(fd.get("next")));
  if (!phone || !code) return fail("Enter your number and the code");
  if (await limited("otpVerify", phone)) return fail(TOO_MANY);
  try {
    const res = (await auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code }, headers: await headers() })) as { user?: { id: string; email?: string } };
    if (!res.user) return fail("That code isn't right");
    // New phone-only accounts get a placeholder email; send them to finish their profile.
    const fresh = res.user.email?.endsWith("@phone.dabbabela.local");
    if (fresh) await captureAttribution(res.user.id);
    return done("Signed in", fresh ? "/account/profile?welcome=1" : await landingFor(res.user.id, next));
  } catch (e) {
    return fail(authMessage(e, "That code isn't right"));
  }
}

// ───────── sign up ─────────

export async function registerAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = registerSchema.safeParse({
    name: str(fd.get("name")),
    email: str(fd.get("email")),
    phone: str(fd.get("phone")),
    password: String(fd.get("password") ?? ""),
    companyCode: str(fd.get("companyCode")) || undefined,
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    return fail("Check the highlighted fields", errors);
  }
  const d = parsed.data;
  if (await limited("signUp")) return fail(TOO_MANY);
  if (!(await checkTurnstile(fd, "register")).ok) return fail(TURNSTILE_FAILED);
  const check = await preRegisterCheck(d);
  if (!check.ok) return fail(check.message, { [check.field]: check.hint });

  let userId: string;
  try {
    const res = await auth.api.signUpEmail({ body: { name: d.name, email: d.email, password: d.password }, headers: await headers() });
    userId = res.user.id;
  } catch (e) {
    return fail(authMessage(e, "We couldn't create your account"));
  }
  // phone, company membership, ?ref=CODE referral claim — shared with the mobile API (best effort, never blocks sign-up)
  await afterRegister(userId, { phone: check.phone, company: check.company, ref: str(fd.get("ref")) });
  await captureAttribution(userId);
  const next = safeNext(str(fd.get("next")));
  return done("Account created", next ?? "/account?welcome=1");
}

export async function logoutAction() {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    /* already signed out */
  }
  redirect("/");
}

// ───────── password reset ─────────

export async function forgotAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = str(fd.get("email")).toLowerCase();
  if (!z.string().email().safeParse(email).success) return fail("Enter a valid email");
  if (await limited("reset", email)) return fail("Too many requests — try again in a few minutes");
  if (!(await checkTurnstile(fd, "reset")).ok) return fail(TURNSTILE_FAILED);
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" }, headers: await headers() });
  } catch (e) {
    if (isAPIError(e) && (e.statusCode === 429 || e.status === "TOO_MANY_REQUESTS")) return fail("Too many requests — try again in a few minutes");
    log.warn("auth.reset_request_failed", { error: e });
  }
  // Same answer whether or not the email exists.
  return done("If that email has an account, a reset link is on its way. Check spam too.");
}

export async function resetAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const token = str(fd.get("token"));
  const pw = String(fd.get("password") ?? "");
  const pw2 = String(fd.get("password2") ?? "");
  if (!token) return fail("This link is incomplete — ask for a new one");
  if (await limited("resetSubmit")) return fail(TOO_MANY);
  if (pw.length < 8) return fail("Use at least 8 characters", { password: "At least 8 characters" });
  if (pw !== pw2) return fail("The two passwords don't match", { password2: "Doesn't match" });
  try {
    await auth.api.resetPassword({ body: { newPassword: pw, token }, headers: await headers() });
  } catch (e) {
    return fail(authMessage(e, "This link has expired — ask for a new one"));
  }
  return done("Password saved — log in with your new password", "/login?reset=1");
}

// ───────── security (signed in) ─────────

async function me() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/security");
  return user;
}

export async function changePasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me();
  const current = String(fd.get("current") ?? "");
  const pw = String(fd.get("password") ?? "");
  if (pw.length < 8) return fail("Use at least 8 characters", { password: "At least 8 characters" });
  if (pw !== String(fd.get("password2") ?? "")) return fail("The two passwords don't match", { password2: "Doesn't match" });
  try {
    await auth.api.changePassword({ body: { currentPassword: current, newPassword: pw, revokeOtherSessions: true }, headers: await headers() });
  } catch (e) {
    return fail(authMessage(e, "We couldn't change your password"));
  }
  await audit({ actorId: user.id, action: "user.password_change", entity: "User", entityId: user.id });
  return done("Password changed. Other devices were signed out.");
}

export type TwoFactorState = ActionResult & { qr?: string; uri?: string; backupCodes?: string[]; step?: "verify" | "done" };

export async function enableTwoFactorAction(_: TwoFactorState, fd: FormData): Promise<TwoFactorState> {
  const user = await me();
  const password = String(fd.get("password") ?? "");
  if (!password) return fail("Enter your password to continue");
  try {
    const res = (await auth.api.enableTwoFactor({ body: { password }, headers: await headers() })) as { totpURI: string; backupCodes: string[] };
    const qr = await QRCode.toDataURL(res.totpURI, { margin: 1, width: 220, color: { dark: "#27221D", light: "#FFFFFF" } });
    await audit({ actorId: user.id, action: "user.2fa_started", entity: "User", entityId: user.id });
    return { ok: true, qr, uri: res.totpURI, backupCodes: res.backupCodes, step: "verify", message: "Scan the code, then enter the 6 digits it shows" };
  } catch (e) {
    return fail(authMessage(e, "We couldn't start two-step sign-in"));
  }
}

export async function confirmTwoFactorAction(prev: TwoFactorState, fd: FormData): Promise<TwoFactorState> {
  const user = await me();
  const code = str(fd.get("code")).replace(/\s/g, "");
  if (!code) return { ...prev, ok: false, message: "Enter the 6-digit code" };
  try {
    await auth.api.verifyTOTP({ body: { code }, headers: await headers() });
  } catch (e) {
    return { ...prev, ok: false, message: authMessage(e, "That code isn't right") };
  }
  await audit({ actorId: user.id, action: "user.2fa_enabled", entity: "User", entityId: user.id });
  revalidatePath("/account/security");
  return { ok: true, step: "done", backupCodes: prev.backupCodes, message: "Two-step sign-in is on. Save your backup codes somewhere safe." };
}

export async function disableTwoFactorAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me();
  const s = await getSettings();
  if (isStaffRole(user.role) && s.flags.staff2fa) return fail("Staff accounts must keep two-step sign-in on");
  try {
    await auth.api.disableTwoFactor({ body: { password: String(fd.get("password") ?? "") }, headers: await headers() });
  } catch (e) {
    return fail(authMessage(e, "We couldn't turn it off"));
  }
  await audit({ actorId: user.id, action: "user.2fa_disabled", entity: "User", entityId: user.id });
  return done("Two-step sign-in is off");
}

export async function revokeSessionAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await me();
  // Sessions are addressed by id; tokens never leave the server (they used to be rendered into the page).
  const sessionId = str(fd.get("sessionId")).slice(0, 64);
  const all = fd.get("all") === "1";
  const everywhere = fd.get("everywhere") === "1";
  try {
    if (everywhere) {
      const { count } = await db.session.deleteMany({ where: { userId: user.id } });
      await audit({ actorId: user.id, action: "user.sessions_revoke_all", entity: "User", entityId: user.id, summary: `Signed out everywhere (${count} session(s), including this one)` });
    } else if (all) {
      const { count } = await db.session.deleteMany({ where: { userId: user.id, id: { not: user.sessionId } } });
      await audit({ actorId: user.id, action: "user.sessions_revoke_others", entity: "User", entityId: user.id, summary: `Signed out ${count} other session(s)` });
    } else {
      if (!sessionId || sessionId === user.sessionId) return fail("Use “Sign out” in the menu to end this session");
      const { count } = await db.session.deleteMany({ where: { id: sessionId, userId: user.id } });
      if (!count) return fail("Session not found");
      await audit({ actorId: user.id, action: "user.session_revoke", entity: "User", entityId: user.id, summary: "Signed out one device" });
    }
  } catch (e) {
    return fail(authMessage(e, "We couldn't sign that device out"));
  }
  if (everywhere) {
    try {
      await auth.api.signOut({ headers: await headers() }); // clears this browser's cookies
    } catch {
      /* session row already gone */
    }
    return done("Signed out everywhere", "/login?signedout=1");
  }
  revalidatePath("/account/security");
  return done(all ? "Signed out everywhere else" : "Device signed out");
}
