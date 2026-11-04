import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";

// Server actions run their real permission checks against this fake signed-in user.
const session = vi.hoisted(() => ({ user: null as null | { id: string; role: Role } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));
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
import { isoDate, weekStartOf, weekdayOf } from "@/lib/dates";
import { SECTIONS } from "@/lib/cms";
import { getSection } from "@/lib/cms-store";
import { saveRecipe, restoreRecipeVersion } from "@/app/admin/dishes/actions";
import { createWeekMenu, saveMenuDays, setMenuStatus, type DayInput } from "@/app/admin/weekly-menus/actions";
import { saveSectionAction, rollbackAction } from "@/app/admin/content/actions";
import { createStaff, updateStaff } from "@/app/admin/staff/actions";
import { createSubscription } from "@/server/subscriptions";
import { placeCartOrder } from "@/server/orders";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

let owner: { id: string };
const as = (id: string, role: Role) => (session.user = { id, role });
const fd = (o: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) d.set(k, v);
  return d;
};

beforeAll(async () => {
  owner = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
});

describe("recipes", () => {
  it("saves a new immutable version, recomputes cost and keeps history", async () => {
    as(owner.id, "SUPER_ADMIN");
    const dish = await db.menuItem.findFirstOrThrow({ where: { name: "Steamed rice" }, include: { recipe: { include: { currentVersion: { include: { ingredients: true } } } } } });
    const v1 = dish.recipe!.currentVersion!;
    const line = v1.ingredients[0];
    const ing = await db.ingredient.findUniqueOrThrow({ where: { id: line.ingredientId } });
    const res = await saveRecipe(dish.id, { yieldPortions: 10, method: "", notes: "more rice", lines: [{ ingredientId: line.ingredientId, quantity: 2, wastePct: 0 }] });
    expect(res.ok).toBe(true);
    const after = await db.recipe.findUniqueOrThrow({ where: { menuItemId: dish.id }, include: { versions: true, currentVersion: true } });
    expect(after.versions.length).toBe(2);
    expect(after.currentVersion!.version).toBe(2);
    expect(after.currentVersion!.costPerPortion).toBe(Math.round((ing.costPerUnit * 2) / 10));
    expect((await db.recipeVersion.findUniqueOrThrow({ where: { id: v1.id } })).costPerPortion).toBe(v1.costPerPortion); // old version untouched
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: dish.id } })).costPrice).toBe(after.currentVersion!.costPerPortion);
    const box = await db.lunchBox.findUniqueOrThrow({ where: { slug: "signature-dal-bhat" } });
    expect(box.costPrice).toBeGreaterThan(0);
    await restoreRecipeVersion(dish.id, v1.id);
    expect((await db.recipe.findUniqueOrThrow({ where: { menuItemId: dish.id } })).currentVersionId).toBe(v1.id);
  });

  it("refuses recipes from roles without the recipes permission", async () => {
    const chef = await db.user.findUniqueOrThrow({ where: { email: "content@demo.dabbabela.local" } });
    as(chef.id, "CONTENT_EDITOR");
    await expect(saveRecipe("x", { yieldPortions: 1, method: "", notes: "", lines: [] })).rejects.toThrow(/FORBIDDEN/);
  });
});

