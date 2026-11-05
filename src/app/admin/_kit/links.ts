/**
 * Deep links from an (entity, id) pair to its admin record page. Used by the audit log and global search.
 * Returns null when there is no detail page for that entity.
 */
const DETAIL: Record<string, string> = {
  Order: "/admin/orders",
  Subscription: "/admin/subscriptions",
  LunchBox: "/admin/boxes",
  MenuItem: "/admin/dishes",
  WeeklyMenu: "/admin/weekly-menus",
  MealPlan: "/admin/plans",
  Company: "/admin/companies",
  Invoice: "/admin/invoices",
  Payment: "/admin/payments",
  Kitchen: "/admin/kitchens",
  DeliveryZone: "/admin/zones",
  CorporateLead: "/admin/leads",
  SupportTicket: "/admin/support",
  ContactMessage: "/admin/messages",
  Coupon: "/admin/coupons",
  Banner: "/admin/banners",
  Testimonial: "/admin/testimonials",
  Faq: "/admin/faqs",
  Post: "/admin/blog",
  Page: "/admin/pages",
  StaffRole: "/admin/roles",
  Ingredient: "/admin/inventory/ingredients",
  PurchaseOrder: "/admin/inventory/purchases",
};

/** Entities that only have a list page (link to it filtered by nothing). */
const LIST: Record<string, string> = {
  Refund: "/admin/refunds",
  Setting: "/admin/settings",
  Holiday: "/admin/holidays",
  TaxRule: "/admin/taxes",
  MediaAsset: "/admin/media",
  DataRequest: "/admin/privacy",
  NotificationTemplate: "/admin/notifications",
  OutboundMessage: "/admin/notifications",
};

/** `User` rows are customers or staff; the caller passes the role when known. */
export function recordHref(entity: string, entityId: string | null | undefined, opts: { role?: string | null } = {}): string | null {
  if (entity === "User") {
    if (!entityId) return null;
    const base = opts.role && opts.role !== "CUSTOMER" ? "/admin/staff" : "/admin/customers";
    return `${base}/${encodeURIComponent(entityId)}`;
  }
  if (entityId && DETAIL[entity]) return `${DETAIL[entity]}/${encodeURIComponent(entityId)}`;
  return LIST[entity] ?? (DETAIL[entity] && !entityId ? DETAIL[entity] : null);
}
