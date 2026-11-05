import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";

// Server actions run their real permission checks against this fake signed-in user.
const session = vi.hoisted(() => ({ user: null as null | { id: string; role: Role } }));
const cache = vi.hoisted(() => ({ paths: [] as string[], tags: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => void cache.paths.push(p),
  revalidateTag: (t: string) => void cache.tags.push(t),
  unstable_cache: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const { can } = await import("@/lib/permissions");
  const { db } = await import("@/lib/db");
  return {
    ...real,
    requirePermission: async (perm: Parameters<typeof can>[1]) => {
      if (!session.user || !can(session.user.role, perm)) throw new Error(`FORBIDDEN:${perm}`);
      return { ...(await db.user.findUniqueOrThrow({ where: { id: session.user.id } })), role: session.user.role, addresses: [], membership: null, sessionId: "t" };
    },
  };
});

import { db } from "@/lib/db";
import { addDays, dateOnly, weekStartOf } from "@/lib/dates";
import { createWeekMenu, saveMenuDays, scheduleMenuAction, setMenuStatus, type DayInput } from "@/app/admin/weekly-menus/actions";
import { saveCategory, moveCategory } from "@/app/admin/categories/actions";
import { setKitchenAvailability } from "@/app/admin/boxes/actions";
import { diffSnapshots, getWeekOffers, publishDueMenus, type MenuSnapshot } from "@/server/menu";
import { getPublicWeek } from "@/lib/public";
import { serviceDay } from "../helpers";

let owner: { id: string };
let customer: { id: string };
let k2: { id: string };
let k1: { id: string };
let boxA: { id: string; slug: string };
let boxB: { id: string; slug: string };
let boxHidden: { id: string };
let dishB: { id: string };
let menuId = "";
const W = weekStartOf(serviceDay(70)); // a far-future week no other test touches
const as = (id: string, role: Role) => (session.user = { id, role });
const fd = (o: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) d.set(k, v);
  return d;
};
const ktmLocal = (d: Date) => new Date(d.getTime() + (5 * 60 + 45) * 60_000).toISOString().slice(0, 16);

async function makeBox(slug: string, dishId: string, extra: Record<string, unknown> = {}) {
  return db.lunchBox.create({ data: { name: slug, slug, price: 25000, items: { create: [{ menuItemId: dishId, quantity: 1 }] }, ...extra } });
}

async function bookOrder(boxId: string, date: string, kitchenId: string, qty = 1) {
  const n = Math.random().toString(36).slice(2, 10).toUpperCase();
  return db.order.create({
    data: {
      number: `T-${n}`,
      code: n.slice(0, 4),
      userId: customer.id,
      deliveryDate: dateOnly(date),
      kitchenId,
      status: "SCHEDULED",
      paymentStatus: "PAID",
      contactName: "Test",
      contactPhone: "9800000000",
      addressLine: "Somewhere",
      area: "Baneshwor",
      subtotal: 25000 * qty,
      total: 25000 * qty,
      items: { create: [{ boxId, name: "box", components: [], quantity: qty, unitPrice: 25000, lineTotal: 25000 * qty }] },
    },
  });
}

const day = (d: DayInput["day"], items: DayInput["items"], extra: Partial<DayInput> = {}): DayInput => ({ day: d, isClosed: false, note: "", items, ...extra });
const item = (boxId: string, isPrimary: boolean, extra: Partial<DayInput["items"][number]> = {}) => ({ boxId, isPrimary, capacity: "", soldOut: false, priceOverride: "", ...extra });

beforeAll(async () => {
  owner = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
  customer = await db.user.findUniqueOrThrow({ where: { email: "customer.b@demo.dabbabela.local" } });
  k1 = await db.kitchen.findUniqueOrThrow({ where: { code: "KTM-1" } });
  k2 = await db.kitchen.create({ data: { name: "Lalitpur test kitchen", code: "TST-2" } });
  const [d1, d2] = await db.menuItem.findMany({ where: { isActive: true }, take: 2, orderBy: { name: "asc" } });
  dishB = d2;
  boxA = await makeBox("wp04-box-a", d1.id, { isFeatured: true });
  boxB = await makeBox("wp04-box-b", d2.id);
  boxHidden = await makeBox("wp04-box-hidden", d1.id, { isVisible: false });
});

