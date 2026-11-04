import type { Role } from "@prisma/client";
import { ALL_GRANULAR, type GranularPermission } from "./registry";
import { LEGACY_MATRIX, LEGACY_MAP, type LegacyPermission } from "./legacy";

/**
 * Grants for abilities that didn't exist in the legacy matrix (new modules / finer actions).
 * Key = granular permission, value = roles that get it in addition to SUPER_ADMIN (who has everything).
 * "derivedFrom" grants copy the roles of an existing legacy key, so e.g. whoever could edit
 * menus can also publish them — nobody loses or silently gains an existing ability.
 */
const derivedFrom: Partial<Record<GranularPermission, LegacyPermission>> = {
  "menu.publish": "menu",
  "content.publish": "content",
  "analytics.export": "dashboard.finance",
  "orders.export": "reports",
  "inventory.export": "inventory",
  "payments.export": "payments.verify",
  "customers.export": "customers.pii",
  "notifications.view": "settings",
  "notifications.edit": "settings",
  "roles.view": "staff",
  "orders.create": "orders.manage",
};

const OWNER: Role = "OWNER";
const explicit: Partial<Record<GranularPermission, Role[]>> = {
  "alerts.view": [OWNER, "OPERATIONS_MANAGER", "FINANCE"],
  "alerts.edit": [OWNER, "OPERATIONS_MANAGER"],
  "expenses.view": [OWNER, "FINANCE"],
  "expenses.create": [OWNER, "FINANCE"],
  "expenses.approve": [OWNER, "FINANCE"],
  "expenses.export": [OWNER, "FINANCE"],
  "purchasing.view": [OWNER, "FINANCE", "INVENTORY_MANAGER"],
  "purchasing.create": [OWNER, "FINANCE", "INVENTORY_MANAGER"],
  "purchasing.approve": [OWNER, "FINANCE"],
  "settlements.view": [OWNER, "FINANCE", "OPERATIONS_MANAGER"],
  "settlements.edit": [OWNER, "FINANCE"],
  "settlements.approve": [OWNER, "FINANCE"],
  "seo.view": [OWNER, "CONTENT_EDITOR"],
  "seo.edit": [OWNER, "CONTENT_EDITOR"],
  // roles.edit: SUPER_ADMIN only (enforced again in the roles actions)
};

function build(): Record<Role, Set<GranularPermission>> {
  const out = {} as Record<Role, Set<GranularPermission>>;
  const add = (r: Role, p: GranularPermission) => (out[r] ??= new Set()).add(p);
  for (const [legacy, roles] of Object.entries(LEGACY_MATRIX) as [LegacyPermission, Role[]][]) {
    for (const r of roles) {
      add(r, LEGACY_MAP[legacy].view);
      add(r, LEGACY_MAP[legacy].write);
    }
  }
  for (const [perm, legacy] of Object.entries(derivedFrom) as [GranularPermission, LegacyPermission][])
    for (const r of LEGACY_MATRIX[legacy] as Role[]) add(r, perm);
  for (const [perm, roles] of Object.entries(explicit) as [GranularPermission, Role[]][]) for (const r of roles) add(r, perm);
  out.SUPER_ADMIN = new Set(ALL_GRANULAR);
  out.CUSTOMER ??= new Set();
  return out;
}

export const SYSTEM_GRANTS = build();

export function systemGrants(role: Role | string | null | undefined): ReadonlySet<GranularPermission> {
  return (role && SYSTEM_GRANTS[role as Role]) || new Set();
}
