"use server";

import type { Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { addDays, dateOnly, isoDate, isValidISODate, todayKTM, weekStartOf, WEEKDAYS } from "@/lib/dates";
import { parseRupees } from "@/lib/money";
import { syncRotationOrders } from "@/server/subscriptions";
import { cancelSchedule, MENU_KINDS, menuSnapshot, publishMenu, recordLiveEdit, revalidatePublicMenu, scheduleMenu, unpublishMenu, validateMenuDays } from "@/server/menu";
import { guarded } from "../_kit/guard";

export type DayInput = {
  day: Weekday;
  isClosed: boolean;
  note: string;
  /** "HH:MM" same-day cut-off for this day; blank = global setting. */
  cutoffOverride?: string;
  items: { boxId: string; isPrimary: boolean; capacity: string; soldOut: boolean; priceOverride: string; replacementBoxId?: string }[];
};

export type MenuMeta = { title: string; note: string; kitchenId: string | null; kind?: string };

function validate(days: DayInput[]) {
  const err = validateMenuDays(days.map((d) => ({ ...d, cutoffOverride: d.cutoffOverride?.trim() || null, items: d.items.map((i) => ({ ...i, replacementBoxId: i.replacementBoxId || null })) })));
  if (err) return err;
  for (const d of days) {
    if (d.isClosed) continue;
    for (const i of d.items) {
      if (i.capacity && !/^\d+$/.test(i.capacity)) return `${d.day}: daily quantity must be a whole number`;
      if (i.priceOverride && parseRupees(i.priceOverride) === null) return `${d.day}: price override must be in rupees`;
    }
  }
  return null;
}

/** Weeks whose booked rotation meals should be re-assigned after this menu changes. */
async function resync(menu: { isDefault: boolean; weekStart: Date | null }, actorId: string) {
  const weeks = menu.isDefault ? [0, 1, 2, 3].map((i) => addDays(weekStartOf(todayKTM()), i * 7)) : menu.weekStart ? [isoDate(menu.weekStart)] : [];
  let changed = 0;
  for (const w of weeks) changed += await syncRotationOrders(w, actorId);
  return changed;
}

/** Live = published, or scheduled with a publish time that has passed (customers already see it). */
function isLive(m: { status: string; publishAt: Date | null }) {
  return m.status === "PUBLISHED" || (m.status === "DRAFT" && m.publishAt != null && m.publishAt <= new Date());
}

export async function saveMenuDays(menuId: string, meta: MenuMeta, days: DayInput[]): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const menu = await db.weeklyMenu.findUnique({ where: { id: menuId }, include: { days: { include: { items: true } } } });
    if (!menu) return fail("Menu not found");
    if (!meta.title.trim()) return fail("Give the menu a title");
    const kind = meta.kind ?? menu.kind;
    if (!(MENU_KINDS as readonly string[]).includes(kind)) return fail("Unknown menu kind");
    const err = validate(days);
    if (err) return fail(err);
    const boxIds = [...new Set(days.flatMap((d) => d.items.flatMap((i) => [i.boxId, i.replacementBoxId].filter((x): x is string => Boolean(x)))))];
    if ((await db.lunchBox.count({ where: { id: { in: boxIds } } })) !== boxIds.length) return fail("One of the dabbas no longer exists");
    if (meta.kitchenId && !(await db.kitchen.findUnique({ where: { id: meta.kitchenId } }))) return fail("Unknown kitchen");
    const live = isLive(menu);
    const before = live ? await menuSnapshot(menuId) : menu.days;
    await db.$transaction(async (tx) => {
      await tx.weeklyMenu.update({ where: { id: menuId }, data: { title: meta.title.trim().slice(0, 120), note: meta.note.trim().slice(0, 500) || null, kitchenId: meta.kitchenId || null, kind } });
      await tx.menuDay.deleteMany({ where: { menuId } });
      for (const d of days) {
        await tx.menuDay.create({
          data: {
            menuId,
            day: d.day,
            isClosed: d.isClosed,
            note: d.note.trim().slice(0, 200) || null,
            cutoffOverride: d.cutoffOverride?.trim() || null,
            items: {
              create: d.isClosed
                ? []
                : d.items.map((i, j) => ({
                    boxId: i.boxId,
                    isPrimary: i.isPrimary,
                    capacity: i.capacity ? parseInt(i.capacity, 10) : null,
                    soldOut: i.soldOut,
                    priceOverride: i.priceOverride ? parseRupees(i.priceOverride) : null,
                    replacementBoxId: i.replacementBoxId || null,
                    sortOrder: j,
                  })),
            },
          },
        });
      }
    });
    let changed = 0;
    if (live) {
      // An edit to a live menu is a publish of the change: revision + rotation re-sync + public revalidation.
      await recordLiveEdit(menuId, user.id);
      changed = await resync(menu, user.id);
      revalidatePublicMenu();
    }
    await audit({ actorId: user.id, action: "menu.update", entity: "WeeklyMenu", entityId: menuId, summary: meta.title, before, after: live ? await menuSnapshot(menuId) : days });
    return done(live ? `Saved and live. ${changed} booked rotation meal(s) re-assigned.` : "Draft saved");
  }, ["/admin/weekly-menus", `/admin/weekly-menus/${menuId}`]);
}

