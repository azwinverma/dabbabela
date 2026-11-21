import { apiRoute } from "@/server/api/route";
import { notFound } from "@/server/api/http";
import { planDto } from "@/server/api/plans-dto";
import { db } from "@/lib/db";
import { activeCompany } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { isLocale } from "@/lib/i18n";
import { addDays, todayKTM } from "@/lib/dates";
import { orderableDates } from "@/server/calendar";
import { boxFacts, getOffersForDates } from "@/server/menu";
import { availableMethods } from "@/server/payments/methods";
import { defaultKitchenId } from "@/server/orders";
import { planPriceOn, weeksRange } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

/**
 * One plan (by slug or id) with what the subscribe screen needs, like /plans/[slug]: start dates, the dabbas offered on
 * each date the plan could cover, delivery slots and payment methods. Price with POST /subscriptions/quote.
 */
export const GET = apiRoute<"optional", { slug: string }>({ auth: "optional", limit: "read" }, async ({ req, user, params }) => {
  const row = await db.mealPlan.findFirst({ where: { OR: [{ slug: params.slug }, { id: params.slug }], isActive: true } });
  if (!row) throw notFound("Plan not found");
  const ql = new URL(req.url).searchParams.get("locale");
  const locale = isLocale(ql) ? ql : user && isLocale(user.locale) ? user.locale : "en";
  const price = await planPriceOn(row);
  const plan = { ...row, pricePerMeal: price.pricePerMeal, compareAtPrice: price.compareAtPrice };
  const range = weeksRange(plan);
  const settings = await getSettings();
  const addr = user?.addresses.find((a) => a.isDefault && a.zone?.kitchenId) ?? user?.addresses.find((a) => a.zone?.kitchenId);
  const kitchenId = addr?.zone?.kitchenId ?? (await defaultKitchenId());
  const starts = await orderableDates(settings, 21, kitchenId);
  const today = todayKTM();
  const horizon = Array.from({ length: settings.advanceDays + range.max * 7 + 7 }, (_, i) => addDays(today, i));
  const offers = await getOffersForDates(horizon, kitchenId);
  const days: Record<string, { boxId: string; name: string; price: number; diet: string; isVeg: boolean; isPrimary: boolean; soldOut: boolean }[]> = {};
  for (const [date, o] of offers) {
    if (o.closed) continue;
    days[date] = o.items.map((i) => {
      const f = boxFacts(i.box);
      return { boxId: i.box.id, name: i.box.name, price: i.price, diet: f.diet, isVeg: f.isVeg, isPrimary: i.isPrimary, soldOut: i.soldOut };
    });
  }
  const [slots, methods] = await Promise.all([
    db.deliverySlot.findMany({ where: { isActive: true, ...(kitchenId ? { kitchenId } : {}) }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true, startTime: true, endTime: true } }),
    availableMethods(settings, { hasCompany: Boolean(activeCompany(user)), customerShare: 1, forPlan: true }),
  ]);
  return { plan: planDto(plan, settings, locale), startDates: starts, dayOptions: days, slots, paymentMethods: methods, kitchenId };
});
