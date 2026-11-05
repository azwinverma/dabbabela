import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";

// Server actions run their real permission checks against this fake signed-in user.
const session = vi.hoisted(() => ({ user: null as null | { id: string; role: Role }, customerEmail: null as string | null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const { can } = await import("@/lib/permissions");
  const { db } = await import("@/lib/db");
  return {
    ...real,
    getCurrentUser: async () => {
      if (!session.customerEmail) return null;
      const { loadUser } = await import("../helpers");
      return loadUser(session.customerEmail);
    },
    requirePermission: async (perm: Parameters<typeof can>[1]) => {
      if (!session.user || !can(session.user.role, perm)) throw new Error(`FORBIDDEN:${perm}`);
      return { ...(await db.user.findUniqueOrThrow({ where: { id: session.user.id } })), role: session.user.role, addresses: [], membership: null, sessionId: "t" };
    },
  };
});

import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { builderGroups, priceCustomBox } from "@/server/builder";
import { stockOnHand } from "@/server/inventory";
import { defaultKitchenId, quoteCart } from "@/server/orders";
import { quoteBuildAction, saveBuildAction } from "@/lib/actions/build";
import { addOption, addPortion, addRule, saveGroup, setOptionAvailability } from "@/app/admin/builder/actions";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

const CUSTOMER = "customer.b@demo.dabbabela.local";
const as = (id: string, role: Role) => (session.user = { id, role });
const fd = (o: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) d.set(k, v);
  return d;
};

let owner: { id: string };
let settings: Awaited<ReturnType<typeof getSettings>>;
let kitchenId: string;
const dish: Record<string, { id: string; price: number; name: string }> = {};
const groupIds: string[] = [];
const ruleIds: string[] = [];
const couponIds: string[] = [];
let baseGroup: string, extraGroup: string, paneerOption: string;

async function mkGroup(key: string, data: { name: string; minSelect: number; maxSelect: number; sortOrder: number; dietRule?: string | null }, items: string[]) {
  const g = await db.customizationGroup.create({ data: { key, category: "MAIN", ...data } });
  groupIds.push(g.id);
  for (const [i, k] of items.entries()) await db.customizationOption.create({ data: { groupId: g.id, menuItemId: dish[k].id, sortOrder: i } });
  return g.id;
}

beforeAll(async () => {
  owner = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
  settings = await getSettings();
  kitchenId = (await defaultKitchenId())!;
  const names = { rice: "Steamed rice", jeera: "Jeera rice", dal: "Mas-moong dal", paneer: "Paneer tarkari", chicken: "Chicken curry" };
  for (const [k, name] of Object.entries(names)) {
    const d = await db.menuItem.findFirstOrThrow({ where: { name } });
    dish[k] = { id: d.id, price: d.price, name: d.name };
  }
  // Negative sort order: these steps come before the seeded ones, so the dishes are counted here.
  baseGroup = await mkGroup("wp05-base", { name: "Base", minSelect: 1, maxSelect: 1, sortOrder: -20 }, ["rice", "jeera"]);
  extraGroup = await mkGroup("wp05-extra", { name: "Curries", minSelect: 0, maxSelect: 2, sortOrder: -19 }, ["dal", "paneer", "chicken"]);
  paneerOption = (await db.customizationOption.findFirstOrThrow({ where: { groupId: extraGroup, menuItemId: dish.paneer.id } })).id;
});

afterAll(async () => {
  await db.comboRule.deleteMany({ where: { id: { in: ruleIds } } });
  await db.customizationGroup.deleteMany({ where: { id: { in: groupIds } } });
  await db.coupon.deleteMany({ where: { id: { in: couponIds } } });
  session.user = null;
  session.customerEmail = null;
});

