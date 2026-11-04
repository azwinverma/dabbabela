import type { Permission } from "@/lib/permissions";

export type NavItem = { href: string; label: string; icon: string; perm: Permission };
export type NavGroup = { title: string; items: NavItem[] };

/** Control-room navigation. Items are hidden when the role lacks the permission (pages re-check). */
export const ADMIN_NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: "LayoutDashboard", perm: "dashboard" },
      { href: "/admin/reports", label: "Reports & exports", icon: "LineChart", perm: "reports" },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/admin/orders", label: "Orders", icon: "ReceiptText", perm: "orders.view" },
      { href: "/admin/kitchen", label: "Kitchen", icon: "CookingPot", perm: "kitchen" },
      { href: "/admin/inventory", label: "Inventory", icon: "Warehouse", perm: "inventory" },
      { href: "/admin/dispatch", label: "Dispatch", icon: "Bike", perm: "dispatch" },
      { href: "/admin/subscriptions", label: "Meal plans sold", icon: "CalendarCheck", perm: "subscriptions" },
      { href: "/admin/support", label: "Support tickets", icon: "LifeBuoy", perm: "support" },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/admin/payments", label: "Payments", icon: "Wallet", perm: "payments.view" },
      { href: "/admin/refunds", label: "Refunds & credit", icon: "Undo2", perm: "refunds.request" },
      { href: "/admin/invoices", label: "Invoices", icon: "FileSpreadsheet", perm: "invoices" },
    ],
  },
  {
    title: "Menu",
    items: [
      { href: "/admin/dishes", label: "Dishes & recipes", icon: "Soup", perm: "menu" },
      { href: "/admin/boxes", label: "Dabbas", icon: "Package", perm: "menu" },
      { href: "/admin/weekly-menus", label: "Weekly menus", icon: "CalendarDays", perm: "menu" },
      { href: "/admin/builder", label: "Build-a-Dabba rules", icon: "Blocks", perm: "menu" },
      { href: "/admin/plans", label: "Plan catalogue", icon: "Layers", perm: "plans" },
    ],
  },
  {
    title: "Service rules",
    items: [
      { href: "/admin/kitchens", label: "Kitchens & slots", icon: "Store", perm: "rules" },
      { href: "/admin/zones", label: "Delivery zones", icon: "MapPinned", perm: "rules" },
      { href: "/admin/holidays", label: "Closures & disruptions", icon: "CalendarX", perm: "rules" },
      { href: "/admin/coupons", label: "Coupons", icon: "TicketPercent", perm: "pricing" },
      { href: "/admin/taxes", label: "Tax rules", icon: "Percent", perm: "pricing" },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/admin/customers", label: "Customers", icon: "Users", perm: "customers" },
      { href: "/admin/companies", label: "Companies", icon: "Building2", perm: "corporate" },
      { href: "/admin/leads", label: "Corporate leads", icon: "Handshake", perm: "leads" },
      { href: "/admin/messages", label: "Contact messages", icon: "Inbox", perm: "support" },
    ],
  },
  {
    title: "Website",
    items: [
      { href: "/admin/content", label: "Page sections", icon: "PanelsTopLeft", perm: "content" },
      { href: "/admin/pages", label: "Pages & policies", icon: "FileText", perm: "content" },
      { href: "/admin/blog", label: "Journal", icon: "Newspaper", perm: "content" },
      { href: "/admin/banners", label: "Banners & promos", icon: "Megaphone", perm: "marketing" },
      { href: "/admin/testimonials", label: "Testimonials", icon: "Quote", perm: "content" },
      { href: "/admin/faqs", label: "FAQs", icon: "CircleHelp", perm: "content" },
      { href: "/admin/media", label: "Media library", icon: "Images", perm: "media" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/admin/staff", label: "Staff & roles", icon: "ShieldCheck", perm: "staff" },
      { href: "/admin/notifications", label: "Notifications", icon: "BellRing", perm: "settings" },
      { href: "/admin/settings", label: "Settings & flags", icon: "Settings", perm: "settings" },
      { href: "/admin/privacy", label: "Privacy requests", icon: "UserX", perm: "privacy" },
      { href: "/admin/audit", label: "Audit log", icon: "History", perm: "audit" },
    ],
  },
];
