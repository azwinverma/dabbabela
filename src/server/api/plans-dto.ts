import "server-only";
import type { MealPlan } from "@prisma/client";
import { pick, type Locale } from "@/lib/i18n";
import { cancelPolicyFor, POLICY_TEXT, skipPolicyFor, weeksRange } from "@/server/subscriptions";
import type { SiteSettings } from "@/lib/settings";

/** Public meal-plan card/detail (prices are today's price version, paisa per meal). */
export function planDto(p: MealPlan, s: SiteSettings, locale: Locale) {
  const range = weeksRange(p);
  const skip = skipPolicyFor(p, s);
  const cancel = cancelPolicyFor(p);
  return {
    id: p.id,
    slug: p.slug,
    name: pick(p, "name", locale),
    kind: p.kind,
    tagline: p.tagline,
    description: p.description,
    pricePerMeal: p.pricePerMeal,
    compareAtPrice: p.compareAtPrice,
    savingPerMeal: p.compareAtPrice && p.compareAtPrice > p.pricePerMeal ? p.compareAtPrice - p.pricePerMeal : 0,
    includesDelivery: p.includesDelivery,
    weeks: { default: range.default, min: range.min, max: range.max },
    minDaysPerWeek: p.minDaysPerWeek,
    maxDaysPerWeek: s.deliveryDays.length,
    maxPauseDays: p.maxPauseDays,
    features: p.features,
    isPopular: p.isPopular,
    isCorporate: p.isCorporate,
    policyNote: p.policyNote,
    skipPolicy: skip,
    cancelPolicy: cancel,
    policyText: { skip: POLICY_TEXT.skip[skip], cancel: POLICY_TEXT.cancel[cancel] },
  };
}
