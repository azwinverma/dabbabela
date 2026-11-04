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
  return toCurrentUser(user, session.session.id);
});

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
  if (!isStaffRole(user.role) || user.twoFactorEnabled) return;
  if (process.env.DISABLE_STAFF_2FA === "true" && process.env.NODE_ENV !== "production") return;
  const s = await getSettings();
  if (s.flags.staff2fa) redirect("/account/security?setup=2fa");
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
