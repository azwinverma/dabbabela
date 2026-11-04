import type { Prisma, PrismaClient, Role } from "@prisma/client";
import { isGranular, type GranularPermission } from "../lib/permissions/registry";

/**
 * Idempotent backfill for the Super Admin foundation (WP-00). Safe to run any number of times, on a fresh
 * database or on a live one that already went through /setup:
 *   - preset custom staff roles (Kitchen Manager, Delivery Manager) — created once, never overwritten
 *   - expense categories — created once by key
 *   - one MealPlanPrice per plan that has none (+ links existing subscriptions sold at that price)
 *   - website NavItems mirroring the header/footer links — seeded once per menu (marker), so deletions stick
 *   - MealCategories from dabba tags, and each uncategorised dabba gets its first tag's category — once (marker)
 *
 * Triggered by: seedCatalog() (setup + `npm run db:seed`), `npm run db:foundation` (runs in `vercel-build` after
 * `prisma migrate deploy`), and the super-admin "Install foundation data" button on /admin/roles.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const PRESET_ROLES: { key: string; name: string; baseRole: Role; description: string; permissions: GranularPermission[] }[] = [
  {
    key: "kitchen-manager",
    name: "Kitchen manager",
    baseRole: "KITCHEN_STAFF",
    description: "Runs a kitchen: production, day lock, stock and receiving. Give it to a Chef / kitchen staff account and scope it to their kitchen.",
    permissions: ["dashboard.view", "alerts.view", "kitchen.view", "kitchen.edit", "kitchen.approve", "inventory.view", "inventory.edit", "inventory.export", "recipes.view", "menu.view", "orders.view", "dispatch.view", "rules.view"],
  },
  {
    key: "delivery-manager",
    name: "Delivery manager",
    baseRole: "DISPATCHER",
    description: "Runs delivery: routes, riders, zones and failed deliveries. Give it to a Dispatcher account.",
    permissions: ["dashboard.view", "alerts.view", "dispatch.view", "dispatch.edit", "rider.view", "rider.edit", "orders.view", "rules.view", "support.view"],
  },
];

export const EXPENSE_CATEGORIES: { key: string; name: string; kind: "COGS" | "OPERATING" | "CAPEX" }[] = [
  { key: "FOOD", name: "Food & ingredients", kind: "COGS" },
  { key: "PACKAGING", name: "Packaging", kind: "COGS" },
  { key: "DELIVERY", name: "Delivery (rider pay, fuel)", kind: "OPERATING" },
  { key: "LABOR", name: "Kitchen & staff wages", kind: "OPERATING" },
  { key: "RENT", name: "Rent", kind: "OPERATING" },
  { key: "UTILITIES", name: "Utilities (gas, power, water, internet)", kind: "OPERATING" },
  { key: "MARKETING", name: "Marketing", kind: "OPERATING" },
  { key: "GATEWAY_FEES", name: "Payment gateway fees", kind: "OPERATING" },
  { key: "EQUIPMENT", name: "Equipment", kind: "CAPEX" },
  { key: "OTHER", name: "Other", kind: "OPERATING" },
];

/** Mirrors the links that were hard-coded in Header.tsx / Footer.tsx on 2026-11-04. */
export const DEFAULT_NAV: { menu: string; href: string; label: string; labelNe: string }[] = [
  { menu: "HEADER", href: "/menu", label: "This week's menu", labelNe: "यो हप्ताको मेनु" },
  { menu: "HEADER", href: "/build", label: "Build a dabba", labelNe: "आफ्नै डब्बा" },
  { menu: "HEADER", href: "/plans", label: "Plans", labelNe: "योजनाहरू" },
  { menu: "HEADER", href: "/corporate", label: "For teams", labelNe: "टोलीका लागि" },
  { menu: "HEADER", href: "/delivery-areas", label: "Delivery areas", labelNe: "डेलिभरी क्षेत्र" },
  { menu: "FOOTER_EXPLORE", href: "/menu", label: "This week's menu", labelNe: "यो हप्ताको मेनु" },
  { menu: "FOOTER_EXPLORE", href: "/build", label: "Build a dabba", labelNe: "आफ्नै डब्बा" },
  { menu: "FOOTER_EXPLORE", href: "/plans", label: "Plans", labelNe: "योजनाहरू" },
  { menu: "FOOTER_EXPLORE", href: "/corporate", label: "For teams", labelNe: "टोलीका लागि" },
  { menu: "FOOTER_EXPLORE", href: "/delivery-areas", label: "Delivery areas", labelNe: "डेलिभरी क्षेत्र" },
  { menu: "FOOTER_COMPANY", href: "/about", label: "Our kitchen", labelNe: "हाम्रो भान्सा" },
  { menu: "FOOTER_COMPANY", href: "/journal", label: "Journal", labelNe: "जर्नल" },
  { menu: "FOOTER_COMPANY", href: "/faq", label: "FAQ", labelNe: "प्रश्नोत्तर" },
  { menu: "FOOTER_COMPANY", href: "/contact", label: "Contact", labelNe: "सम्पर्क" },
];