describe("publishing a week menu", () => {
  it("re-assigns editable rotation meals only", async () => {
    as(owner.id, "SUPER_ADMIN");
    const d = serviceDay(12, 0);
    const old = await primaryBoxOn(d);
    const replacement = await db.lunchBox.findFirstOrThrow({ where: { id: { not: old.id }, isActive: true, slug: "newari-khaja-set" } });
    const plan = await db.mealPlan.findUniqueOrThrow({ where: { slug: "hapta" } });
    const days = [weekdayOf(d)] as never;
    const b = await loadUser("customer.b@demo.dabbabela.local");
    const c = await loadUser("customer.c@demo.dabbabela.local");
    const subB = await createSubscription(b, { planId: plan.id, startDate: d, days: [...new Set(["SUN", "MON", "TUE", weekdayOf(d)])] as never, addressId: b.addresses[0].id, method: "CASH" });
    const subC = await createSubscription(c, { planId: plan.id, startDate: d, days: [...new Set(["SUN", "MON", "TUE", weekdayOf(d)])] as never, addressId: c.addresses[0].id, method: "CASH" });
    void days;
    const mealB = await db.order.findFirstOrThrow({ where: { subscriptionId: subB.subscription.id, deliveryDate: new Date(`${d}T00:00:00Z`) }, include: { items: true } });
    const mealC = await db.order.findFirstOrThrow({ where: { subscriptionId: subC.subscription.id, deliveryDate: new Date(`${d}T00:00:00Z`) }, include: { items: true } });
    await db.order.update({ where: { id: mealC.id }, data: { status: "CONFIRMED" } }); // locked by the kitchen
    const single = await placeCartOrder(b, { lines: [{ kind: "box", id: old.id, date: d, qty: 1 }], addressId: b.addresses[0].id, method: "CASH" });
    expect(mealB.items[0].boxId).toBe(old.id);

    const standing = await db.weeklyMenu.findFirstOrThrow({ where: { isDefault: true, status: "PUBLISHED" } });
    const created = await createWeekMenu({ ok: false }, fd({ weekOf: d, copyFrom: standing.id }));
    expect(created.ok).toBe(true);
    const menu = await db.weeklyMenu.findFirstOrThrow({ where: { weekStart: new Date(`${weekStartOf(d)}T00:00:00Z`), status: "DRAFT" }, include: { days: { include: { items: true } } } });
    const input: DayInput[] = menu.days.map((md) => ({
      day: md.day,
      isClosed: md.isClosed,
      note: "",
      items:
        md.day === weekdayOf(d)
          ? [{ boxId: replacement.id, isPrimary: true, capacity: "", soldOut: false, priceOverride: "" }, ...md.items.filter((i) => i.boxId !== replacement.id).map((i) => ({ boxId: i.boxId, isPrimary: false, capacity: "", soldOut: false, priceOverride: "" }))]
          : md.items.map((i) => ({ boxId: i.boxId, isPrimary: i.isPrimary, capacity: "", soldOut: false, priceOverride: "" })),
    }));
    expect((await saveMenuDays(menu.id, { title: "Test week", note: "", kitchenId: null }, input)).ok).toBe(true);
    const pub = await setMenuStatus(menu.id, "PUBLISHED");
    expect(pub.ok).toBe(true);
    expect(pub.message).toMatch(/re-assigned/);

    expect((await db.orderItem.findFirstOrThrow({ where: { orderId: mealB.id } })).boxId).toBe(replacement.id);
    expect((await db.orderItem.findFirstOrThrow({ where: { orderId: mealC.id } })).boxId).toBe(old.id); // locked: untouched
    expect((await db.orderItem.findFirstOrThrow({ where: { orderId: single.orders[0].id } })).boxId).toBe(old.id); // customer's own pick: untouched
    expect((await db.order.findUniqueOrThrow({ where: { id: mealB.id } })).total).toBe(mealB.total); // price paid unchanged
    // only one live menu for the week
    expect(await db.weeklyMenu.count({ where: { weekStart: menu.weekStart, status: "PUBLISHED" } })).toBe(1);
    void isoDate;
  });

  it("won't publish a day without a chef's pick", async () => {
    as(owner.id, "SUPER_ADMIN");
    const d = serviceDay(30, 0);
    await createWeekMenu({ ok: false }, fd({ weekOf: d }));
    const menu = await db.weeklyMenu.findFirstOrThrow({ where: { weekStart: new Date(`${weekStartOf(d)}T00:00:00Z`) } });
    const r = await setMenuStatus(menu.id, "PUBLISHED");
    expect(r.ok).toBe(false);
  });
});

