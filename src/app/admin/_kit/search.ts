import "server-only";
import { db } from "@/lib/db";
import { can, isStaffRole, type PermissionSubject } from "@/lib/permissions";
import { formatDay, isoDate } from "@/lib/dates";
import { piiFor, scopeIds, type KitchenScoped } from "@/components/admin/ops/scope";

/**
 * Global admin search (⌘K). Server-side only; every group is gated by the permission of the page it links to,
 * orders are limited to the staff member's kitchen scope, and contact details are masked without customers.pii.
 * Without customers.pii, customers can only be found by name (no probing by phone/email).
 */
export type SearchHit = { id: string; group: SearchGroup; title: string; subtitle?: string; href: string };
export type SearchGroup = "orders" | "customers" | "dabbas" | "companies";
export const SEARCH_GROUP_LABEL: Record<SearchGroup, string> = { orders: "Orders", customers: "Customers", dabbas: "Dabbas", companies: "Companies" };

export type Searcher = Exclude<PermissionSubject, string | null | undefined> & KitchenScoped;

const PER_GROUP = 6;

export function normalizeQuery(q: unknown): string {
  return typeof q === "string" ? q.replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

export async function globalSearch(user: Searcher, rawQuery: unknown): Promise<SearchHit[]> {
  if (!isStaffRole(user.role)) return [];
  const q = normalizeQuery(rawQuery);
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const pii = piiFor(user);
  const kitchens = scopeIds(user);

  const [orders, customers, boxes, companies] = await Promise.all([
    can(user, "orders.view")
      ? db.order.findMany({
          where: {
            ...(kitchens ? { kitchenId: { in: kitchens } } : {}),
            OR: [{ code: { equals: q, mode: "insensitive" } }, { number: { contains: q, mode: "insensitive" } }],
          },
          orderBy: { deliveryDate: "desc" },
          take: PER_GROUP,
          select: { id: true, number: true, code: true, status: true, deliveryDate: true, contactName: true },
        })
      : [],
    can(user, "customers.view")
      ? db.user.findMany({
          where: {
            role: "CUSTOMER",
            deletedAt: null,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              ...(pii.full ? [{ email: { contains: q, mode: "insensitive" as const } }] : []),
              ...(pii.full && digits.length >= 4 ? [{ phoneNumber: { contains: digits } }] : []),
            ],
          },
          orderBy: { createdAt: "desc" },
          take: PER_GROUP,
          select: { id: true, name: true, email: true, phoneNumber: true },
        })
      : [],
    can(user, "menu.view")
      ? db.lunchBox.findMany({
          where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] },
          orderBy: { name: "asc" },
          take: PER_GROUP,
          select: { id: true, name: true, isActive: true },
        })
      : [],
    can(user, "corporate.view")
      ? db.company.findMany({
          where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { legalName: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] },
          orderBy: { name: "asc" },
          take: PER_GROUP,
          select: { id: true, name: true, isActive: true },
        })
      : [],
  ]);

  return [
    ...orders.map((o) => ({
      id: o.id,
      group: "orders" as const,
      title: `#${o.number} · ${o.code}`,
      subtitle: `${o.contactName} · ${formatDay(isoDate(o.deliveryDate))} · ${o.status.replace(/_/g, " ").toLowerCase()}`,
      href: `/admin/orders/${o.id}`,
    })),
    ...customers.map((c) => ({
      id: c.id,
      group: "customers" as const,
      title: c.name,
      subtitle: [pii.email(c.email), pii.phone(c.phoneNumber)].filter(Boolean).join(" · "),
      href: `/admin/customers/${c.id}`,
    })),
    ...boxes.map((b) => ({ id: b.id, group: "dabbas" as const, title: b.name, subtitle: b.isActive ? undefined : "Inactive", href: `/admin/boxes/${b.id}` })),
    ...companies.map((c) => ({ id: c.id, group: "companies" as const, title: c.name, subtitle: c.isActive ? undefined : "Inactive", href: `/admin/companies/${c.id}` })),
  ];
}