afterAll(async () => {
  // Leave shared fixtures as other suites expect them.
  await db.order.deleteMany({ where: { number: { startsWith: "T-" }, items: { some: { boxId: { in: [boxA.id, boxB.id] } } } } });
  await db.kitchen.update({ where: { id: k2.id }, data: { isActive: false } });
});

describe("weekly menu builder", () => {
  it("creates a kitchen-specific draft and saves days with quantities, cut-off and replacement", async () => {
    as(owner.id, "SUPER_ADMIN");
    const r = await createWeekMenu({ ok: false }, fd({ weekOf: W, kitchenId: k2.id, kind: "SEASONAL" }));
    expect(r.ok).toBe(true);
    const menu = await db.weeklyMenu.findFirstOrThrow({ where: { weekStart: dateOnly(W), kitchenId: k2.id } });
    menuId = menu.id;
    expect(menu.kind).toBe("SEASONAL");
    const days: DayInput[] = [
      day("SUN", [item(boxA.id, true, { capacity: "5", replacementBoxId: boxB.id }), item(boxB.id, false), item(boxHidden.id, false)], { cutoffOverride: "08:00" }),
      day("MON", [item(boxB.id, true)]),
      ...(["TUE", "WED", "THU", "FRI", "SAT"] as const).map((d) => ({ day: d, isClosed: true, note: "", items: [] })),
    ];
    const bad = await saveMenuDays(menuId, { title: "Seasonal", note: "", kitchenId: k2.id, kind: "SEASONAL" }, [{ ...days[0], cutoffOverride: "25:00" }, ...days.slice(1)]);
    expect(bad.ok).toBe(false);
    expect((await saveMenuDays(menuId, { title: "Seasonal", note: "", kitchenId: k2.id, kind: "SEASONAL" }, days)).ok).toBe(true);
  });

  it("copies a previous week with quantities, cut-offs and replacements (sold-out flags reset)", async () => {
    as(owner.id, "SUPER_ADMIN");
    await db.menuDayItem.updateMany({ where: { menuDay: { menuId }, boxId: boxB.id }, data: { soldOut: true } });
    const r = await createWeekMenu({ ok: false }, fd({ weekOf: addDays(W, 7), copyFrom: menuId }));
    expect(r.ok).toBe(true);
    const copy = await db.weeklyMenu.findFirstOrThrow({ where: { weekStart: dateOnly(addDays(W, 7)) }, include: { days: { include: { items: true } } } });
    expect(copy.kitchenId).toBe(k2.id);
    expect(copy.kind).toBe("SEASONAL");
    const sun = copy.days.find((d) => d.day === "SUN")!;
    expect(sun.cutoffOverride).toBe("08:00");
    const a = sun.items.find((i) => i.boxId === boxA.id)!;
    expect(a.capacity).toBe(5);
    expect(a.replacementBoxId).toBe(boxB.id);
    expect(sun.items.every((i) => !i.soldOut)).toBe(true);
    await db.menuDayItem.updateMany({ where: { menuDay: { menuId }, boxId: boxB.id }, data: { soldOut: false } });
  });

  it("scheduled publish is invisible before publishAt and visible after, then finalised idempotently", async () => {
    as(owner.id, "SUPER_ADMIN");
    const at = new Date(Date.now() + 2 * 3600_000);
    cache.paths.length = 0;
    cache.tags.length = 0;
    const r = await scheduleMenuAction(menuId, { ok: false }, fd({ publishAt: ktmLocal(at) }));
    expect(r.ok).toBe(true);
    const m = await db.weeklyMenu.findUniqueOrThrow({ where: { id: menuId } });
    expect(m.status).toBe("DRAFT");
    expect(Math.abs(m.publishAt!.getTime() - at.getTime())).toBeLessThan(60_000);

    const before = await getWeekOffers(W, k2.id);
    expect(before.offers[0].menuId).not.toBe(menuId);
    const after = await getWeekOffers(W, k2.id, { now: new Date(at.getTime() + 60_000) });
    expect(after.offers[0].menuId).toBe(menuId);
    expect(after.offers[0].cutoff).toBe("08:00");
    expect(after.offers[0].kind).toBe("SEASONAL");

    // Time passes: visible at read time with no cron run.
    await db.weeklyMenu.update({ where: { id: menuId }, data: { publishAt: new Date(Date.now() - 1000) } });
    expect((await getWeekOffers(W, k2.id)).offers[0].menuId).toBe(menuId);
    expect((await db.weeklyMenu.findUniqueOrThrow({ where: { id: menuId } })).status).toBe("DRAFT");

    const first = await publishDueMenus();
    expect(first.find((x) => x.id === menuId)?.ok).toBe(true);
    expect(await publishDueMenus()).toEqual([]);
    const pub = await db.weeklyMenu.findUniqueOrThrow({ where: { id: menuId }, include: { revisions: { orderBy: { version: "asc" } } } });
    expect(pub.status).toBe("PUBLISHED");
    expect(pub.publishAt).toBeNull();
    expect(pub.revisions.map((x) => x.action)).toEqual(["SCHEDULE", "PUBLISH"]);
    expect(pub.version).toBe(2);
    // Public pages were revalidated on schedule + publish.
    expect(cache.tags).toContain("menu");
    expect(cache.paths).toEqual(expect.arrayContaining(["/menu", "/", "/boxes/[slug]"]));
  });

  it("writes a revision with a readable diff when a live menu is edited", async () => {
    as(owner.id, "SUPER_ADMIN");
    const cur = await db.weeklyMenu.findUniqueOrThrow({ where: { id: menuId }, include: { days: { include: { items: { orderBy: { sortOrder: "asc" } } } } } });
    const days: DayInput[] = cur.days.map((d) => ({
      day: d.day,
      isClosed: d.isClosed,
      note: d.note ?? "",
      cutoffOverride: d.cutoffOverride ?? "",
      items: d.items
        .filter((i) => d.day !== "MON" || i.boxId === boxB.id)
        .map((i) => item(i.boxId, i.isPrimary, { capacity: i.capacity != null ? String(i.capacity) : "", replacementBoxId: i.replacementBoxId ?? "", priceOverride: d.day === "SUN" && i.boxId === boxB.id ? "300" : "" })),
    }));
    cache.tags.length = 0;
    const r = await saveMenuDays(menuId, { title: "Seasonal", note: "", kitchenId: k2.id, kind: "SEASONAL" }, days);
    expect(r.ok).toBe(true);
    expect(cache.tags).toContain("menu");
    const revs = await db.weeklyMenuRevision.findMany({ where: { menuId }, orderBy: { version: "asc" } });
    expect(revs.map((x) => x.action)).toEqual(["SCHEDULE", "PUBLISH", "EDIT"]);
    const diff = diffSnapshots(revs[1].snapshot as unknown as MenuSnapshot, revs[2].snapshot as unknown as MenuSnapshot);
    expect(diff).toContainEqual({ scope: "SUN", change: "wp04-box-b price 250 → 300 Rs" });
    expect(diffSnapshots(null, revs[0].snapshot as unknown as MenuSnapshot)[0].change).toBe("First revision");
    const log = await db.auditLog.findFirst({ where: { entity: "WeeklyMenu", entityId: menuId, action: "menu.update" }, orderBy: { createdAt: "desc" } });
    expect(log?.before).toBeTruthy();
    expect(log?.after).toBeTruthy();
  });
});

