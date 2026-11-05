"use server";

import type { ItemCategory } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { getSettings, saveSettings } from "@/lib/settings";
import { CATEGORY_LABEL } from "@/lib/labels";
import { slugify } from "@/lib/utils";
import { DIET_RULES, dietSatisfies, isDietRule } from "@/server/builder";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

const CATS = Object.keys(CATEGORY_LABEL) as ItemCategory[];

export async function saveGroup(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const name = f.str(fd, "name", 80);
    if (!name) throw new FieldError("name", "Name is required");
    const category = f.str(fd, "category") as ItemCategory;
    if (!CATS.includes(category)) throw new FieldError("category", "Pick a category");
    const minSelect = f.int(fd, "minSelect", 0, 0, 10);
    const maxSelect = f.int(fd, "maxSelect", 1, 0, 10);
    if (maxSelect < minSelect) throw new FieldError("maxSelect", "Max must be at least the min");
    if (maxSelect < 1) throw new FieldError("maxSelect", "Max must be at least 1");
    const ruleRaw = f.str(fd, "dietRule");
    if (ruleRaw && !isDietRule(ruleRaw)) throw new FieldError("dietRule", "Pick a diet rule from the list");
    const dietRule = ruleRaw || null;
    const data = { name, nameNe: f.opt(fd, "nameNe", 80), category, minSelect, maxSelect, sortOrder: f.int(fd, "sortOrder", 0), isActive: f.bool(fd, "isActive"), dietRule };
    const before = id ? await db.customizationGroup.findUnique({ where: { id } }) : null;
    const g = id ? await db.customizationGroup.update({ where: { id }, data }) : await db.customizationGroup.create({ data: { ...data, key: `${slugify(name)}-${Date.now().toString(36)}` } });
    await audit({ actorId: user.id, action: id ? "builder.group_update" : "builder.group_create", entity: "CustomizationGroup", entityId: g.id, before, after: data });
    return done(id ? "Step saved" : "Step added");
  }, ["/admin/builder", "/build"]);
}

export async function deleteGroup(id: string): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const g = await db.customizationGroup.delete({ where: { id } });
    await audit({ actorId: user.id, action: "builder.group_delete", entity: "CustomizationGroup", entityId: id, before: g });
    return done("Step removed");
  }, ["/admin/builder"]);
}

export async function addOption(groupId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const menuItemId = f.str(fd, "menuItemId");
    if (!menuItemId) return fail("Pick a dish");
    const [group, dish] = await Promise.all([db.customizationGroup.findUnique({ where: { id: groupId } }), db.menuItem.findUnique({ where: { id: menuItemId } })]);
    if (!group || !dish) return fail("That step or dish no longer exists");
    if (isDietRule(group.dietRule)) {
      const rule = DIET_RULES[group.dietRule];
      if (rule.scope === "GROUP" && !dietSatisfies(dish.diet, rule.level)) return fail(`${dish.name} doesn't fit this step's rule (${rule.label.toLowerCase()})`);
    }
    const priceOverride = f.moneyOpt(fd, "priceOverride", "Price override");
    const o = await db.customizationOption.upsert({
      where: { groupId_menuItemId: { groupId, menuItemId } },
      create: { groupId, menuItemId, priceOverride, isDefault: f.bool(fd, "isDefault"), sortOrder: f.int(fd, "sortOrder", 0) },
      update: { priceOverride, isDefault: f.bool(fd, "isDefault") },
    });
    await audit({ actorId: user.id, action: "builder.option", entity: "CustomizationGroup", entityId: groupId, after: { optionId: o.id, menuItemId, priceOverride: o.priceOverride, isDefault: o.isDefault } });
    return done("Option saved");
  }, ["/admin/builder", "/build"]);
}

export async function removeOption(id: string): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const o = await db.customizationOption.delete({ where: { id } });
    await audit({ actorId: user.id, action: "builder.option_delete", entity: "CustomizationGroup", entityId: o.groupId, before: o });
    return done();
  }, ["/admin/builder", "/build"]);
}

export async function addRule(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const kind = f.str(fd, "kind") === "REQUIRE" ? "REQUIRE" : "EXCLUDE";
    const itemAId = f.str(fd, "itemAId");
    const itemBId = f.str(fd, "itemBId");
    if (!itemAId || !itemBId || itemAId === itemBId) return fail("Pick two different dishes");
    // Refuse contradictions: "A needs B" and "A never with B" (either way round) can't both hold.
    const other = kind === "REQUIRE" ? ["EXCLUDE"] : ["REQUIRE", "REQUIRES"];
    const clash = await db.comboRule.findFirst({ where: { kind: { in: other }, OR: [{ itemAId, itemBId }, { itemAId: itemBId, itemBId: itemAId }] } });
    if (clash) return fail("That contradicts an existing rule for these two dishes — delete the other rule first");
    const r = await db.comboRule.upsert({
      where: { kind_itemAId_itemBId: { kind, itemAId, itemBId } },
      create: { kind, itemAId, itemBId, message: f.opt(fd, "message", 160) },
      update: { message: f.opt(fd, "message", 160) },
    });
    await audit({ actorId: user.id, action: "builder.rule", entity: "ComboRule", entityId: r.id, after: r });
    return done("Rule saved");
  }, ["/admin/builder"]);
}

