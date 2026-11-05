import type { Permission } from "@/lib/permissions";

/**
 * Control-room sidebar. Owned by WP-01 (docs/ADMIN_IMPLEMENTATION_TRACKER.md): every entry later packages need is
 * registered here up front so no package edits this file.
 *
 * `ready: false` = the route hasn't been built yet. Those entries are filtered out (no dead links); the package that
 * builds the page flips its entry to ready (the only edit allowed here). Items are also filtered by `perm` per user.
 */
export type NavItem = { href: string; label: string; icon: string; perm: Permission; ready?: boolean; owner?: string };
export type NavGroup = { title: string; items: NavItem[] };

export const ADMIN_NAV_ALL: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: "LayoutDashboard", perm: "dashboard.view" },
      { href: "/admin/analytics", label: "Analytics", icon: "ChartNoAxesCombined", perm: "analytics.view", owner: "WP-02" },
      { href: "/admin/alerts", label: "Alerts", icon: "Siren", perm: "alerts.view", ready: false, owner: "WP-16" },
      { href: "/admin/reports", label: "Reports & exports", icon: "LineChart", perm: "reports.view" },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/admin/orders", label: "Orders", icon: "ReceiptText", perm: "orders.view" },
      { href: "/admin/kitchen", label: "Kitchen", icon: "CookingPot", perm: "kitchen.view" },
      { href: "/admin/production-calendar", label: "Production calendar", icon: "CalendarRange", perm: "kitchen.view", ready: false, owner: "WP-06" },
      { href: "/admin/inventory", label: "Inventory", icon: "Warehouse", perm: "inventory.view" },
      { href: "/admin/dispatch", label: "Dispatch", icon: "Bike", perm: "dispatch.view" },
      { href: "/admin/riders", label: "Riders", icon: "UserRoundCheck", perm: "dispatch.view", ready: false, owner: "WP-13" },
      { href: "/admin/subscriptions", label: "Meal plans sold", icon: "CalendarCheck", perm: "subscriptions.view" },
      { href: "/admin/support", label: "Support tickets", icon: "LifeBuoy", perm: "support.view" },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/admin/payments", label: "Payments", icon: "Wallet", perm: "payments.view" },
      { href: "/admin/refunds", label: "Refunds & credit", icon: "Undo2", perm: "refunds.view" },
      { href: "/admin/invoices", label: "Invoices", icon: "FileSpreadsheet", perm: "invoices.view" },
      { href: "/admin/expenses", label: "Expenses", icon: "Receipt", perm: "expenses.view", ready: false, owner: "WP-09" },
      { href: "/admin/payables", label: "Supplier payables", icon: "HandCoins", perm: "purchasing.view", ready: false, owner: "WP-09" },
      { href: "/admin/settlements", label: "Daily settlement", icon: "Scale", perm: "settlements.view", ready: false, owner: "WP-09" },
      { href: "/admin/profitability", label: "Profitability", icon: "TrendingUp", perm: "analytics.view", ready: false, owner: "WP-09" },
    ],
  },
  {
    title: "Menu",
    items: [
      { href: "/admin/dishes", label: "Dishes & recipes", icon: "Soup", perm: "menu.view" },
      { href: "/admin/boxes", label: "Dabbas", icon: "Package", perm: "menu.view" },
      { href: "/admin/categories", label: "Meal categories", icon: "Tags", perm: "menu.view", ready: false, owner: "WP-04" },
      { href: "/admin/weekly-menus", label: "Weekly menus", icon: "CalendarDays", perm: "menu.view" },
      { href: "/admin/builder", label: "Build-a-Dabba rules", icon: "Blocks", perm: "menu.view" },
      { href: "/admin/plans", label: "Plan catalogue", icon: "Layers", perm: "plans.view" },
    ],
  },
  {
    title: "Service rules",
    items: [
      { href: "/admin/kitchens", label: "Kitchens & slots", icon: "Store", perm: "rules.view" },
      { href: "/admin/zones", label: "Delivery zones", icon: "MapPinned", perm: "rules.view" },
      { href: "/admin/holidays", label: "Closures & disruptions", icon: "CalendarX", perm: "rules.view" },
      { href: "/admin/coupons", label: "Coupons", icon: "TicketPercent", perm: "pricing.view" },
      { href: "/admin/taxes", label: "Tax rules", icon: "Percent", perm: "pricing.view" },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/admin/customers", label: "Customers", icon: "Users", perm: "customers.view" },
      { href: "/admin/companies", label: "Companies", icon: "Building2", perm: "corporate.view" },
      { href: "/admin/leads", label: "Corporate leads", icon: "Handshake", perm: "leads.view" },
      { href: "/admin/messages", label: "Contact messages", icon: "Inbox", perm: "support.view" },
    ],
  },
  {
    title: "Website",
    items: [
      { href: "/admin/content", label: "Page sections", icon: "PanelsTopLeft", perm: "content.view" },
      { href: "/admin/pages", label: "Pages & policies", icon: "FileText", perm: "content.view" },
      { href: "/admin/site", label: "Navigation, SEO & redirects", icon: "Globe", perm: "seo.view", ready: false, owner: "WP-14" },
      { href: "/admin/blog", label: "Journal", icon: "Newspaper", perm: "content.view" },
      { href: "/admin/banners", label: "Banners & promos", icon: "Megaphone", perm: "marketing.view" },
      { href: "/admin/campaigns", label: "Campaigns & referrals", icon: "Target", perm: "marketing.view", ready: false, owner: "WP-15" },
      { href: "/admin/testimonials", label: "Testimonials", icon: "Quote", perm: "content.view" },
      { href: "/admin/faqs", label: "FAQs", icon: "CircleHelp", perm: "content.view" },
      { href: "/admin/media", label: "Media library", icon: "Images", perm: "media.view" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/admin/staff", label: "Staff", icon: "ShieldCheck", perm: "staff.view" },
      { href: "/admin/roles", label: "Roles & permissions", icon: "KeyRound", perm: "roles.view" },
      { href: "/admin/notifications", label: "Notifications", icon: "BellRing", perm: "notifications.view" },
      { href: "/admin/jobs", label: "Scheduled jobs", icon: "Timer", perm: "settings.view", ready: false, owner: "WP-16" },
      { href: "/admin/settings", label: "Settings & flags", icon: "Settings", perm: "settings.view" },
      { href: "/admin/privacy", label: "Privacy requests", icon: "UserX", perm: "privacy.view" },
      { href: "/admin/audit", label: "Audit log", icon: "History", perm: "audit.view" },
    ],
  },
];

/** Built routes only. */
export const ADMIN_NAV: NavGroup[] = ADMIN_NAV_ALL.map((g) => ({ ...g, items: g.items.filter((i) => i.ready !== false) }));