describe("public listing", () => {
  it("enforces max daily quantity, shows remaining and the replacement, hides invisible dabbas", async () => {
    await db.lunchBox.update({ where: { id: boxA.id }, data: { maxDailyQty: 2 } });
    const offers = await getWeekOffers(W, k2.id);
    expect(offers.offers[0].items.find((i) => i.box.id === boxA.id)!.capacity).toBe(2); // min(day 5, box 2)
    expect(offers.offers[0].items.some((i) => i.box.id === boxHidden.id)).toBe(true); // staff can still order it

    let week = await getPublicWeek(W, "en", k2.id);
    let sun = week.days[0];
    expect(sun.cutoff).toBe("08:00");
    expect(sun.items.some((i) => i.box.id === boxHidden.id)).toBe(false);
    let a = sun.items.find((i) => i.box.id === boxA.id)!;
    expect(a.remaining).toBe(2);
    expect(a.box.isFeatured).toBe(true);
    expect(a.soldOut).toBe(false);

    await bookOrder(boxA.id, W, k2.id, 2);
    await bookOrder(boxA.id, W, k1.id, 1); // other kitchen doesn't count
    week = await getPublicWeek(W, "en", k2.id);
    sun = week.days[0];
    a = sun.items.find((i) => i.box.id === boxA.id)!;
    expect(a.remaining).toBe(0);
    expect(a.soldOut).toBe(true);
    expect(a.replacement).toEqual({ slug: boxB.slug, name: "wp04-box-b" });
  });

  it("hides dabbas unavailable at the kitchen (box or dish level)", async () => {
    as(owner.id, "SUPER_ADMIN");
    expect((await setKitchenAvailability({ boxId: boxB.id }, k2.id, false)).ok).toBe(true);
    let sun = (await getWeekOffers(W, k2.id)).offers[0];
    expect(sun.items.some((i) => i.box.id === boxB.id)).toBe(false);
    expect(sun.items.find((i) => i.box.id === boxA.id)!.replacement).toBeNull(); // replacement unavailable too
    // Without a kitchen, a box is only hidden if every active kitchen lacks it.
    expect((await getWeekOffers(W, null)).offers[0].items.some((i) => i.box.id === boxB.id)).toBe(true);
    expect((await setKitchenAvailability({ boxId: boxB.id }, k2.id, true)).ok).toBe(true);
    expect((await getWeekOffers(W, k2.id)).offers[0].items.some((i) => i.box.id === boxB.id)).toBe(true);

    expect((await setKitchenAvailability({ menuItemId: dishB.id }, k2.id, false)).ok).toBe(true);
    sun = (await getWeekOffers(W, k2.id)).offers[0];
    expect(sun.items.some((i) => i.box.id === boxB.id)).toBe(false);
    await setKitchenAvailability({ menuItemId: dishB.id }, k2.id, true);
  });
});

