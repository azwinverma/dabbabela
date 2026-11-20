import "server-only";
import { db } from "@/lib/db";
import { getSettings, type SiteSettings } from "@/lib/settings";
import { CURRENT_USER_INCLUDE, toCurrentUser } from "@/lib/user-context";
import { can, isStaffRole, type Permission } from "@/lib/permissions";
import { auth } from "@/server/auth";
import { ApiError, forbidden, notFound, unauthorized } from "./http";

/**
 * Bearer-session resolution for /api/v1.
 *
 * The app sends `Authorization: Bearer <token>` (the token returned by sign-in). Better Auth's `bearer` plugin turns
 * it into the normal DB session lookup, so expiry, revocation, deactivation and staff session rules are exactly the
 * web's. **Cookies are never forwarded**: a browser that happens to hold a web session cookie can't drive the API
 * (no CSRF surface), and the web app can't be driven with a bearer token through /api/v1 by accident either.
 */

export type ApiUser = ReturnType<typeof toCurrentUser>;

/** Only the headers Better Auth needs: the bearer token, client IP and user agent. Never the cookie. */
export function bearerHeaders(req: Request): Headers {
  const h = new Headers();
  const a = req.headers.get("authorization");
  if (a) h.set("authorization", a);
  for (const k of ["x-forwarded-for", "x-real-ip", "user-agent", "x-request-id"]) {
    const v = req.headers.get(k);
    if (v) h.set(k, v);
  }
  return h;
}

export function hasBearer(req: Request) {
  const a = req.headers.get("authorization") ?? "";
  return a.slice(0, 7).toLowerCase() === "bearer " && a.slice(7).trim().length > 0;
}

/** The signed-in API user (fresh from the DB, like getCurrentUser), or null. */
export async function getApiUser(req: Request): Promise<ApiUser | null> {
  if (!hasBearer(req)) return null;
  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    session = await auth.api.getSession({ headers: bearerHeaders(req) });
  } catch {
    return null;
  }
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.user.id }, include: CURRENT_USER_INCLUDE });
  if (!user || !user.isActive || user.deletedAt) return null;
  return toCurrentUser(user, session.session.id);
}

/**
 * Same rule as the web's `enforce2fa` (src/lib/auth.ts): with `flags.staff2fa` on, a staff account without TOTP
 * enabled may sign in but can't use any staff feature until it enrols. Bearer sessions for accounts that do have
 * TOTP only exist after the second factor was verified (Better Auth issues no session before that).
 */
export function staffNeeds2fa(user: Pick<ApiUser, "role" | "twoFactorEnabled">, settings: Pick<SiteSettings, "flags">) {
  if (!isStaffRole(user.role) || user.twoFactorEnabled) return false;
  if (process.env.DISABLE_STAFF_2FA === "true" && process.env.NODE_ENV !== "production") return false;
  return Boolean(settings.flags.staff2fa);
}

export async function assertStaff2fa(user: ApiUser) {
  if (staffNeeds2fa(user, await getSettings()))
    throw new ApiError(403, "TWO_FACTOR_SETUP_REQUIRED", "Turn on two-step sign-in (authenticator app) before using staff features");
}

export async function requireApiUser(req: Request): Promise<ApiUser> {
  const user = await getApiUser(req);
  if (!user) throw unauthorized();
  return user;
}

/** `requirePermission` for bearer users: signed in, holds one of the permissions, staff 2FA satisfied. */
export async function requireApiPermission(req: Request, ...perms: Permission[]): Promise<ApiUser> {
  const user = await requireApiUser(req);
  if (!perms.some((p) => can(user, p))) throw forbidden();
  await assertStaff2fa(user);
  return user;
}

// ───────────── kitchen scope (same rule as components/admin/ops/scope.ts) ─────────────

export function inKitchenScope(user: Pick<ApiUser, "kitchenIds">, kitchenId: string) {
  return !user.kitchenIds || user.kitchenIds.includes(kitchenId);
}

/** Out-of-scope kitchens answer 404 (don't reveal what exists elsewhere). */
export function assertKitchenScope(user: Pick<ApiUser, "kitchenIds">, kitchenId: string | null | undefined) {
  if (!kitchenId || !inKitchenScope(user, kitchenId)) throw notFound("Not found in your kitchens");
}

export function kitchenWhereFor(user: Pick<ApiUser, "kitchenIds">) {
  return user.kitchenIds ? { kitchenId: { in: user.kitchenIds } } : {};
}

/** Kitchens the user may act on (active), first one is the default. */
export async function scopedKitchens(user: Pick<ApiUser, "kitchenIds">) {
  return db.kitchen.findMany({ where: { isActive: true, ...(user.kitchenIds ? { id: { in: user.kitchenIds } } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, code: true } });
}

/** Resolve `?kitchenId=` against scope (default: first kitchen in scope). */
export async function pickApiKitchen(user: Pick<ApiUser, "kitchenIds">, requested?: string | null) {
  const ks = await scopedKitchens(user);
  if (requested) {
    const k = ks.find((x) => x.id === requested);
    if (!k) throw notFound("Not found in your kitchens");
    return k;
  }
  if (!ks[0]) throw notFound("No kitchen in your scope");
  return ks[0];
}
