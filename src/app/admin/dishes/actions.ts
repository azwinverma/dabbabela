"use server";

import type { Diet, ItemCategory, NutritionSource } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";
import { recipeCost, refreshBoxCosts } from "../_kit/costing";
import { CATEGORY_LABEL, DIET_LABEL } from "@/lib/labels";

const CATS = Object.keys(CATEGORY_LABEL) as ItemCategory[];
const DIETS = Object.keys(DIET_LABEL) as Diet[];
const SOURCES: NutritionSource[] = ["NONE", "ESTIMATED", "VERIFIED"];

export async function saveDish(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const name = f.str(fd, "name", 120);
    const category = f.str(fd, "category") as ItemCategory;
    const diet = f.str(fd, "diet") as Diet;
    if (!name) throw new FieldError("name", "Name is required");
    if (!CATS.includes(category)) throw new FieldError("category", "Pick a category");
    if (!DIETS.includes(diet)) throw new FieldError("diet", "Pick a diet");
    const nutritionSource = (SOURCES.includes(f.str(fd, "nutritionSource") as NutritionSource) ? f.str(fd, "nutritionSource") : "NONE") as NutritionSource;
    const nutritionNote = f.opt(fd, "nutritionNote", 400);
    if (nutritionSource !== "NONE" && !nutritionNote) throw new FieldError("nutritionNote", "Say how the nutrition was worked out (e.g. 'estimated from recipe weights')");
    const calories = f.intOpt(fd, "calories");
    if (nutritionSource !== "NONE" && calories == null) throw new FieldError("calories", "Enter calories or set the source to 'not shown'");
    const data = {
      name,
      nameNe: f.opt(fd, "nameNe", 120),
      description: f.opt(fd, "description", 600),
      descriptionNe: f.opt(fd, "descriptionNe", 600),
      category,
      diet,
      dietVerified: f.bool(fd, "dietVerified"),
      hasOnionGarlic: f.bool(fd, "hasOnionGarlic"),
      spiceLevel: f.int(fd, "spiceLevel", 1, 0, 4),
      portionLabel: f.opt(fd, "portionLabel", 80),
      prepMinutes: f.intOpt(fd, "prepMinutes"),
      station: f.opt(fd, "station", 60),
      calories: nutritionSource === "NONE" ? null : calories,
      proteinG: nutritionSource === "NONE" ? null : f.intOpt(fd, "proteinG"),
      carbsG: nutritionSource === "NONE" ? null : f.intOpt(fd, "carbsG"),
      fatG: nutritionSource === "NONE" ? null : f.intOpt(fd, "fatG"),
      nutritionSource,
      nutritionNote: nutritionSource === "NONE" ? null : nutritionNote,
      price: f.money(fd, "price", "Build-a-Dabba price"),
      costPrice: f.money(fd, "costPrice", "Manual cost"),
      dailyLimit: f.intOpt(fd, "dailyLimit"),
      image: f.opt(fd, "image", 500),
      allowCustom: f.bool(fd, "allowCustom"),
      isActive: f.bool(fd, "isActive"),
      sortOrder: f.int(fd, "sortOrder", 0),
    };
    const allergenIds = f.all(fd, "allergen");
    const mayIds = new Set(f.all(fd, "mayContain"));
    const before = id ? await db.menuItem.findUnique({ where: { id }, include: { allergens: true } }) : null;
    if (id && !before) return fail("Dish not found");
    const row = await db.$transaction(async (tx) => {
      const r = id ? await tx.menuItem.update({ where: { id }, data }) : await tx.menuItem.create({ data });
      await tx.menuItemAllergen.deleteMany({ where: { menuItemId: r.id } });
      const rows = [...new Set([...allergenIds, ...mayIds])].map((aid) => ({ menuItemId: r.id, allergenId: aid, mayContain: !allergenIds.includes(aid) && mayIds.has(aid) }));
      if (rows.length) await tx.menuItemAllergen.createMany({ data: rows });
      return r;
    });
    await refreshBoxCosts({ menuItemId: row.id });
    await audit({ actorId: user.id, action: id ? "dish.update" : "dish.create", entity: "MenuItem", entityId: row.id, summary: row.name, before, after: { ...data, allergenIds, mayContain: [...mayIds] } });
    return done(id ? "Dish saved" : "Dish created", id ? undefined : `/admin/dishes/${row.id}`);
  }, ["/admin/dishes", "/menu"]);
}

export type RecipeLineInput = { ingredientId: string; quantity: number; wastePct: number };

