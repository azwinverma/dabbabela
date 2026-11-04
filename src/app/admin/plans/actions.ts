"use server";

import type { PlanKind } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dateOnly } from "@/lib/dates";
import { done, fail, type ActionResult } from "@/lib/action";
import { slugify } from "@/lib/utils";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

const KINDS: PlanKind[] = ["WEEKLY", "MONTHLY", "OFFICE", "CUSTOM"];

export async function savePlan(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("plans.edit", async (user) => {
    const name = f.str(fd, "name", 120);
    if (!name) throw new FieldError("name", "Name is required");
    const kind = f.str(fd, "kind") as PlanKind;
    if (!KINDS.includes(kind)) throw new FieldError("kind", "Pick a kind");
    const pricePerMeal = f.money(fd, "pricePerMeal", "Price per meal");
    if (pricePerMeal <= 0) throw new FieldError("pricePerMeal", "Price must be above zero");
    const compareAtPrice = f.moneyOpt(fd, "compareAtPrice", "Compare-at price");
    if (compareAtPrice != null && compareAtPrice < pricePerMeal) throw new FieldError("compareAtPrice", "Compare-at should be the regular (higher) price");
    const effectiveFrom = f.date(fd, "effectiveFrom");
    const effectiveTo = f.date(fd, "effectiveTo");
    if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) throw new FieldError("effectiveTo", "End is before start");
    const data = {
      name,
      nameNe: f.opt(fd, "nameNe", 120),
      slug: slugify(f.str(fd, "slug") || name),
      kind,
      tagline: f.opt(fd, "tagline", 200),
      description: f.opt(fd, "description", 2000),
      durationWeeks: f.int(fd, "durationWeeks", 1, 1, 26),
      minDaysPerWeek: f.int(fd, "minDaysPerWeek", 3, 1, 7),
      pricePerMeal,
      compareAtPrice,
      includesDelivery: f.bool(fd, "includesDelivery"),
      maxPauseDays: f.int(fd, "maxPauseDays", 10, 0, 90),
      policyNote: f.opt(fd, "policyNote", 600),
      features: f.list(fd, "features").slice(0, 8),
      isPopular: f.bool(fd, "isPopular"),
      isCorporate: f.bool(fd, "isCorporate"),
      isActive: f.bool(fd, "isActive"),
      effectiveFrom: effectiveFrom ? dateOnly(effectiveFrom) : null,
      effectiveTo: effectiveTo ? dateOnly(effectiveTo) : null,
      sortOrder: f.int(fd, "sortOrder", 0),
    };
    const before = id ? await db.mealPlan.findUnique({ where: { id } }) : null;
    const p = id ? await db.mealPlan.update({ where: { id }, data }) : await db.mealPlan.create({ data });
    await audit({ actorId: user.id, action: id ? "plan.update" : "plan.create", entity: "MealPlan", entityId: p.id, summary: p.name, before, after: data });
    return done(id ? "Plan saved — existing subscriptions keep the price they paid" : "Plan created", id ? undefined : `/admin/plans/${p.id}`);
  }, ["/admin/plans", "/plans"]);
}

export async function togglePlan(id: string): Promise<ActionResult> {
  return guarded("plans.edit", async (user) => {
    const p = await db.mealPlan.findUnique({ where: { id } });
    if (!p) return fail("Not found");
    await db.mealPlan.update({ where: { id }, data: { isActive: !p.isActive } });
    await audit({ actorId: user.id, action: p.isActive ? "plan.hide" : "plan.show", entity: "MealPlan", entityId: id, summary: p.name });
    return done();
  }, ["/admin/plans", "/plans"]);
}
