import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "./db";
import { CURRENT_USER_INCLUDE, toCurrentUser } from "./user-context";
import { auth } from "@/server/auth";
import { getSettings } from "./settings";
import { can, isStaffRole, type Permission } from "./permissions";

/**
 * The signed-in user, loaded fresh from the database on every request (so role changes and
 * deactivation take effect immediately). Includes company membership and saved addresses.
 */
export const getCurrentUser = cache(async () => {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch {
    return null;
  }
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.user.id }, include: CURRENT_USER_INCLUDE });
  if (!user || !user.isActive || user.deletedAt) return null;
  // Staff sessions have an absolute lifetime (customers keep the 30-day sliding session): a stolen or forgotten
  // control-room session can't live for a month. The expired row is deleted so it can't be reused.
  if (isStaffRole(user.role) && staffSessionExpired(session.session.createdAt)) {
    await db.session.deleteMany({ where: { id: session.session.id } }).catch(() => null);
    return null;
  }
  return toCurrentUser(user, session.session.id);
});

/** Hours a staff session may live from sign-in (STAFF_SESSION_MAX_HOURS, default 24, min 1, max 720). */
export function staffSessionMaxHours() {
  const n = Number(process.env.STAFF_SESSION_MAX_HOURS ?? 24);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 720) : 24;
}

export function staffSessionExpired(createdAt: Date | string, now = Date.now()) {
  return now - new Date(createdAt).getTime() > staffSessionMaxHours() * 3600_000;
}

/**
 * Does this staff member satisfy the staff two-factor rule? (Non-staff: always true.) For callers that can't redirect
 * — JSON routes and kit actions — so they can refuse instead. requirePermission/requireStaff redirect to setup.
 */
export async function staffTwoFactorOk(user: Pick<CurrentUser, "role" | "twoFactorEnabled">) {
  if (!isStaffRole(user.role) || user.twoFactorEnabled) return true;
  if (process.env.DISABLE_STAFF_2FA === "true" && process.env.NODE_ENV !== "production") return true;
  return !(await getSettings()).flags.staff2fa;
}

export { kitchenScope } from "./user-context";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Active company membership (null when pending/removed or the company is inactive). */
export function activeCompany(user: Pick<CurrentUser, "membership"> | null | undefined) {
  const m = user?.membership;
  if (!m || m.status !== "ACTIVE" || !m.company.isActive) return null;
  return m.company;
}

export function isCompanyAdmin(user: Pick<CurrentUser, "membership"> | null | undefined) {
  return Boolean(activeCompany(user) && user?.membership?.role === "ADMIN");
}

export async function requireUser(next = "/account") {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export function isStaff(role: Role | string) {
  return isStaffRole(role);
}

async function enforce2fa(user: CurrentUser) {
  if (!(await staffTwoFactorOk(user))) redirect("/account/security?setup=2fa");
}

/** Gate for admin pages AND server actions. Never rely on middleware alone. */
export async function requirePermission(perm: Permission) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (!can(user, perm)) redirect("/admin/forbidden");
  await enforce2fa(user);
  return user;
}

/** Any of the given permissions. */
export async function requireAnyPermission(...perms: Permission[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (!perms.some((p) => can(user, p))) redirect("/admin/forbidden");
  await enforce2fa(user);
  return user;
}

/** Super admin only (roles editor, granting super admin). */
export async function requireSuperAdmin() {
  const user = await requirePermission("roles.view");
  if (user.role !== "SUPER_ADMIN") redirect("/admin/forbidden");
  return user;
}

export async function requireStaff() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (!isStaffRole(user.role)) redirect("/account");
  await enforce2fa(user);
  return user;
}

/** Corporate portal gate: active company admin only, scoped to their own company. */
export async function requireCompanyAdmin() {
  const user = await requireUser("/team");
  const company = activeCompany(user);
  if (!company || user.membership?.role !== "ADMIN") redirect("/account?team=forbidden");
  return { user, company };
}