/** Save a recipe as a NEW immutable version and make it current. */
export async function saveRecipe(menuItemId: string, input: { yieldPortions: number; method: string; notes: string; lines: RecipeLineInput[] }): Promise<ActionResult> {
  return guarded("recipes.edit", async (user) => {
    const lines = (input.lines ?? []).filter((l) => l.ingredientId && Number(l.quantity) > 0);
    if (!lines.length) return fail("Add at least one ingredient with a quantity");
    if (new Set(lines.map((l) => l.ingredientId)).size !== lines.length) return fail("Each ingredient can appear once — combine the quantities");
    const yieldPortions = Math.max(1, Math.min(2000, Math.floor(Number(input.yieldPortions) || 1)));
    const ings = await db.ingredient.findMany({ where: { id: { in: lines.map((l) => l.ingredientId) } } });
    if (ings.length !== lines.length) return fail("One of the ingredients no longer exists");
    const clean = lines.map((l) => ({ ingredientId: l.ingredientId, quantity: Math.round(Number(l.quantity) * 1000) / 1000, wastePct: Math.max(0, Math.min(90, Math.round(Number(l.wastePct) || 0))) }));
    const cost = recipeCost(clean.map((l) => ({ ...l, costPerUnit: ings.find((i) => i.id === l.ingredientId)!.costPerUnit })), yieldPortions);
    const v = await db.$transaction(async (tx) => {
      const recipe = (await tx.recipe.findUnique({ where: { menuItemId } })) ?? (await tx.recipe.create({ data: { menuItemId } }));
      const last = await tx.recipeVersion.findFirst({ where: { recipeId: recipe.id }, orderBy: { version: "desc" } });
      const ver = await tx.recipeVersion.create({
        data: {
          recipeId: recipe.id,
          version: (last?.version ?? 0) + 1,
          yieldPortions,
          method: input.method?.slice(0, 4000) || null,
          notes: input.notes?.slice(0, 1000) || null,
          costPerPortion: cost,
          createdById: user.id,
          ingredients: { create: clean },
        },
      });
      await tx.recipe.update({ where: { id: recipe.id }, data: { currentVersionId: ver.id } });
      await tx.menuItem.update({ where: { id: menuItemId }, data: { costPrice: cost } });
      return ver;
    });
    await refreshBoxCosts({ menuItemId });
    await audit({ actorId: user.id, action: "recipe.version", entity: "MenuItem", entityId: menuItemId, summary: `Recipe v${v.version} · cost/portion ${cost}`, after: { yieldPortions, lines: clean } });
    return done(`Saved as version ${v.version}`);
  }, [`/admin/dishes/${menuItemId}`]);
}

/** Make an older version current again (creates no new rows; history stays intact). */
export async function restoreRecipeVersion(menuItemId: string, versionId: string): Promise<ActionResult> {
  return guarded("recipes.edit", async (user) => {
    const v = await db.recipeVersion.findUnique({ where: { id: versionId }, include: { recipe: true } });
    if (!v || v.recipe.menuItemId !== menuItemId) return fail("Version not found");
    await db.recipe.update({ where: { id: v.recipeId }, data: { currentVersionId: v.id } });
    await db.menuItem.update({ where: { id: menuItemId }, data: { costPrice: v.costPerPortion } });
    await refreshBoxCosts({ menuItemId });
    await audit({ actorId: user.id, action: "recipe.restore", entity: "MenuItem", entityId: menuItemId, summary: `Restored recipe v${v.version}` });
    return done(`Version ${v.version} is current again`);
  }, [`/admin/dishes/${menuItemId}`]);
}

export async function toggleDish(id: string): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const d = await db.menuItem.findUnique({ where: { id } });
    if (!d) return fail("Not found");
    await db.menuItem.update({ where: { id }, data: { isActive: !d.isActive } });
    await audit({ actorId: user.id, action: d.isActive ? "dish.archive" : "dish.activate", entity: "MenuItem", entityId: id, summary: d.name });
    return done(d.isActive ? "Archived" : "Active again");
  }, ["/admin/dishes"]);
}

export async function deleteDish(id: string): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const [boxes, batches] = await Promise.all([db.boxItem.count({ where: { menuItemId: id } }), db.productionBatch.count({ where: { menuItemId: id } })]);
    if (boxes || batches) return fail(`Used in ${boxes} dabba(s) / ${batches} production batch(es). Archive it instead.`);
    const d = await db.menuItem.delete({ where: { id } });
    await audit({ actorId: user.id, action: "dish.delete", entity: "MenuItem", entityId: id, summary: d.name, before: d });
    return done("Deleted", "/admin/dishes");
  }, ["/admin/dishes"]);
}