const MARKER_KEY = "foundation.v1";
type Marker = { nav?: string; categories?: string };

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function dateOnlyUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type FoundationResult = { roles: number; expenseCategories: number; planPrices: number; subscriptionsLinked: number; navItems: number; categories: number; boxesCategorised: number };

export async function ensureFoundationData(db: Db): Promise<FoundationResult> {
  const out: FoundationResult = { roles: 0, expenseCategories: 0, planPrices: 0, subscriptionsLinked: 0, navItems: 0, categories: 0, boxesCategorised: 0 };
  const markerRow = await db.setting.findUnique({ where: { key: MARKER_KEY } });
  const marker: Marker = (markerRow?.value as Marker | null) ?? {};
  const now = new Date().toISOString();

  // 1. Preset staff roles (create once; admins may edit them afterwards).
  for (const r of PRESET_ROLES) {
    if (await db.staffRole.findUnique({ where: { key: r.key }, select: { id: true } })) continue;
    await db.staffRole.create({ data: { key: r.key, name: r.name, description: `${r.description} (Base role: ${r.baseRole}.)`, permissions: r.permissions.filter(isGranular), isSystem: true } });
    out.roles++;
  }

  // 2. Expense categories.
  for (const c of EXPENSE_CATEGORIES) {
    if (await db.expenseCategory.findUnique({ where: { key: c.key }, select: { id: true } })) continue;
    await db.expenseCategory.create({ data: c });
    out.expenseCategories++;
  }

  // 3. Versioned plan prices: one starting row per plan without any.
  const plans = await db.mealPlan.findMany({ where: { prices: { none: {} } } });
  for (const p of plans) {
    const price = await db.mealPlanPrice.create({
      data: { planId: p.id, pricePerMeal: p.pricePerMeal, compareAtPrice: p.compareAtPrice, effectiveFrom: p.effectiveFrom ?? dateOnlyUTC(p.createdAt), effectiveTo: p.effectiveTo },
    });
    out.planPrices++;
    const linked = await db.subscription.updateMany({ where: { planId: p.id, priceId: null, pricePerMeal: p.pricePerMeal }, data: { priceId: price.id } });
    out.subscriptionsLinked += linked.count;
  }

  // 4. Navigation (once per database; afterwards the CMS owns it).
  if (!marker.nav) {
    for (const [i, n] of DEFAULT_NAV.entries()) {
      const exists = await db.navItem.findUnique({ where: { menu_href: { menu: n.menu, href: n.href } }, select: { id: true } });
      if (exists) continue;
      await db.navItem.create({ data: { ...n, sortOrder: i } });
      out.navItems++;
    }
    marker.nav = now;
  }

  // 5. Meal categories from dabba tags (once, after the catalogue exists).
  if (!marker.categories) {
    const boxes = await db.lunchBox.findMany({ select: { id: true, tags: true, categoryId: true }, orderBy: { sortOrder: "asc" } });
    const tags = [...new Set(boxes.flatMap((b) => b.tags))];
    const bySlug = new Map<string, string>();
    for (const [i, t] of tags.entries()) {
      const slug = slugify(t);
      if (!slug) continue;
      const found = await db.mealCategory.findUnique({ where: { slug }, select: { id: true } });
      const cat = found ?? (await db.mealCategory.create({ data: { slug, name: t, sortOrder: i }, select: { id: true } }));
      if (!found) out.categories++;
      bySlug.set(slug, cat.id);
    }
    for (const b of boxes) {
      if (b.categoryId || !b.tags.length) continue;
      const id = bySlug.get(slugify(b.tags[0]!));
      if (!id) continue;
      await db.lunchBox.update({ where: { id: b.id }, data: { categoryId: id } });
      out.boxesCategorised++;
    }
    // Only mark done once there were dabbas to look at (a fresh deploy runs this before /setup loads the catalogue).
    if (boxes.length) marker.categories = now;
  }

  await db.setting.upsert({ where: { key: MARKER_KEY }, create: { key: MARKER_KEY, value: marker }, update: { value: marker } });
  return out;
}
