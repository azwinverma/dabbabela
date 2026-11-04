"use server";

import type { Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { addDays, dateOnly, isoDate, isValidISODate, todayKTM, weekStartOf, WEEKDAYS } from "@/lib/dates";
import { parseRupees } from "@/lib/money";
import { syncRotationOrders } from "@/server/subscriptions";
import { guarded } from "../_kit/guard";

export type DayInput = {
  day: Weekday;
  isClosed: boolean;
  note: string;
  items: { boxId: string; isPrimary: boolean; capacity: string; soldOut: boolean; priceOverride: string }[];
};

function validate(days: DayInput[]) {
  for (const d of days) {
    if (!WEEKDAYS.includes(d.day)) return "Unknown day";
    if (d.isClosed) continue;
    if (!d.items.length) return `${d.day}: add at least one dabba or mark the day closed`;
    if (d.items.filter((i) => i.isPrimary).length !== 1) return `${d.day}: choose exactly one chef's pick`;
    if (new Set(d.items.map((i) => i.boxId)).size !== d.items.length) return `${d.day}: a dabba appears twice`;
    for (const i of d.items) {
      if (i.capacity && !/^\d+$/.test(i.capacity)) return `${d.day}: capacity must be a whole number`;
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

export async function saveMenuDays(menuId: string, meta: { title: string; note: string; kitchenId: string | null }, days: DayInput[]): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const menu = await db.weeklyMenu.findUnique({ where: { id: menuId }, include: { days: { include: { items: true } } } });
    if (!menu) return fail("Menu not found");
    if (!meta.title.trim()) return fail("Give the menu a title");
    const err = validate(days);
    if (err) return fail(err);
    const boxIds = [...new Set(days.flatMap((d) => d.items.map((i) => i.boxId)))];
    if ((await db.lunchBox.count({ where: { id: { in: boxIds } } })) !== boxIds.length) return fail("One of the dabbas no longer exists");
    await db.$transaction(async (tx) => {
      await tx.weeklyMenu.update({ where: { id: menuId }, data: { title: meta.title.trim().slice(0, 120), note: meta.note.trim().slice(0, 500) || null, kitchenId: meta.kitchenId || null } });
      await tx.menuDay.deleteMany({ where: { menuId } });
      for (const d of days) {
        await tx.menuDay.create({
          data: {
            menuId,
            day: d.day,
            isClosed: d.isClosed,
            note: d.note.trim().slice(0, 200) || null,
            items: {
              create: d.isClosed
                ? []
                : d.items.map((i, j) => ({ boxId: i.boxId, isPrimary: i.isPrimary, capacity: i.capacity ? parseInt(i.capacity, 10) : null, soldOut: i.soldOut, priceOverride: i.priceOverride ? parseRupees(i.priceOverride) : null, sortOrder: j })),
            },
          },
        });
      }
    });
    const changed = menu.status === "PUBLISHED" ? await resync(menu, user.id) : 0;
    await audit({ actorId: user.id, action: "menu.update", entity: "WeeklyMenu", entityId: menuId, summary: meta.title, before: menu.days, after: days });
    return done(menu.status === "PUBLISHED" ? `Saved and live. ${changed} booked rotation meal(s) re-assigned.` : "Draft saved");
  }, ["/admin/weekly-menus", "/menu", "/"]);
}

export async function setMenuStatus(menuId: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED"): Promise<ActionResult> {
  return guarded("menu.publish", async (user) => {
    const menu = await db.weeklyMenu.findUnique({ where: { id: menuId }, include: { days: { include: { items: true } } } });
    if (!menu) return fail("Menu not found");
    if (status === "PUBLISHED") {
      const open = WEEKDAYS.map((day) => menu.days.find((d) => d.day === day)).filter((d) => d && !d.isClosed);
      if (menu.isDefault && open.length === 0) return fail("The standing rotation needs at least one open day");
      const err = validate(menu.days.map((d) => ({ day: d.day, isClosed: d.isClosed, note: "", items: d.items.map((i) => ({ boxId: i.boxId, isPrimary: i.isPrimary, capacity: "", soldOut: i.soldOut, priceOverride: "" })) })));
      if (err) return fail(err);
      // Only one live menu per week (or one live standing rotation) per kitchen.
      await db.weeklyMenu.updateMany({
        where: { id: { not: menu.id }, status: "PUBLISHED", kitchenId: menu.kitchenId, ...(menu.isDefault ? { isDefault: true } : { weekStart: menu.weekStart }) },
        data: { status: "ARCHIVED" },
      });
    }
    await db.weeklyMenu.update({ where: { id: menuId }, data: { status, ...(status === "PUBLISHED" ? { publishedAt: new Date(), publishedById: user.id } : {}) } });
    const changed = status !== "DRAFT" || menu.status === "PUBLISHED" ? await resync(menu, user.id) : 0;
    await audit({ actorId: user.id, action: `menu.${status.toLowerCase()}`, entity: "WeeklyMenu", entityId: menuId, summary: `${menu.title} → ${status}`, before: { status: menu.status }, after: { status, reassigned: changed } });
    return done(status === "PUBLISHED" ? `Published. ${changed} booked rotation meal(s) re-assigned to the new chef's picks.` : status === "ARCHIVED" ? `Archived. ${changed} meal(s) re-assigned.` : `Back to draft. ${changed} meal(s) re-assigned.`);
  }, ["/admin/weekly-menus", "/menu", "/"]);
}

export async function createWeekMenu(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const raw = String(fd.get("weekOf") ?? "");
    if (!isValidISODate(raw)) return fail("Pick a date in the week");
    const weekStart = weekStartOf(raw);
    const from = String(fd.get("copyFrom") ?? "");
    const source = from ? await db.weeklyMenu.findUnique({ where: { id: from }, include: { days: { include: { items: true } } } }) : null;
    const menu = await db.weeklyMenu.create({
      data: {
        title: `Week of ${weekStart}`,
        weekStart: dateOnly(weekStart),
        kitchenId: source?.kitchenId ?? null,
        status: "DRAFT",
        days: {
          create: WEEKDAYS.map((day) => {
            const d = source?.days.find((x) => x.day === day);
            return { day, isClosed: d ? d.isClosed : day === "SAT", note: d?.note ?? null, items: { create: (d?.items ?? []).map((i) => ({ boxId: i.boxId, isPrimary: i.isPrimary, capacity: i.capacity, soldOut: false, priceOverride: i.priceOverride, sortOrder: i.sortOrder })) } };
          }),
        },
      },
    });
    await audit({ actorId: user.id, action: "menu.create", entity: "WeeklyMenu", entityId: menu.id, summary: menu.title });
    return done("Draft created", `/admin/weekly-menus/${menu.id}`);
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
    if (m.status === "PUBLISHED") return fail("Unpublish or archive it first");
    if (m.isDefault) return fail("The standing rotation can't be deleted");
    await db.weeklyMenu.delete({ where: { id: menuId } });
    await audit({ actorId: user.id, action: "menu.delete", entity: "WeeklyMenu", entityId: menuId, summary: m.title });
    return done("Deleted", "/admin/weekly-menus");
  }, ["/admin/weekly-menus"]);
}
