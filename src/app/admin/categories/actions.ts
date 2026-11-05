"use server";

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { slugify } from "@/lib/utils";
import { revalidatePublicMenu } from "@/server/menu";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

const PATHS = ["/admin/categories", "/admin/boxes"];

export async function saveCategory(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const name = f.str(fd, "name", 60);
    if (!name) throw new FieldError("name", "Name is required");
    const slug = slugify(f.str(fd, "slug", 60) || name);
    if (!slug) throw new FieldError("slug", "Enter a URL name");
    const last = id ? null : await db.mealCategory.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const data = {
      name,
      nameNe: f.opt(fd, "nameNe", 60),
      slug,
      sortOrder: f.str(fd, "sortOrder") ? f.int(fd, "sortOrder", 0, 0, 100000) : (last?.sortOrder ?? 0) + 10,
      isActive: f.bool(fd, "isActive"),
    };
    const before = id ? await db.mealCategory.findUnique({ where: { id } }) : null;
    if (id && !before) return fail("Category not found");
    const c = id ? await db.mealCategory.update({ where: { id }, data }) : await db.mealCategory.create({ data });
    await audit({ actorId: user.id, action: id ? "category.update" : "category.create", entity: "MealCategory", entityId: c.id, summary: c.name, before, after: data });
    revalidatePublicMenu();
    return done(id ? "Category saved" : "Category added");
  }, PATHS);
}

/** Swap a category with its neighbour (dir −1 = up, +1 = down) and renumber so ordering stays stable. */
export async function moveCategory(id: string, dir: -1 | 1): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const all = await db.mealCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const i = all.findIndex((c) => c.id === id);
    if (i < 0) return fail("Category not found");
    const j = i + dir;
    if (j < 0 || j >= all.length) return done();
    [all[i], all[j]] = [all[j], all[i]];
    await db.$transaction(all.map((c, k) => db.mealCategory.update({ where: { id: c.id }, data: { sortOrder: (k + 1) * 10 } })));
    await audit({ actorId: user.id, action: "category.reorder", entity: "MealCategory", entityId: id, after: all.map((c) => c.slug) });
    revalidatePublicMenu();
    return done();
  }, PATHS);
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  return guarded("menu.edit", async (user) => {
    const used = await db.lunchBox.count({ where: { categoryId: id } });
    if (used) return fail(`${used} dabba(s) use this category. Move them or hide the category instead.`);
    const c = await db.mealCategory.delete({ where: { id } });
    await audit({ actorId: user.id, action: "category.delete", entity: "MealCategory", entityId: id, summary: c.name, before: c });
    revalidatePublicMenu();
    return done("Deleted");
  }, PATHS);
}
