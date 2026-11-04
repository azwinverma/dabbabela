import type { Role } from "@prisma/client";

/**
 * Role → permission matrix. Enforced on the server in every admin page and server action
 * (middleware only checks that a session cookie exists). See docs/SECURITY.md.
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

export const PERMISSIONS = {
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

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | string | undefined | null, perm: Permission) {
  if (!role) return false;
  return (PERMISSIONS[perm] as string[]).includes(role);
}

export function permissionsFor(role: Role | string) {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
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

/** Only these roles may grant SUPER_ADMIN / OWNER. */
export function canGrantRole(actor: Role, target: Role) {
  if (target === "SUPER_ADMIN") return actor === "SUPER_ADMIN";
  if (target === "OWNER") return actor === "SUPER_ADMIN" || actor === "OWNER";
  return can(actor, "staff");
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
