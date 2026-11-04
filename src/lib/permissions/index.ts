import type { Role } from "@prisma/client";
import { ALL_GRANULAR, isGranular, type GranularPermission } from "./registry";
import { isLegacy, LEGACY_MAP, type LegacyPermission } from "./legacy";
import { systemGrants } from "./system";

export * from "./registry";
export { LEGACY_MATRIX, LEGACY_MAP, type LegacyPermission } from "./legacy";
export { SYSTEM_GRANTS, systemGrants } from "./system";

/**
 * Authorisation model (docs/SUPER_ADMIN_ARCHITECTURE.md §2):
 * effective permissions = grants of the base Role (system.ts, derived from the legacy matrix)
 *                       ∪ grants of the optional custom StaffRole (staff base roles only).
 * SUPER_ADMIN always has everything. Enforced on the server in every admin page and action.
 */
export type Permission = GranularPermission | LegacyPermission;

/** Anything can() accepts: a bare role, or a user carrying custom-role grants. */
export type PermissionSubject =
  | Role
  | string
  | null
  | undefined
  | { role: Role | string; customGrants?: readonly string[] | null };

/** Resolve a key to the granular permission that must be held (legacy keys → their stricter `write` key). */
export function resolvePermission(perm: Permission): GranularPermission {
  if (isGranular(perm)) return perm;
  if (isLegacy(perm)) return LEGACY_MAP[perm].write;
  throw new Error(`Unknown permission "${perm}"`);
}

/** Effective granular permissions for a subject. */
export function effectivePermissions(subject: PermissionSubject): Set<GranularPermission> {
  if (!subject) return new Set();
  const role = typeof subject === "string" ? subject : subject.role;
  if (role === "SUPER_ADMIN") return new Set(ALL_GRANULAR);
  const out = new Set(systemGrants(role));
  if (typeof subject === "object" && subject.customGrants && isStaffRole(role))
    for (const g of subject.customGrants) if (isGranular(g)) out.add(g);
  return out;
}

export function can(subject: PermissionSubject, perm: Permission) {
  if (!subject) return false;
  const role = typeof subject === "string" ? subject : subject.role;
  if (role === "SUPER_ADMIN") return true;
  return effectivePermissions(subject).has(resolvePermission(perm));
}

export function permissionsFor(subject: PermissionSubject) {
  return [...effectivePermissions(subject)].sort();
}

/**
 * Escalation guard: the permissions in `requested` that `actor` doesn't hold.
 * Granting (to a role or a person) is allowed only when this is empty — or the actor is a super admin.
 */
export function ungrantable(actor: PermissionSubject, requested: readonly string[]): string[] {
  const held = effectivePermissions(actor);
  return requested.filter((p) => !isGranular(p) || !held.has(p));
}

export const STAFF_ROLES: Role[] = [
  "SUPER_ADMIN",
  "OWNER",
  "OPERATIONS_MANAGER",
  "CONTENT_EDITOR",
  "MENU_MANAGER",
  "KITCHEN_STAFF",
  "INVENTORY_MANAGER",
  "DISPATCHER",
  "DELIVERY_AGENT",
  "FINANCE",
  "SUPPORT",
];

export function isStaffRole(role: Role | string | null | undefined) {
  return Boolean(role && (STAFF_ROLES as string[]).includes(role));
}

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super admin",
  OWNER: "Business owner",
  OPERATIONS_MANAGER: "Operations manager",
  CONTENT_EDITOR: "Content editor",
  MENU_MANAGER: "Menu manager",
  KITCHEN_STAFF: "Chef / kitchen staff",
  INVENTORY_MANAGER: "Inventory manager",
  DISPATCHER: "Dispatcher",
  DELIVERY_AGENT: "Delivery rider",
  FINANCE: "Finance",
  SUPPORT: "Customer support",
  CUSTOMER: "Customer",
};

/**
 * May `actor` give someone the base role `target` (or change someone who has it)?
 * SUPER_ADMIN only by super admins; OWNER by super admins/owners; any other role needs staff.edit
 * AND every permission that role carries (no escalation through role assignment).
 */
export function canGrantRole(actor: PermissionSubject, target: Role) {
  if (!actor) return false;
  const actorRole = typeof actor === "string" ? actor : actor.role;
  if (target === "SUPER_ADMIN") return actorRole === "SUPER_ADMIN";
  if (target === "OWNER") return actorRole === "SUPER_ADMIN" || actorRole === "OWNER";
  if (!can(actor, "staff.edit")) return false;
  return ungrantable(actor, [...systemGrants(target)]).length === 0;
}

/** Where a staff member lands after login. */
export function staffHome(role: Role | string) {
  switch (role) {
    case "KITCHEN_STAFF":
      return "/admin/kitchen";
    case "INVENTORY_MANAGER":
      return "/admin/inventory";
    case "DISPATCHER":
      return "/admin/dispatch";
    case "DELIVERY_AGENT":
      return "/rider";
    case "CONTENT_EDITOR":
      return "/admin/content";
    case "MENU_MANAGER":
      return "/admin/weekly-menus";
    case "SUPPORT":
      return "/admin/support";
    default:
      return "/admin";
  }
}
