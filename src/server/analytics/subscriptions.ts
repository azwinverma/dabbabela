import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { addDays, isoDate, weekdayOf } from "@/lib/dates";
import { getClosures } from "@/server/calendar";
import { NONE, dayRange, isFiltered, orderWhere, stampRange, subscriptionDims, type AnalyticsFilters } from "./filters";
import { UPCOMING_STATUSES } from "./metrics";

/** Meal-plan statistics (definitions in metrics.ts). */

export async function planStatusCounts(f: AnalyticsFilters) {
  const rows = await db.subscription.groupBy({ by: ["status"], where: subscriptionDims(f), _count: { _all: true } });
  const m = new Map(rows.map((r) => [r.status, r._count._all]));
  return { active: m.get("ACTIVE") ?? 0, paused: m.get("PAUSED") ?? 0, completed: m.get("COMPLETED") ?? 0, cancelled: m.get("CANCELLED") ?? 0, pending: m.get("PENDING_PAYMENT") ?? 0 };
}

export const runRatePlansWhere = (f: AnalyticsFilters, today: string): Prisma.SubscriptionWhereInput => ({
  ...subscriptionDims(f),
  status: { in: ["ACTIVE", "PAUSED"] },
  startDate: { lte: new Date(`${today}T00:00:00.000Z`) },
  endDate: { gte: new Date(`${today}T00:00:00.000Z`) },
});

/** Plan run-rate (MRR-equivalent) + corporate contract run-rate, in paisa per 30 days. */
export async function runRate(f: AnalyticsFilters, today: string) {
  const subs = await db.subscription.findMany({ where: runRatePlansWhere(f, today), select: { total: true, tax: true, startDate: true, endDate: true } });
  let plansExact = 0;
  for (const s of subs) {
    const planDays = Math.round((s.endDate.getTime() - s.startDate.getTime()) / 86_400_000) + 1;
    plansExact += ((s.total - s.tax) / planDays) * 30;
  }
  const plans = Math.round(plansExact);

  // Contracts have no kitchen/zone/order dimension: only included when filters are company-level at most.
  const contractsApply = !isFiltered({ ...f, companyId: undefined, customerType: undefined }) && f.customerType !== "INDIVIDUAL" && f.companyId !== NONE;
  let contracts: number | null = null;
  let contractCount = 0;
  if (contractsApply) {
    const t = new Date(`${today}T00:00:00.000Z`);
    const rows = await db.corporateContract.findMany({
      where: { status: "ACTIVE", startsOn: { lte: t }, OR: [{ endsOn: null }, { endsOn: { gte: t } }], pricePerMeal: { not: null }, minMealsPerDay: { not: null }, ...(f.companyId ? { companyId: f.companyId } : {}) },
      select: { pricePerMeal: true, minMealsPerDay: true },
    });
    const days = await serviceDaysAhead(today, 30);
    contracts = rows.reduce((a, c) => a + (c.pricePerMeal ?? 0) * (c.minMealsPerDay ?? 0) * days, 0);
    contractCount = rows.length;
  }
  return { plans, planCount: subs.length, contracts, contractCount, total: plans + (contracts ?? 0) };
}

/** Delivery weekdays (setting) in [today, today+n) minus global closures. */
export async function serviceDaysAhead(today: string, n: number) {
  const s = await getSettings();
  const closures = await getClosures(today, addDays(today, n - 1));
  let c = 0;
  for (let i = 0; i < n; i++) {
    const d = addDays(today, i);
    if (s.deliveryDays.includes(weekdayOf(d)) && !closures.has(d)) c++;
  }
  return c;
}

export const renewalsDueWhere = (f: AnalyticsFilters, today: string, days = 7): Prisma.SubscriptionWhereInput => ({ ...subscriptionDims(f), status: "ACTIVE", endDate: dayRange(today, addDays(today, days - 1)) });

export const renewalsDue = (f: AnalyticsFilters, today: string, days = 7) => db.subscription.count({ where: renewalsDueWhere(f, today, days) });

export async function cancelReasons(f: AnalyticsFilters) {
  const rows = await db.subscription.groupBy({ by: ["cancelReason"], where: { ...subscriptionDims(f), status: "CANCELLED", updatedAt: stampRange(f.from, f.to) }, _count: { _all: true } });
  return rows.map((r) => ({ reason: r.cancelReason?.trim() || "No reason given", count: r._count._all })).sort((a, b) => b.count - a.count);
}

/** Plan meals expected per day for the next `days` days (Scheduled → Out for delivery). */
export async function expectedMeals(f: AnalyticsFilters, today: string, days = 7) {
  const end = addDays(today, days - 1);
  const rows = await db.order.groupBy({
    by: ["deliveryDate"],
    where: orderWhere({ ...f, orderStatus: undefined }, { subscriptionId: { not: null }, status: { in: UPCOMING_STATUSES }, deliveryDate: dayRange(today, end) }),
    _count: { _all: true },
  });
  const m = new Map(rows.map((r) => [isoDate(r.deliveryDate), r._count._all]));
  const perDay = Array.from({ length: days }, (_, i) => addDays(today, i)).map((d) => ({ date: d, meals: m.get(d) ?? 0 }));
  return { perDay, week: perDay.reduce((a, d) => a + d.meals, 0) };
}

/** Plans cancelled in range ÷ plans active at range start. */
export async function churn(f: AnalyticsFilters) {
  const start = stampRange(f.from, f.to).gte;
  const startDay = new Date(`${f.from}T00:00:00.000Z`);
  const dims = subscriptionDims(f);
  const [activeAtStart, cancelled] = await Promise.all([
    db.subscription.count({
      where: { ...dims, createdAt: { lt: start }, endDate: { gte: startDay }, OR: [{ status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] } }, { status: "CANCELLED", updatedAt: { gte: start } }] },
    }),
    db.subscription.count({ where: { ...dims, status: "CANCELLED", updatedAt: stampRange(f.from, f.to) } }),
  ]);
  return { activeAtStart, cancelled, rate: activeAtStart ? cancelled / activeAtStart : null };
}
