import type { Role } from "@prisma/client";
import type { GranularPermission } from "./registry";

/**
 * The original coarse Role → permission matrix (pre-2026-11-04), kept verbatim.
 * System role grants are derived from it (system.ts), so every existing user keeps exactly
 * the access they had. Do not edit — change system.ts EXTRA_GRANTS or use custom roles instead.
 */
const ALL: Role[] = ["SUPER_ADMIN", "OWNER"];
const OPS: Role = "OPERATIONS_MANAGER";
const CE: Role = "CONTENT_EDITOR";
const MM: Role = "MENU_MANAGER";
const KS: Role = "KITCHEN_STAFF";
const IM: Role = "INVENTORY_MANAGER";
const DP: Role = "DISPATCHER";
const DA: Role = "DELIVERY_AGENT";
const FI: Role = "FINANCE";
const SU: Role = "SUPPORT";

export const LEGACY_MATRIX = {
  // overview
  dashboard: [...ALL, OPS, FI],
  "dashboard.finance": [...ALL, FI], // revenue, margins, collections
  reports: [...ALL, OPS, FI],
  // operations
  "orders.view": [...ALL, OPS, KS, DP, FI, SU],
  "orders.manage": [...ALL, OPS, SU], // status changes, edits, cancellations
  "orders.bulk": [...ALL, OPS],
  kitchen: [...ALL, OPS, KS, IM],
  "kitchen.lock": [...ALL, OPS],
  inventory: [...ALL, OPS, IM],
  dispatch: [...ALL, OPS, DP],
  rider: [...ALL, DA, DP],
  subscriptions: [...ALL, OPS, SU],
  // money
  "payments.view": [...ALL, FI, OPS, SU],
  "payments.verify": [...ALL, FI],
  "refunds.request": [...ALL, FI, OPS, SU],
  "refunds.approve": [...ALL, FI],
  invoices: [...ALL, FI],
  // catalogue
  menu: [...ALL, MM, OPS],
  recipes: [...ALL, MM, IM],
  plans: [...ALL, MM],
  rules: [...ALL, OPS], // zones, slots, kitchens, holidays, capacity
  pricing: [...ALL, FI], // taxes, coupons
  // people
  customers: [...ALL, OPS, SU, FI],
  "customers.pii": [...ALL, SU, OPS],
  corporate: [...ALL, OPS, FI, SU],
  leads: [...ALL, OPS],
  support: [...ALL, SU, OPS],
  // website
  content: [...ALL, CE],
  media: [...ALL, CE, MM],
  marketing: [...ALL, CE],
  // system
  staff: [...ALL],
  settings: [...ALL],
  audit: [...ALL],
  privacy: [...ALL, SU],
} satisfies Record<string, Role[]>;

export type LegacyPermission = keyof typeof LEGACY_MATRIX;

/**
 * Legacy key → the granular keys it stands for. `view` gates pages, `write` gates mutations.
 * A legacy key passed to can() resolves to its `write` key (the stricter one).
 */
export const LEGACY_MAP: Record<LegacyPermission, { view: GranularPermission; write: GranularPermission }> = {
  dashboard: { view: "dashboard.view", write: "dashboard.view" },
  "dashboard.finance": { view: "analytics.view", write: "analytics.view" },
  reports: { view: "reports.view", write: "reports.export" },
  "orders.view": { view: "orders.view", write: "orders.view" },
  "orders.manage": { view: "orders.edit", write: "orders.edit" },
  "orders.bulk": { view: "orders.bulk", write: "orders.bulk" },
  kitchen: { view: "kitchen.view", write: "kitchen.edit" },
  "kitchen.lock": { view: "kitchen.approve", write: "kitchen.approve" },
  inventory: { view: "inventory.view", write: "inventory.edit" },
  dispatch: { view: "dispatch.view", write: "dispatch.edit" },
  rider: { view: "rider.view", write: "rider.edit" },
  subscriptions: { view: "subscriptions.view", write: "subscriptions.edit" },
  "payments.view": { view: "payments.view", write: "payments.view" },
  "payments.verify": { view: "payments.approve", write: "payments.approve" },
  "refunds.request": { view: "refunds.view", write: "refunds.create" },
  "refunds.approve": { view: "refunds.approve", write: "refunds.approve" },
  invoices: { view: "invoices.view", write: "invoices.edit" },
  menu: { view: "menu.view", write: "menu.edit" },
  recipes: { view: "recipes.view", write: "recipes.edit" },
  plans: { view: "plans.view", write: "plans.edit" },
  rules: { view: "rules.view", write: "rules.edit" },
  pricing: { view: "pricing.view", write: "pricing.edit" },
  customers: { view: "customers.view", write: "customers.edit" },
  "customers.pii": { view: "customers.pii", write: "customers.pii" },
  corporate: { view: "corporate.view", write: "corporate.edit" },
  leads: { view: "leads.view", write: "leads.edit" },
  support: { view: "support.view", write: "support.edit" },
  content: { view: "content.view", write: "content.edit" },
  media: { view: "media.view", write: "media.edit" },
  marketing: { view: "marketing.view", write: "marketing.edit" },
  staff: { view: "staff.view", write: "staff.edit" },
  settings: { view: "settings.view", write: "settings.edit" },
  audit: { view: "audit.view", write: "audit.view" },
  privacy: { view: "privacy.view", write: "privacy.edit" },
};

export function isLegacy(k: string): k is LegacyPermission {
  return Object.prototype.hasOwnProperty.call(LEGACY_MATRIX, k);
}
