import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { Locale } from "@/lib/i18n";
import { assertCan, CmsError, revalidateSite, type CmsActor } from "./access";
import { isSafeHref } from "./urls";

/**
 * Header and footer navigation from `NavItem` (backfilled from the old hardcoded links by the foundation seed).
 * Menus: HEADER · FOOTER_EXPLORE · FOOTER_COMPANY · FOOTER_LEGAL. Labels per locale (Nepali falls back to English).
 * Changes go live immediately, so editing needs `content.publish`.
 */
export const NAV_MENUS = [
  { key: "HEADER", label: "Header" },
  { key: "FOOTER_EXPLORE", label: "Footer · Eat" },
  { key: "FOOTER_COMPANY", label: "Footer · Company" },
  { key: "FOOTER_LEGAL", label: "Footer · Legal & policies" },
] as const;
export type NavMenu = (typeof NAV_MENUS)[number]["key"];
const MENU_KEYS = NAV_MENUS.map((m) => m.key) as string[];

export type NavLink = { href: string; label: string; children: NavLink[] };
type Row = { id: string; menu: string; label: string; labelNe: string | null; href: string; parentId: string | null; sortOrder: number; visible: boolean };

async function loadRows(): Promise<Row[]> {
  try {
    return await db.navItem.findMany({ orderBy: [{ menu: "asc" }, { sortOrder: "asc" }, { label: "asc" }] });
  } catch {
    return [];
  }
}
const cachedRows = unstable_cache(loadRows, ["cms-nav-v1"], { tags: ["cms"], revalidate: 300 });
const rows = () => (process.env.VITEST || process.env.SCRIPT_CONTEXT ? loadRows() : cachedRows());

/** Visible links of one menu for visitors, labels in the given locale. `null` when the menu has never been set up. */
export async function getNav(menu: NavMenu, locale: Locale): Promise<NavLink[] | null> {
  const all = (await rows()).filter((r) => r.menu === menu);
  if (!all.length) return null;
  const label = (r: Row) => (locale === "ne" && r.labelNe ? r.labelNe : r.label);
  const visible = all.filter((r) => r.visible && isSafeHref(r.href));
  const top = visible.filter((r) => !r.parentId);
  return top.map((r) => ({
    href: r.href,
    label: label(r),
    children: visible.filter((c) => c.parentId === r.id).map((c) => ({ href: c.href, label: label(c), children: [] })),
  }));
}

export async function navForAdmin() {
  return loadRows();
}

export type NavInput = { menu: string; label: string; labelNe?: string | null; href: string; parentId?: string | null; visible?: boolean };

function validate(input: NavInput) {
  if (!MENU_KEYS.includes(input.menu)) throw new CmsError("Unknown menu");
  const label = input.label.trim().slice(0, 60);
  if (!label) throw new CmsError("Add a label");
  if (/<\s*\/?\s*[a-z]/i.test(label) || /<\s*\/?\s*[a-z]/i.test(input.labelNe ?? "")) throw new CmsError("Labels are plain text");
  const href = input.href.trim();
  if (!isSafeHref(href)) throw new CmsError("Link must be a site path (/menu), https://, mailto: or tel:");
  return { menu: input.menu, label, labelNe: input.labelNe?.trim().slice(0, 60) || null, href, visible: input.visible ?? true };
}

export async function saveNavItem(actor: CmsActor, id: string | null, input: NavInput) {
  assertCan(actor, "content.publish");
  const data = validate(input);
  let parentId: string | null = input.parentId || null;
  if (parentId) {
    const parent = await db.navItem.findUnique({ where: { id: parentId } });
    if (!parent || parent.menu !== data.menu || parent.parentId) throw new CmsError("A sub-link's parent must be a top-level link in the same menu");
    if (parent.id === id) parentId = null;
  }
  const before = id ? await db.navItem.findUnique({ where: { id } }) : null;
  const dup = await db.navItem.findFirst({ where: { menu: data.menu, href: data.href, NOT: id ? { id } : undefined } });
  if (dup) throw new CmsError("That link is already in this menu");
  const sortOrder = before?.menu === data.menu ? before.sortOrder : ((await db.navItem.aggregate({ where: { menu: data.menu }, _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
  const item = id ? await db.navItem.update({ where: { id }, data: { ...data, parentId, sortOrder } }) : await db.navItem.create({ data: { ...data, parentId, sortOrder } });
  await audit({ actorId: actor.id, action: id ? "nav.update" : "nav.create", entity: "NavItem", entityId: item.id, summary: `${item.menu}: ${item.label} → ${item.href}`, before, after: data });
  revalidateSite();
  return item;
}

export async function deleteNavItem(actor: CmsActor, id: string) {
  assertCan(actor, "content.publish");
  const item = await db.navItem.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "nav.delete", entity: "NavItem", entityId: id, summary: `${item.menu}: ${item.label}`, before: item });
  revalidateSite();
}

export async function setNavVisible(actor: CmsActor, id: string, visible: boolean) {
  assertCan(actor, "content.publish");
  const item = await db.navItem.update({ where: { id }, data: { visible } });
  await audit({ actorId: actor.id, action: "nav.visibility", entity: "NavItem", entityId: id, summary: `${item.label}: ${visible ? "shown" : "hidden"}` });
  revalidateSite();
}

/** Save a new order for one menu (ids in display order). */
export async function reorderNav(actor: CmsActor, menu: string, ids: string[]) {
  assertCan(actor, "content.publish");
  if (!MENU_KEYS.includes(menu)) throw new CmsError("Unknown menu");
  const items = await db.navItem.findMany({ where: { menu }, select: { id: true } });
  const known = new Set(items.map((i) => i.id));
  const ordered = ids.filter((i) => known.has(i));
  await db.$transaction(ordered.map((id, i) => db.navItem.update({ where: { id }, data: { sortOrder: i } })));
  await audit({ actorId: actor.id, action: "nav.reorder", entity: "NavItem", entityId: menu, summary: `${menu}: ${ordered.length} links reordered` });
  revalidateSite();
}

export async function moveNavItem(actor: CmsActor, id: string, by: -1 | 1) {
  assertCan(actor, "content.publish");
  const item = await db.navItem.findUniqueOrThrow({ where: { id } });
  const siblings = await db.navItem.findMany({ where: { menu: item.menu, parentId: item.parentId }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { id: true } });
  const ids = siblings.map((s) => s.id);
  const i = ids.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  // Only this sibling group is renumbered (top-level links and each parent's sub-links sort independently).
  await db.$transaction(ids.map((sid, k) => db.navItem.update({ where: { id: sid }, data: { sortOrder: k } })));
  await audit({ actorId: actor.id, action: "nav.reorder", entity: "NavItem", entityId: item.menu, summary: `${item.label} moved ${by < 0 ? "up" : "down"}` });
  revalidateSite();
}
