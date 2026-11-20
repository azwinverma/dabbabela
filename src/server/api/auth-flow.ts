import "server-only";
import { isAPIError } from "better-auth/api";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { auth } from "@/server/auth";
import { ApiError } from "./http";
import { bearerHeaders } from "./auth";

/**
 * Glue between Better Auth's cookie-oriented endpoints and bearer clients.
 *
 *  - Session token: Better Auth's `bearer` plugin echoes the (signed) session token in the `set-auth-token` response
 *    header whenever it sets the session cookie; we return it as `token`. The app stores it in secure storage and sends
 *    `Authorization: Bearer <token>`.
 *  - Two-factor challenge: for an account with TOTP, sign-in issues no session — Better Auth sets a short-lived signed
 *    `two_factor` cookie instead. We hand that cookie to the app as an opaque `challengeToken`, and replay it as a
 *    cookie on POST /auth/two-factor/verify. It's single-use, expires with Better Auth's challenge, and is
 *    attempt-limited by Better Auth (plus our rate limit).
 */

type AuthCallResult<T> = { headers: Headers; response: T };

function setCookies(h: Headers): string[] {
  const anyH = h as Headers & { getSetCookie?: () => string[] };
  if (typeof anyH.getSetCookie === "function") return anyH.getSetCookie();
  const raw = h.get("set-cookie");
  return raw ? raw.split(/,(?=\s*[^;,=\s]+=)/) : [];
}

/** The signed session token from a Better Auth call (bearer plugin header), else the raw token in the body. */
export function sessionTokenFrom(r: AuthCallResult<{ token?: string | null } | unknown>): string | null {
  const signed = r.headers.get("set-auth-token");
  if (signed) return signed;
  const body = r.response as { token?: string | null } | null;
  return body?.token ?? null;
}

/** Opaque challenge = base64url("<cookie name>=<signed value>") of Better Auth's two_factor cookie. */
export function challengeFrom(h: Headers): string | null {
  for (const c of setCookies(h)) {
    const [pair] = c.split(";");
    const eq = pair!.indexOf("=");
    if (eq < 0) continue;
    const name = pair!.slice(0, eq).trim();
    if (/(^|\.)two_factor$/.test(name)) return Buffer.from(`${name}=${pair!.slice(eq + 1).trim()}`).toString("base64url");
  }
  return null;
}

/** Headers for a two-factor verification: the challenge cookie + client ip/ua (never the caller's other cookies). */
export function challengeHeaders(req: Request, challengeToken: string): Headers {
  let cookie: string;
  try {
    cookie = Buffer.from(challengeToken, "base64url").toString("utf8");
  } catch {
    throw new ApiError(401, "INVALID_CHALLENGE", "This sign-in step has expired — sign in again");
  }
  if (!/^(__Secure-|__Host-)?[A-Za-z0-9_.-]*two_factor=[^;\s]+$/.test(cookie)) throw new ApiError(401, "INVALID_CHALLENGE", "This sign-in step has expired — sign in again");
  const h = bearerHeaders(req);
  h.delete("authorization");
  h.set("cookie", cookie);
  return h;
}

/** Map a Better Auth error to the API envelope (no account enumeration; same wording as the web). */
export function authError(e: unknown, fallback: string): ApiError {
  if (e instanceof ApiError) return e;
  if (isAPIError(e)) {
    const code = (e.body as { code?: string } | undefined)?.code ?? "";
    const status = typeof e.statusCode === "number" ? e.statusCode : 400;
    if (status === 429 || e.status === "TOO_MANY_REQUESTS") return new ApiError(429, "RATE_LIMITED", "Too many attempts — wait a minute and try again");
    if (code.includes("INVALID_EMAIL_OR_PASSWORD")) return new ApiError(401, "INVALID_CREDENTIALS", "That email and password don't match");
    if (code.includes("USER_ALREADY_EXISTS")) return new ApiError(409, "ACCOUNT_EXISTS", "An account with this email already exists — sign in instead");
    if (code.includes("PASSWORD_TOO_SHORT")) return new ApiError(422, "VALIDATION_FAILED", "Use at least 8 characters", { password: "At least 8 characters" });
    if (code.includes("INVALID_TOKEN")) return new ApiError(400, "INVALID_TOKEN", "This link has expired — ask for a new one");
    if (code.includes("TWO_FACTOR_COOKIE") || code.includes("TOO_MANY_ATTEMPTS")) return new ApiError(401, "INVALID_CHALLENGE", "This sign-in step has expired — sign in again");
    if (code.includes("INVALID_CODE") || code.includes("OTP") || code.includes("BACKUP_CODE")) return new ApiError(401, "INVALID_CODE", "That code isn't right or has expired");
    if (code.includes("INVALID_PASSWORD")) return new ApiError(401, "INVALID_PASSWORD", "Your password isn't right");
    if (code.includes("LOCKED")) return new ApiError(429, "RATE_LIMITED", "Too many wrong codes — try again later");
    if (status === 401 || status === 403) return new ApiError(401, "UNAUTHENTICATED", (e.body as { message?: string } | undefined)?.message || fallback);
    return new ApiError(400, "AUTH_FAILED", (e.body as { message?: string } | undefined)?.message || fallback);
  }
  log.warn("api.auth_error", { error: e });
  return new ApiError(500, "INTERNAL", fallback);
}

/** Public shape of the signed-in account returned by auth endpoints (GET /me has the full picture). */
export async function authUserDto(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, phoneNumber: true, role: true, twoFactorEnabled: true, locale: true } });
  return { id: u.id, name: u.name, email: u.email.endsWith("@phone.dabbabela.local") ? null : u.email, phone: u.phoneNumber, role: u.role, twoFactorEnabled: Boolean(u.twoFactorEnabled), locale: u.locale };
}

export { auth };
