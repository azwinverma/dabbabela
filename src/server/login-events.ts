import { db } from "@/lib/db";
import { log } from "@/lib/logger";

/** Better Auth endpoints that are sign-in attempts, and the method we record. */
export const LOGIN_PATHS: Record<string, string> = {
  "/sign-in/email": "email",
  "/phone-number/verify": "phone",
  "/two-factor/verify-totp": "two-factor",
  "/two-factor/verify-backup-code": "backup-code",
};

type HookCtx = {
  path?: string;
  body?: unknown;
  headers?: Headers;
  request?: Request;
  context: { returned?: unknown; newSession?: { user?: { id?: string; email?: string } } | null; session?: { user?: { id?: string; email?: string } } | null };
};

function clientIp(h?: Headers | null) {
  const xff = h?.get("x-forwarded-for");
  return (xff ? xff.split(",")[0]?.trim() : h?.get("x-real-ip")) || null;
}

/** Error code from a Better Auth APIError-like value, without any secret material. */
function failureCode(returned: unknown): string | null {
  if (!returned || typeof returned !== "object") return null;
  const r = returned as { statusCode?: number; status?: number | string; body?: { code?: string } };
  const status = typeof r.statusCode === "number" ? r.statusCode : typeof r.status === "number" ? r.status : null;
  if (status !== null && status >= 400) return (r.body?.code ?? `HTTP_${status}`).slice(0, 80);
  return null;
}

/**
 * Record a sign-in attempt from Better Auth's `after` hook. Stores who/when/where/how and success —
 * never passwords, OTPs, TOTP codes or session tokens. Never throws (sign-in must not fail because of logging).
 */
export async function recordLoginAttempt(ctx: HookCtx) {
  try {
    const method = ctx.path ? LOGIN_PATHS[ctx.path] : undefined;
    if (!method) return;
    const headers = ctx.headers ?? ctx.request?.headers ?? null;
    const body = (ctx.body ?? {}) as { email?: unknown };
    const failed = failureCode(ctx.context.returned);
    const sessionUser = ctx.context.newSession?.user ?? ctx.context.session?.user;
    const ret = ctx.context.returned as { twoFactorRedirect?: boolean } | undefined;
    let email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 160) : sessionUser?.email ?? null;
    let userId = sessionUser?.id ?? null;
    if (!userId && email) userId = (await db.user.findUnique({ where: { email }, select: { id: true } }))?.id ?? null;
    if (userId && !email) email = (await db.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null;
    await db.loginEvent.create({
      data: {
        userId,
        email,
        ip: clientIp(headers),
        userAgent: headers?.get("user-agent")?.slice(0, 300) ?? null,
        method,
        success: !failed,
        reason: failed ?? (ret?.twoFactorRedirect ? "TWO_FACTOR_REQUIRED" : null),
      },
    });
  } catch (e) {
    log.warn("auth.login_event_failed", { error: e instanceof Error ? e.message : String(e) });
  }
}
