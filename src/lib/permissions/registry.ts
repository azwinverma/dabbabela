/**
 * Granular permission registry: MODULE × ACTION. A permission key is "<module>.<action>".
 *
 * Action vocabulary (brief §14): view · create · edit · delete · publish · approve · export · refund · settings,
 * plus two operational extras used today: bulk (bulk order changes) and pii (see unmasked phone/email).
 * Each module lists only the actions that mean something for it. The role editor renders this registry.
 */
export const ACTIONS = ["view", "create", "edit", "delete", "publish", "approve", "export", "refund", "settings", "bulk", "pii"] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABEL: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  publish: "Publish",
  approve: "Approve",
  export: "Export",
  refund: "Refund",
  settings: "Settings",
  bulk: "Bulk changes",
  pii: "See contact details",
};

export const REGISTRY = {
  dashboard: { label: "Dashboard (operations KPIs)", group: "Overview", actions: ["view"] },
  analytics: { label: "Money KPIs & analytics", group: "Overview", actions: ["view", "export"] },
  reports: { label: "Reports", group: "Overview", actions: ["view", "export"] },
  alerts: { label: "Alerts center", group: "Overview", actions: ["view", "edit"] },

  orders: { label: "Orders", group: "Operations", actions: ["view", "create", "edit", "bulk", "export"] },
  subscriptions: { label: "Meal plans sold", group: "Operations", actions: ["view", "edit"] },
  kitchen: { label: "Kitchen production (approve = lock the day)", group: "Operations", actions: ["view", "edit", "approve"] },
  inventory: { label: "Inventory & stock", group: "Operations", actions: ["view", "edit", "export"] },
  dispatch: { label: "Dispatch", group: "Operations", actions: ["view", "edit"] },
  rider: { label: "Rider app", group: "Operations", actions: ["view", "edit"] },
  support: { label: "Support tickets & messages", group: "Operations", actions: ["view", "edit"] },

  payments: { label: "Payments (approve = verify transfers)", group: "Money", actions: ["view", "approve", "export"] },
  refunds: { label: "Refunds & credit (create = request)", group: "Money", actions: ["view", "create", "approve"] },
  invoices: { label: "Company invoices", group: "Money", actions: ["view", "edit"] },
  expenses: { label: "Expenses", group: "Money", actions: ["view", "create", "approve", "export"] },
  purchasing: { label: "Supplier invoices & payables", group: "Money", actions: ["view", "create", "approve"] },
  settlements: { label: "Daily settlement & reconciliation", group: "Money", actions: ["view", "edit", "approve"] },

  menu: { label: "Dishes, dabbas & weekly menus", group: "Menu", actions: ["view", "edit", "publish"] },
  recipes: { label: "Recipes & costing", group: "Menu", actions: ["view", "edit"] },
  plans: { label: "Plan catalogue", group: "Menu", actions: ["view", "edit"] },

  rules: { label: "Service rules (kitchens, zones, closures)", group: "Service rules", actions: ["view", "edit"] },
  pricing: { label: "Coupons & tax", group: "Service rules", actions: ["view", "edit"] },

  customers: { label: "Customers", group: "People", actions: ["view", "edit", "pii", "export"] },
  corporate: { label: "Companies", group: "People", actions: ["view", "edit"] },
  leads: { label: "Corporate leads", group: "People", actions: ["view", "edit"] },
  privacy: { label: "Privacy requests", group: "People", actions: ["view", "edit"] },

  content: { label: "Website content & pages", group: "Website", actions: ["view", "edit", "publish"] },
  media: { label: "Media library", group: "Website", actions: ["view", "edit"] },
  marketing: { label: "Banners, campaigns & promos", group: "Website", actions: ["view", "edit"] },
  seo: { label: "SEO, navigation & redirects", group: "Website", actions: ["view", "edit"] },

  staff: { label: "Staff accounts", group: "System", actions: ["view", "edit"] },
  roles: { label: "Roles & permissions", group: "System", actions: ["view", "edit"] },
  settings: { label: "Settings & flags", group: "System", actions: ["view", "edit"] },
  notifications: { label: "Notification templates & outbox", group: "System", actions: ["view", "edit"] },
  audit: { label: "Audit log", group: "System", actions: ["view"] },
} as const satisfies Record<string, { label: string; group: string; actions: readonly Action[] }>;

export type Module = keyof typeof REGISTRY;
export type GranularPermission = { [M in Module]: `${M}.${(typeof REGISTRY)[M]["actions"][number]}` }[Module];

export const ALL_GRANULAR: GranularPermission[] = (Object.keys(REGISTRY) as Module[]).flatMap((m) =>
  (REGISTRY[m].actions as readonly string[]).map((a) => `${m}.${a}` as GranularPermission),
);

const GRANULAR_SET = new Set<string>(ALL_GRANULAR);
export function isGranular(k: string): k is GranularPermission {
  return GRANULAR_SET.has(k);
}

export const MODULE_GROUPS = [...new Set(Object.values(REGISTRY).map((m) => m.group))];