describe("builder engine", () => {
  it("enforces min / max per step", async () => {
    expect((await priceCustomBox([], settings)).problem).toBe("Pick your dishes");
    expect((await priceCustomBox([{ menuItemId: dish.dal.id, qty: 1 }], settings)).problems).toContain("Base: pick one");
    expect((await priceCustomBox([{ menuItemId: dish.rice.id, qty: 1 }, { menuItemId: dish.jeera.id, qty: 1 }], settings)).problems).toContain("Base: only one allowed");
    const tooMany = await priceCustomBox([{ menuItemId: dish.rice.id, qty: 1 }, { menuItemId: dish.dal.id, qty: 2 }, { menuItemId: dish.paneer.id, qty: 1 }], settings);
    expect(tooMany.problems).toContain("Curries: up to 2 only");
    const ok = await priceCustomBox([{ menuItemId: dish.rice.id, qty: 1 }, { menuItemId: dish.dal.id, qty: 1 }], settings);
    expect(ok.problem).toBeNull();
    expect(ok.rawPrice).toBe(dish.rice.price + dish.dal.price);
    expect(ok.price).toBe(Math.max(settings.builderMinPrice, ok.rawPrice));
  });

  it("applies compatibility rules (EXCLUDE and REQUIRE) and refuses contradictions", async () => {
    as(owner.id, "SUPER_ADMIN");
    expect((await addRule({ ok: false }, fd({ kind: "REQUIRE", itemAId: dish.paneer.id, itemBId: dish.jeera.id, message: "Paneer comes with jeera rice" }))).ok).toBe(true);
    expect((await addRule({ ok: false }, fd({ kind: "EXCLUDE", itemAId: dish.dal.id, itemBId: dish.chicken.id }))).ok).toBe(true);
    ruleIds.push(...(await db.comboRule.findMany({ where: { OR: [{ itemAId: dish.paneer.id, itemBId: dish.jeera.id }, { itemAId: dish.dal.id, itemBId: dish.chicken.id }] } })).map((r) => r.id));
    const clash = await addRule({ ok: false }, fd({ kind: "EXCLUDE", itemAId: dish.paneer.id, itemBId: dish.jeera.id }));
    expect(clash.ok).toBe(false);

    expect((await priceCustomBox([{ menuItemId: dish.rice.id, qty: 1 }, { menuItemId: dish.paneer.id, qty: 1 }], settings)).problems).toContain("Paneer comes with jeera rice");
    expect((await priceCustomBox([{ menuItemId: dish.jeera.id, qty: 1 }, { menuItemId: dish.paneer.id, qty: 1 }], settings)).problem).toBeNull();
    const ex = await priceCustomBox([{ menuItemId: dish.rice.id, qty: 1 }, { menuItemId: dish.dal.id, qty: 1 }, { menuItemId: dish.chicken.id, qty: 1 }], settings);
    expect(ex.problems.some((p) => /don't go in the same dabba/.test(p))).toBe(true);
    expect(await db.auditLog.count({ where: { action: "builder.rule", actorId: owner.id } })).toBeGreaterThanOrEqual(2);
  });

  it("enforces diet rules: box-wide, customer-chosen and per step", async () => {
    await db.customizationGroup.update({ where: { id: baseGroup }, data: { dietRule: "VEG_BOX" } });
    const vegBox = await priceCustomBox([{ menuItemId: dish.rice.id, qty: 1 }, { menuItemId: dish.chicken.id, qty: 1 }], settings);
    expect(vegBox.problems.some((p) => p.startsWith(`${dish.chicken.name} can't go in a veg dabba`))).toBe(true);
    await db.customizationGroup.update({ where: { id: baseGroup }, data: { dietRule: null } });
    expect((await priceCustomBox([{ menuItemId: dish.rice.id, qty: 1 }, { menuItemId: dish.chicken.id, qty: 1 }], settings)).problem).toBeNull();
    // The customer asked for a veg dabba.
    expect((await priceCustomBox([{ menuItemId: dish.rice.id, qty: 1 }, { menuItemId: dish.chicken.id, qty: 1 }], settings, { diet: "VEG" })).problem).toMatch(/veg dabba/);
    // Step rule: chicken is hidden from a VEG_ONLY step and refused if submitted anyway.
    as(owner.id, "SUPER_ADMIN");
    expect((await saveGroup(extraGroup, { ok: false }, fd({ name: "Curries", category: "MAIN", minSelect: "0", maxSelect: "2", sortOrder: "-19", isActive: "on", dietRule: "VEG_ONLY" }))).ok).toBe(true);
    const g = (await builderGroups()).find((x) => x.id === extraGroup)!;
    expect(g.options.some((o) => o.menuItemId === dish.chicken.id)).toBe(false);
    // (Chicken is also in the seeded Protein step, so switch that off while checking.)
    await db.customizationGroup.update({ where: { key: "protein" }, data: { isActive: false } });
    try {
      expect((await priceCustomBox([{ menuItemId: dish.rice.id, qty: 1 }, { menuItemId: dish.chicken.id, qty: 1 }], settings)).problem).toMatch(/no longer available/);
    } finally {
      await db.customizationGroup.update({ where: { key: "protein" }, data: { isActive: true } });
    }
    // Admin can't add a non-veg dish to a veg-only step.
    await db.customizationOption.deleteMany({ where: { groupId: extraGroup, menuItemId: dish.chicken.id } });
    expect((await addOption(extraGroup, { ok: false }, fd({ menuItemId: dish.chicken.id }))).ok).toBe(false);
    expect((await saveGroup(extraGroup, { ok: false }, fd({ name: "Curries", category: "MAIN", minSelect: "0", maxSelect: "2", sortOrder: "-19", isActive: "on", dietRule: "BOGUS" }))).ok).toBe(false);
    expect((await saveGroup(extraGroup, { ok: false }, fd({ name: "Curries", category: "MAIN", minSelect: "0", maxSelect: "2", sortOrder: "-19", isActive: "on", dietRule: "" }))).ok).toBe(true);
    expect((await addOption(extraGroup, { ok: false }, fd({ menuItemId: dish.chicken.id }))).ok).toBe(true);
  });

  it("prices portions from the server and checks the portion exists", async () => {
    as(owner.id, "SUPER_ADMIN");
    expect((await addPortion(paneerOption, { ok: false }, fd({ label: "Regular", qtyMultiplier: "1", priceDelta: "0" }))).ok).toBe(true);
    expect((await addPortion(paneerOption, { ok: false }, fd({ label: "Large", qtyMultiplier: "1.5", priceDelta: "30" }))).ok).toBe(true);
    expect((await addPortion(paneerOption, { ok: false }, fd({ label: "Free", qtyMultiplier: "1", priceDelta: "-99999" }))).ok).toBe(false);
    expect(await db.auditLog.count({ where: { action: "builder.portion_create", entityId: { not: null } } })).toBeGreaterThanOrEqual(2);
    const large = await db.customizationPortion.findFirstOrThrow({ where: { optionId: paneerOption, label: "Large" } });
    const regular = await db.customizationPortion.findFirstOrThrow({ where: { optionId: paneerOption, label: "Regular" } });

    const r = await priceCustomBox([{ menuItemId: dish.jeera.id, qty: 1 }, { menuItemId: dish.paneer.id, qty: 2, portionId: large.id }], settings);
    expect(r.problem).toBeNull();
    expect(r.rawPrice).toBe(dish.jeera.price + (dish.paneer.price + 3000) * 2);
    expect(r.components.find((c) => c.menuItemId === dish.paneer.id)!.qtyMultiplier).toBe(1.5);
    expect(r.details).toMatch(/Large/);
    // No portion given → the first (default) one, saved back into the picks.
    const d = await priceCustomBox([{ menuItemId: dish.jeera.id, qty: 1 }, { menuItemId: dish.paneer.id, qty: 1 }], settings);
    expect(d.rawPrice).toBe(dish.jeera.price + dish.paneer.price);
    expect(d.picks.find((p) => p.menuItemId === dish.paneer.id)!.portionId).toBe(regular.id);
    // A portion from somewhere else is refused.
    expect((await priceCustomBox([{ menuItemId: dish.jeera.id, qty: 1 }, { menuItemId: dish.paneer.id, qty: 1, portionId: "nope" }], settings)).problem).toMatch(/portion size/);
  });

  it("ignores tampered client prices: quote and saved dabba use the server price", async () => {
    session.customerEmail = CUSTOMER;
    const large = await db.customizationPortion.findFirstOrThrow({ where: { optionId: paneerOption, label: "Large" } });
    const tampered = [
      { menuItemId: dish.jeera.id, qty: 1, price: 1, unitPrice: 1 },
      { menuItemId: dish.paneer.id, qty: 1, portionId: large.id, price: 1, priceDelta: -100000 },
    ];
    const server = await priceCustomBox([{ menuItemId: dish.jeera.id, qty: 1 }, { menuItemId: dish.paneer.id, qty: 1, portionId: large.id }], settings);
    const q = await quoteBuildAction(tampered);
    expect(q.price).toBe(server.price);
    expect(q.price).not.toBe(2);
    const saved = await saveBuildAction({ name: "Tamper test", picks: tampered });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.price).toBe(server.price);
    const row = await db.customBox.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.price).toBe(server.price);
    expect(JSON.stringify(row.items)).not.toMatch(/unitPrice|priceDelta/);
    // Saving something invalid is refused with the validation message.
    const bad = await saveBuildAction({ name: "x", picks: [{ menuItemId: dish.dal.id, qty: 1 }] });
    expect(bad).toMatchObject({ ok: false, message: "Base: pick one" });
    await db.customBox.delete({ where: { id: saved.id } });
    session.customerEmail = null;
  });

  it("respects per-kitchen availability and gives a soft stock warning", async () => {
    as(owner.id, "SUPER_ADMIN");
    expect((await setOptionAvailability(paneerOption, kitchenId, false, "No paneer today")).ok).toBe(true);
    expect((await builderGroups({ kitchenId })).find((g) => g.id === extraGroup)!.options.some((o) => o.id === paneerOption)).toBe(false);
    const off = await priceCustomBox([{ menuItemId: dish.jeera.id, qty: 1 }, { menuItemId: dish.paneer.id, qty: 1 }], settings, { kitchenId });
    expect(off.problem).toMatch(/isn't available from your kitchen/);
    expect((await setOptionAvailability(paneerOption, kitchenId, true)).ok).toBe(true);
    expect((await priceCustomBox([{ menuItemId: dish.jeera.id, qty: 1 }, { menuItemId: dish.paneer.id, qty: 1 }], settings, { kitchenId })).problem).toBeNull();

    // Stock: warn (never block) when an ingredient for the picked dishes is short.
    const recipe = await db.recipe.findUniqueOrThrow({ where: { menuItemId: dish.paneer.id }, include: { currentVersion: { include: { ingredients: true } } } });
    const ing = recipe.currentVersion!.ingredients[0];
    const have = (await stockOnHand(kitchenId, [ing.ingredientId])).get(ing.ingredientId) ?? 0;
    await db.stockMovement.create({ data: { ingredientId: ing.ingredientId, kitchenId, type: "ADJUSTMENT", quantity: -have, note: "wp05 test" } });
    const low = await priceCustomBox([{ menuItemId: dish.jeera.id, qty: 1 }, { menuItemId: dish.paneer.id, qty: 1 }], settings, { kitchenId, checkStock: true });
    expect(low.problem).toBeNull();
    expect(low.warnings.join(" ")).toMatch(/Running low/);
    await db.stockMovement.create({ data: { ingredientId: ing.ingredientId, kitchenId, type: "ADJUSTMENT", quantity: have, note: "wp05 test undo" } });
  });

  it("refuses builder edits without menu.edit", async () => {
    const customer = await db.user.findUniqueOrThrow({ where: { email: CUSTOMER } });
    as(customer.id, "CUSTOMER");
    await expect(addPortion(paneerOption, { ok: false }, fd({ label: "Huge", qtyMultiplier: "2", priceDelta: "10" }))).rejects.toThrow(/FORBIDDEN/);
    await expect(setOptionAvailability(paneerOption, kitchenId, false)).rejects.toThrow(/FORBIDDEN/);
  });
});

describe("checkout coupons (pricing.ts)", () => {
  async function coupon(code: string, data: Partial<{ type: "PERCENT" | "FLAT"; value: number; freeDelivery: boolean; boxIds: string[] }>) {
    const c = await db.coupon.create({ data: { code, type: "PERCENT", value: 10, perUserLimit: null, ...data } });
    couponIds.push(c.id);
    return c;
  }

  it("scopes a coupon to listed dabbas and makes delivery free when the coupon says so", async () => {
    const user = await loadUser(CUSTOMER);
    const addressId = user.addresses[0].id;
    const d = serviceDay(3);
    const box = await primaryBoxOn(d);
    const lines = [{ kind: "box", id: box.id, date: d, qty: 1 }];
    const plain = await quoteCart(user, { lines, addressId });
    expect(plain.ok).toBe(true);

    await coupon("WP05BOX", { boxIds: [box.id] });
    const scoped = await quoteCart(user, { lines, addressId, couponCode: "WP05BOX" });
    expect(scoped.couponError).toBeNull();
    expect(scoped.couponDiscount).toBe(Math.round((plain.subtotal - plain.companyDiscount) * 0.1));

    await coupon("WP05OTHER", { boxIds: ["some-other-box"] });
    const other = await quoteCart(user, { lines, addressId, couponCode: "WP05OTHER" });
    expect(other.couponDiscount).toBe(0);
    expect(other.total).toBe(plain.total);

    await coupon("WP05SHIP", { type: "FLAT", value: 100, freeDelivery: true });
    const ship = await quoteCart(user, { lines, addressId, couponCode: "WP05SHIP" });
    expect(ship.couponError).toBeNull();
    expect(ship.deliveryFee).toBe(0);
    expect(ship.total).toBe(plain.total - plain.deliveryFee - 100 - (plain.taxInclusive ? 0 : plain.tax - ship.tax));
    expect(ship.total).toBeGreaterThanOrEqual(0);

    await coupon("WP05HUGE", { type: "FLAT", value: 10_000_000 });
    const huge = await quoteCart(user, { lines, addressId, couponCode: "WP05HUGE" });
    expect(huge.total).toBeGreaterThanOrEqual(0);
    expect(huge.discount).toBeLessThanOrEqual(huge.subtotal);
  });
});
