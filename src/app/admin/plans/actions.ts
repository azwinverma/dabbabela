"use server";

import type { PlanKind } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dateOnly, todayKTM } from "@/lib/dates";
import { done, fail, type ActionResult } from "@/lib/action";
import { slugify } from "@/lib/utils";
import { CANCEL_POLICIES, changePlanPrice, type CancelPolicy } from "@/server/subscriptions";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

const KINDS: PlanKind[] = ["WEEKLY", "MONTHLY", "OFFICE", "CUSTOM"];

/**
 * Save a plan. Price fields go through versioned pricing: a changed price becomes a new MealPlanPrice row effective
 * today (existing subscriptions keep theirs). Policies apply to new sales and — for skip/cancel — to later actions on
 * live plans (the form says how many).
 */
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
    const durationWeeks = f.int(fd, "durationWeeks", 1, 1, 26);
    const minWeeks = f.intOpt(fd, "minWeeks");
    const maxWeeks = f.intOpt(fd, "maxWeeks");
    if (minWeeks != null && (minWeeks < 1 || minWeeks > 26)) throw new FieldError("minWeeks", "1–26 weeks");
    if (maxWeeks != null && (maxWeeks < 1 || maxWeeks > 26)) throw new FieldError("maxWeeks", "1–26 weeks");
    if (minWeeks != null && minWeeks > durationWeeks) throw new FieldError("minWeeks", "Shortest can't be longer than the default length");
    if (maxWeeks != null && maxWeeks < durationWeeks) throw new FieldError("maxWeeks", "Longest can't be shorter than the default length");
    const skipPolicy = f.str(fd, "skipPolicy");
    if (skipPolicy && !["EXTEND", "CREDIT"].includes(skipPolicy)) throw new FieldError("skipPolicy", "Pick a skip policy");
    const cancelPolicy = f.str(fd, "cancelPolicy");
    if (cancelPolicy && !CANCEL_POLICIES.includes(cancelPolicy as CancelPolicy)) throw new FieldError("cancelPolicy", "Pick a cancel policy");
    const data = {
      name,
      nameNe: f.opt(fd, "nameNe", 120),
      slug: slugify(f.str(fd, "slug") || name),
      kind,
      tagline: f.opt(fd, "tagline", 200),
      description: f.opt(fd, "description", 2000),
      durationWeeks,
      minDaysPerWeek: f.int(fd, "minDaysPerWeek", 3, 1, 7),
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
      minWeeks,
      maxWeeks,
      skipPolicy: skipPolicy || null,
      cancelPolicy: cancelPolicy || null,
      renewalReminderDays: f.int(fd, "renewalReminderDays", 3, 0, 14),
    };
    const before = id ? await db.mealPlan.findUnique({ where: { id } }) : null;
    if (id && !before) return fail("Not found");
    if (!id) {
      const p = await db.mealPlan.create({ data: { ...data, pricePerMeal, compareAtPrice } });
      await db.mealPlanPrice.create({ data: { planId: p.id, pricePerMeal, compareAtPrice, effectiveFrom: dateOnly(todayKTM()), createdById: user.id } });
      await audit({ actorId: user.id, action: "plan.create", entity: "MealPlan", entityId: p.id, summary: p.name, after: { ...data, pricePerMeal, compareAtPrice } });
      return done("Plan created", `/admin/plans/${p.id}`);
    }
    const p = await db.mealPlan.update({ where: { id }, data });
    const priceChanged = before!.pricePerMeal !== pricePerMeal || before!.compareAtPrice !== compareAtPrice;
    if (priceChanged) await changePlanPrice(id, { pricePerMeal, compareAtPrice, effectiveFrom: todayKTM(), reason: "Edited on the plan form" }, user.id);
    await audit({ actorId: user.id, action: "plan.update", entity: "MealPlan", entityId: p.id, summary: p.name, before, after: data });
    return done(priceChanged ? "Plan saved — new price applies to new sales from today; existing subscriptions keep the price they paid" : "Plan saved");
  }, ["/admin/plans", "/plans"]);
}

/** Schedule a price version from a date (today or later). */
export async function schedulePrice(planId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("plans.edit", async (user) => {
    const pricePerMeal = f.money(fd, "newPrice", "Price per meal");
    if (pricePerMeal <= 0) throw new FieldError("newPrice", "Price must be above zero");
    const compareAtPrice = f.moneyOpt(fd, "newCompareAt", "Regular price");
    const from = f.date(fd, "from") || todayKTM();
    if (from < todayKTM()) throw new FieldError("from", "Pick today or a later date");
    const r = await changePlanPrice(planId, { pricePerMeal, compareAtPrice, effectiveFrom: from, reason: f.opt(fd, "reason", 300) }, user.id);
    return done(r.unchanged ? "That price is already set" : `New price from ${from} — existing subscriptions keep theirs`);
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
