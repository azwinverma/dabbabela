import { apiRoute } from "@/server/api/route";
import { planDto } from "@/server/api/plans-dto";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { isLocale } from "@/lib/i18n";
import { dateOnly, todayKTM } from "@/lib/dates";
import { syncPlanPriceMirrors } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

/** Active meal plans (same list and order as /plans), today's prices. */
export const GET = apiRoute({ auth: "public", limit: "read" }, async ({ req }) => {
  const ql = new URL(req.url).searchParams.get("locale");
  const locale = isLocale(ql) ? ql : "en";
  const today = dateOnly(todayKTM());
  await syncPlanPriceMirrors();
  const [plans, s] = await Promise.all([
    db.mealPlan.findMany({
      where: { isActive: true, AND: [{ OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] }, { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }] },
      orderBy: { sortOrder: "asc" },
    }),
    getSettings(),
  ]);
  return plans.map((p) => planDto(p, s, locale));
});