describe("unpublish guard", () => {
  it("refuses to unpublish while booked orders would be orphaned, then allows it once they're cancelled", async () => {
    as(owner.id, "SUPER_ADMIN");
    const r = await setMenuStatus(menuId, "DRAFT");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/booked order/);
    expect((await db.weeklyMenu.findUniqueOrThrow({ where: { id: menuId } })).status).toBe("PUBLISHED");

    await db.order.updateMany({ where: { kitchenId: k2.id, deliveryDate: dateOnly(W) }, data: { status: "CANCELLED" } });
    const ok = await setMenuStatus(menuId, "DRAFT");
    expect(ok.ok).toBe(true);
    const m = await db.weeklyMenu.findUniqueOrThrow({ where: { id: menuId }, include: { revisions: { orderBy: { version: "desc" }, take: 1 } } });
    expect(m.status).toBe("DRAFT");
    expect(m.revisions[0].action).toBe("UNPUBLISH");
    expect((await getWeekOffers(W, k2.id)).offers[0].menuId).not.toBe(menuId);
  });

  it("refuses publish/schedule without menu.publish", async () => {
    as(customer.id, "CUSTOMER");
    await expect(setMenuStatus(menuId, "PUBLISHED")).rejects.toThrow(/FORBIDDEN:menu.publish/);
    await expect(scheduleMenuAction(menuId, { ok: false }, fd({ publishAt: "2030-01-01T10:00" }))).rejects.toThrow(/FORBIDDEN/);
  });
});

describe("meal categories", () => {
  it("creates, reorders and assigns categories that show on the public menu", async () => {
    as(owner.id, "SUPER_ADMIN");
    expect((await saveCategory(null, { ok: false }, fd({ name: "Zz WP04 bowls", slug: "", nameNe: "", sortOrder: "999", isActive: "on" }))).ok).toBe(true);
    const cat = await db.mealCategory.findUniqueOrThrow({ where: { slug: "zz-wp04-bowls" } });
    const before = cat.sortOrder;
    expect((await moveCategory(cat.id, -1)).ok).toBe(true);
    expect((await db.mealCategory.findUniqueOrThrow({ where: { id: cat.id } })).sortOrder).toBeLessThan(before);
    await db.lunchBox.update({ where: { id: boxB.id }, data: { categoryId: cat.id } });
    await publishMenuForCategories();
    const week = await getPublicWeek(W, "en", k2.id);
    expect(week.days[1].items.find((i) => i.box.id === boxB.id)!.box.category?.slug).toBe("zz-wp04-bowls");
  });
});

async function publishMenuForCategories() {
  const r = await setMenuStatus(menuId, "PUBLISHED");
  expect(r.ok).toBe(true);
}