/** Status changes. PUBLISHED needs `menu.publish`; taking a live menu offline is guarded against orphaning booked orders. */
export async function setMenuStatus(menuId: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED"): Promise<ActionResult> {
  return guarded("menu.publish", async (user) => {
    const menu = await db.weeklyMenu.findUnique({ where: { id: menuId } });
    if (!menu) return fail("Menu not found");
    if (status === "PUBLISHED") {
      const r = await publishMenu(menuId, user.id);
      return r.ok ? done(r.message) : fail(r.message);
    }
    if (isLive(menu)) {
      const r = await unpublishMenu(menuId, status, user.id);
      return r.ok ? done(r.message) : fail(r.message);
    }
    if (status === "ARCHIVED" && menu.isDefault) return fail("Archive the standing rotation by publishing another one");
    await db.weeklyMenu.update({ where: { id: menuId }, data: { status, publishAt: null } });
    await audit({ actorId: user.id, action: `menu.${status.toLowerCase()}`, entity: "WeeklyMenu", entityId: menuId, summary: `${menu.title} → ${status}`, before: { status: menu.status, publishAt: menu.publishAt }, after: { status } });
    return done(status === "ARCHIVED" ? "Archived" : "Back to draft");
  }, ["/admin/weekly-menus", `/admin/weekly-menus/${menuId}`]);
}

/** Schedule from a Kathmandu local "YYYY-MM-DDTHH:MM" (datetime-local input). */
export async function scheduleMenuAction(menuId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu.publish", async (user) => {
    const raw = String(fd.get("publishAt") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return fail("Pick a date and time");
    const r = await scheduleMenu(menuId, new Date(`${raw}:00+05:45`), user.id);
    return r.ok ? done(r.message) : fail(r.message);
  }, ["/admin/weekly-menus", `/admin/weekly-menus/${menuId}`]);
}

export async function cancelScheduleAction(menuId: string): Promise<ActionResult> {
  return guarded("menu.publish", async (user) => {
    const r = await cancelSchedule(menuId, user.id);
    return r.ok ? done(r.message) : fail(r.message);
  }, ["/admin/weekly-menus", `/admin/weekly-menus/${menuId}`]);
}

export async function createWeekMenu(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const raw = String(fd.get("weekOf") ?? "");
    if (!isValidISODate(raw)) return fail("Pick a date in the week");
    const weekStart = weekStartOf(raw);
    const from = String(fd.get("copyFrom") ?? "");
    const source = from ? await db.weeklyMenu.findUnique({ where: { id: from }, include: { days: { include: { items: true } } } }) : null;
    if (from && !source) return fail("The menu to copy no longer exists");
    const kindRaw = String(fd.get("kind") ?? "");
    const kind = (MENU_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : (source?.kind ?? "STANDARD");
    const kitchenRaw = String(fd.get("kitchenId") ?? "");
    const kitchenId = kitchenRaw === "all" ? null : kitchenRaw || (source?.kitchenId ?? null);
    if (kitchenId && !(await db.kitchen.findUnique({ where: { id: kitchenId } }))) return fail("Unknown kitchen");
    const menu = await db.weeklyMenu.create({
      data: {
        title: kind === "STANDARD" ? `Week of ${weekStart}` : `${kind === "PROMO" ? "Promo" : "Seasonal"} week of ${weekStart}`,
        weekStart: dateOnly(weekStart),
        kitchenId,
        kind,
        status: "DRAFT",
        note: source ? `Copied from ${source.title}` : null,
        days: {
          create: WEEKDAYS.map((day) => {
            const d = source?.days.find((x) => x.day === day);
            return {
              day,
              isClosed: d ? d.isClosed : day === "SAT",
              note: d?.note ?? null,
              cutoffOverride: d?.cutoffOverride ?? null,
              items: { create: (d?.items ?? []).map((i) => ({ boxId: i.boxId, isPrimary: i.isPrimary, capacity: i.capacity, soldOut: false, priceOverride: i.priceOverride, replacementBoxId: i.replacementBoxId, sortOrder: i.sortOrder })) },
            };
          }),
        },
      },
    });
    await audit({ actorId: user.id, action: "menu.create", entity: "WeeklyMenu", entityId: menu.id, summary: menu.title, after: { weekStart, copyFrom: source?.id ?? null, kind, kitchenId } });
    return done(source ? `Copied from ${source.title}` : "Draft created", `/admin/weekly-menus/${menu.id}`);
  }, ["/admin/weekly-menus"]);
}

export async function duplicateMenu(menuId: string, weekOf: string): Promise<ActionResult> {
  const fd = new FormData();
  fd.set("weekOf", weekOf);
  fd.set("copyFrom", menuId);
  return createWeekMenu({ ok: false }, fd);
}

export async function deleteMenu(menuId: string): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const m = await db.weeklyMenu.findUnique({ where: { id: menuId } });
    if (!m) return fail("Not found");
    if (isLive(m)) return fail("Unpublish or archive it first");
    if (m.isDefault) return fail("The standing rotation can't be deleted");
    await db.weeklyMenu.delete({ where: { id: menuId } });
    await audit({ actorId: user.id, action: "menu.delete", entity: "WeeklyMenu", entityId: menuId, summary: m.title, before: m });
    return done("Deleted", "/admin/weekly-menus");
  }, ["/admin/weekly-menus"]);
}
