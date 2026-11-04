"use server";

import type { ItemCategory } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { getSettings, saveSettings } from "@/lib/settings";
import { CATEGORY_LABEL } from "@/lib/labels";
import { slugify } from "@/lib/utils";
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
    const data = { name, nameNe: f.opt(fd, "nameNe", 80), category, minSelect, maxSelect, sortOrder: f.int(fd, "sortOrder", 0), isActive: f.bool(fd, "isActive") };
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
    const priceOverride = f.moneyOpt(fd, "priceOverride", "Price override");
    const o = await db.customizationOption.upsert({
      where: { groupId_menuItemId: { groupId, menuItemId } },
      create: { groupId, menuItemId, priceOverride, isDefault: f.bool(fd, "isDefault"), sortOrder: f.int(fd, "sortOrder", 0) },
      update: { priceOverride, isDefault: f.bool(fd, "isDefault") },
    });
    await audit({ actorId: user.id, action: "builder.option", entity: "CustomizationGroup", entityId: groupId, after: o });
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