export async function deleteRule(id: string): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const r = await db.comboRule.delete({ where: { id } });
    await audit({ actorId: user.id, action: "builder.rule_delete", entity: "ComboRule", entityId: id, before: r });
    return done();
  }, ["/admin/builder"]);
}

export async function saveBuilderLimits(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const before = await getSettings();
    const builderMinPrice = f.money(fd, "builderMinPrice", "Minimum dabba price");
    const builderMaxQty = f.int(fd, "builderMaxQty", 3, 1, 5);
    await saveSettings({ builderMinPrice, builderMaxQty });
    await audit({ actorId: user.id, action: "settings.builder", entity: "Setting", entityId: "site", before: { builderMinPrice: before.builderMinPrice, builderMaxQty: before.builderMaxQty }, after: { builderMinPrice, builderMaxQty } });
    return done("Limits saved");
  }, ["/admin/builder", "/build"]);
}

// ───────────── portions ─────────────

/** Rupees typed by staff, may be negative (a smaller portion) → paisa. */
function signedMoney(fd: FormData, k: string, label: string) {
  const raw = f.str(fd, k);
  const neg = raw.startsWith("-") || raw.startsWith("−");
  const tmp = new FormData();
  tmp.set(k, neg ? raw.slice(1) : raw || "0");
  const abs = f.money(tmp, k, label);
  return neg ? -abs : abs;
}

export async function addPortion(optionId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const option = await db.customizationOption.findUnique({ where: { id: optionId }, include: { menuItem: true, portions: true } });
    if (!option) return fail("That option no longer exists");
    const label = f.str(fd, "label", 40);
    if (!label) throw new FieldError("label", "Name the portion, e.g. Regular or Large");
    if (option.portions.some((p) => p.label.toLowerCase() === label.toLowerCase())) throw new FieldError("label", "That portion already exists");
    const qtyMultiplier = Math.round(f.num(fd, "qtyMultiplier", 1) * 100) / 100;
    if (!(qtyMultiplier > 0 && qtyMultiplier <= 5)) throw new FieldError("qtyMultiplier", "Size must be more than 0× and at most 5×");
    const priceDelta = signedMoney(fd, "priceDelta", "Price change");
    const base = option.priceOverride ?? option.menuItem.price;
    if (base + priceDelta < 0) throw new FieldError("priceDelta", "That would make the dish cost less than nothing");
    const p = await db.customizationPortion.create({
      data: { optionId, label, labelNe: f.opt(fd, "labelNe", 40), qtyMultiplier, priceDelta, sortOrder: f.int(fd, "sortOrder", option.portions.length, 0, 100) },
    });
    await audit({ actorId: user.id, action: "builder.portion_create", entity: "CustomizationPortion", entityId: p.id, after: { optionId, dish: option.menuItem.name, label, qtyMultiplier, priceDelta } });
    return done("Portion added");
  }, ["/admin/builder", "/build"]);
}

export async function removePortion(id: string): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const p = await db.customizationPortion.delete({ where: { id } });
    await audit({ actorId: user.id, action: "builder.portion_delete", entity: "CustomizationPortion", entityId: id, before: p });
    return done("Portion removed");
  }, ["/admin/builder", "/build"]);
}

// ───────────── kitchen availability ─────────────

/** Switch a builder option on/off for one kitchen. A missing row means available. */
export async function setOptionAvailability(optionId: string, kitchenId: string, isAvailable: boolean, note?: string | null): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const [option, kitchen] = await Promise.all([db.customizationOption.findUnique({ where: { id: optionId }, include: { menuItem: true } }), db.kitchen.findUnique({ where: { id: kitchenId } })]);
    if (!option || !kitchen) return fail("That option or kitchen no longer exists");
    // NULLs are distinct in the unique key, so replace instead of upsert.
    await db.$transaction(async (tx) => {
      await tx.kitchenAvailability.deleteMany({ where: { kitchenId, optionId, boxId: null, menuItemId: null } });
      if (!isAvailable) await tx.kitchenAvailability.create({ data: { kitchenId, optionId, isAvailable: false, note: note?.slice(0, 160) || null } });
    });
    await audit({ actorId: user.id, action: "builder.availability", entity: "CustomizationOption", entityId: optionId, after: { kitchenId, kitchen: kitchen.name, dish: option.menuItem.name, isAvailable } });
    return done(isAvailable ? `${option.menuItem.name} is back on at ${kitchen.name}` : `${option.menuItem.name} switched off at ${kitchen.name}`);
  }, ["/admin/builder", "/build"]);
}

export async function availabilityForm(optionId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const kitchenId = f.str(fd, "kitchenId");
  if (!kitchenId) return fail("Pick a kitchen");
  return setOptionAvailability(optionId, kitchenId, f.str(fd, "state") === "on", f.opt(fd, "note", 160));
}
