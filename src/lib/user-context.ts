import type { Prisma } from "@prisma/client";

/** What getCurrentUser loads for a user — shared so staff-on-behalf flows (team orders) and tests build the same shape. */
export const CURRENT_USER_INCLUDE = {
  membership: { include: { company: true, officeLocation: true } },
  addresses: { where: { archivedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], include: { zone: true } },
  staffRole: { select: { id: true, key: true, name: true, permissions: true } },
  scopes: { select: { kitchenId: true, companyId: true } },
} satisfies Prisma.UserInclude;

export type LoadedUser = Prisma.UserGetPayload<{ include: typeof CURRENT_USER_INCLUDE }>;

/** Base roles whose work is always kitchen-bound (stations, stock, routes). */
export const KITCHEN_BOUND_ROLES: readonly string[] = ["KITCHEN_STAFF", "INVENTORY_MANAGER", "DISPATCHER", "DELIVERY_AGENT"];
/** Base roles that are business-wide by design: unassigned = all kitchens. */
const ALL_KITCHEN_ROLES: readonly string[] = ["SUPER_ADMIN", "OWNER", "OPERATIONS_MANAGER", "FINANCE"];
/** Granular permissions that are about one kitchen's operations. */
const KITCHEN_SCOPED_PERMISSION = /^(kitchen|dispatch|rider|inventory)\./;

/**
 * Does this staff member's work belong to specific kitchens? Kitchen-bound base roles always; other operational
 * roles (support, content, menu) only when a custom role gives them kitchen / dispatch / rider / inventory work.
 * Owners, super admins, operations managers (admins) and finance are business-wide.
 */
export function isKitchenBound(user: { role?: string | null; staffRole?: { permissions?: readonly string[] | null } | null }) {
  const role = user.role ?? "";
  if (role === "CUSTOMER" || ALL_KITCHEN_ROLES.includes(role)) return false;
  if (KITCHEN_BOUND_ROLES.includes(role)) return true;
  return Boolean(user.staffRole?.permissions?.some((p) => KITCHEN_SCOPED_PERMISSION.test(p)));
}

/**
 * Kitchens a staff member is limited to: User.kitchenId (primary) ∪ StaffScope kitchen rows.
 * null = unscoped (all kitchens) — only for business-wide roles. A kitchen-bound staff member with no kitchen
 * assigned gets [] = NO kitchen (fail closed, security review M4), never all kitchens.
 */
export function kitchenScope(user: { kitchenId: string | null; scopes?: { kitchenId: string | null }[]; role?: string | null; staffRole?: { permissions?: readonly string[] | null } | null }): string[] | null {
  const ids = new Set<string>();
  if (user.kitchenId) ids.add(user.kitchenId);
  for (const s of user.scopes ?? []) if (s.kitchenId) ids.add(s.kitchenId);
  if (ids.size) return [...ids];
  return isKitchenBound(user) ? [] : null;
}

export function toCurrentUser(u: LoadedUser, sessionId: string) {
  return { ...u, sessionId, customGrants: u.staffRole?.permissions ?? [], kitchenIds: kitchenScope(u) };
}