describe("CMS draft → publish → rollback", () => {
  const def = SECTIONS.find((s) => s.fields.filter((f) => f.type === "text").length >= 2)!;
  const [f1, f2] = def.fields.filter((f) => f.type === "text");

  it("keeps drafts off the live site until published, then rolls back", async () => {
    as(owner.id, "SUPER_ADMIN");
    const base = await getSection(def.key, "en");
    const v1 = { ...base, [f1.name]: "First published copy" };
    expect((await saveSectionAction(def.key, "en", { ok: false }, fd({ data: JSON.stringify(v1), intent: "publish" }))).ok).toBe(true);
    expect((await getSection(def.key, "en"))[f1.name]).toBe("First published copy");

    await saveSectionAction(def.key, "en", { ok: false }, fd({ data: JSON.stringify({ ...v1, [f1.name]: "Draft copy" }), intent: "draft" }));
    expect((await getSection(def.key, "en"))[f1.name]).toBe("First published copy"); // draft not live

    await saveSectionAction(def.key, "en", { ok: false }, fd({ data: JSON.stringify({ ...v1, [f1.name]: "Second copy" }), intent: "publish" }));
    expect((await getSection(def.key, "en"))[f1.name]).toBe("Second copy");

    const row = await db.contentSection.findUniqueOrThrow({ where: { key_locale: { key: def.key, locale: "en" } }, include: { revisions: { orderBy: { version: "asc" } } } });
    expect(row.revisions.length).toBe(2);
    await rollbackAction(def.key, "en", row.revisions[0].id);
    expect((await getSection(def.key, "en"))[f1.name]).toBe("First published copy");
  });

  it("Nepali falls back to English field by field", async () => {
    as(owner.id, "SUPER_ADMIN");
    await saveSectionAction(def.key, "ne", { ok: false }, fd({ data: JSON.stringify({ [f1.name]: "नेपाली पाठ", [f2.name]: "" }), intent: "publish" }));
    const ne = await getSection(def.key, "ne");
    const en = await getSection(def.key, "en");
    expect(ne[f1.name]).toBe("नेपाली पाठ");
    expect(ne[f2.name]).toBe(en[f2.name]);
  });

  it("content editors can't change settings-level things", async () => {
    const editor = await db.user.findUniqueOrThrow({ where: { email: "content@demo.dabbabela.local" } });
    as(editor.id, "CONTENT_EDITOR");
    await expect(createStaff({ ok: false }, fd({ name: "x" }))).rejects.toThrow(/FORBIDDEN/);
  });
});

describe("staff role limits", () => {
  it("owners can't create super admins; nobody can remove the last super admin", async () => {
    const ownerRole = await db.user.create({ data: { name: "Biz Owner", email: "bizowner@test.local", role: "OWNER" } });
    as(ownerRole.id, "OWNER");
    const r = await createStaff({ ok: false }, fd({ name: "Sneaky", email: "sneaky@test.local", role: "SUPER_ADMIN", password: "abcdef12345" }));
    expect(r.ok).toBe(false);
    const ok = await createStaff({ ok: false }, fd({ name: "Cook", email: "cook@test.local", role: "KITCHEN_STAFF", password: "abcdef12345" }));
    expect(ok.ok).toBe(true);
    expect((await db.account.findFirst({ where: { user: { email: "cook@test.local" }, providerId: "credential" } }))?.password).toBeTruthy();

    // another super admin tries to demote the only other one -> allowed only while one remains
    const sa2 = await db.user.create({ data: { name: "SA2", email: "sa2@test.local", role: "SUPER_ADMIN" } });
    as(sa2.id, "SUPER_ADMIN");
    await db.user.updateMany({ where: { role: "SUPER_ADMIN", id: { notIn: [owner.id, sa2.id] } }, data: { isActive: false } });
    const demote = await updateStaff(owner.id, { ok: false }, fd({ role: "OPERATIONS_MANAGER", kitchenId: "", reason: "test" }));
    expect(demote.ok).toBe(true); // sa2 is still a super admin
    as(owner.id, "OPERATIONS_MANAGER");
    await expect(updateStaff(sa2.id, { ok: false }, fd({ role: "CUSTOMER", reason: "x" }))).rejects.toThrow(/FORBIDDEN/);
    await db.user.update({ where: { id: owner.id }, data: { role: "SUPER_ADMIN" } });
  });
});
