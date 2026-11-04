import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, activeCompany } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { addDays, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { orderableDates } from "@/server/calendar";
import { boxFacts, getOffersForDates } from "@/server/menu";
import { availableMethods } from "@/server/payments/methods";
import { walletBalance } from "@/server/ledger";
import { defaultKitchenId } from "@/server/orders";
import { toAddressViews } from "../../account/_lib/view";
import { SubscribeClient, type DayOptions } from "./SubscribeClient";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const plan = await db.mealPlan.findUnique({ where: { slug: (await params).slug } });
  return plan ? { title: plan.name, description: plan.tagline ?? plan.description ?? undefined } : {};
}

export default async function PlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const plan = await db.mealPlan.findFirst({ where: { slug, isActive: true } });
  if (!plan) notFound();
  const [user, settings, locale] = await Promise.all([getCurrentUser(), getSettings(), getLocale()]);
  const t = accountDict(locale).plan;
  const addresses = user ? toAddressViews(user) : [];
  const kitchenId = addresses.find((a) => a.isDefault && a.kitchenId)?.kitchenId ?? addresses.find((a) => a.kitchenId)?.kitchenId ?? (await defaultKitchenId());
  const starts = await orderableDates(settings, 21, kitchenId);
  // Offers for every date a plan starting in the window could cover.
  const today = todayKTM();
  const horizon = Array.from({ length: settings.advanceDays + plan.durationWeeks * 7 + 7 }, (_, i) => addDays(today, i));
  const offers = await getOffersForDates(horizon, kitchenId);
  const dayOptions: DayOptions = {};
  for (const [date, o] of offers) {
    if (o.closed) continue;
    dayOptions[date] = o.items.map((i) => {
      const f = boxFacts(i.box);
      return { boxId: i.box.id, name: i.box.name, price: i.price, diet: f.diet, isVeg: f.isVeg, isPrimary: i.isPrimary, soldOut: i.soldOut };
    });
  }
  const [slots, customBoxes, balance] = await Promise.all([
    db.deliverySlot.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true, kitchenId: true } }),
    user ? db.customBox.findMany({ where: { userId: user.id }, select: { id: true, name: true } }) : Promise.resolve([]),
    user ? walletBalance(user.id) : Promise.resolve(0),
  ]);
  const company = activeCompany(user);
  const methods = await availableMethods(settings, { hasCompany: Boolean(company), customerShare: 1, forPlan: true });

  return (
    <section className="container py-8 md:py-12">
      <Link href="/plans" className="text-sm font-semibold text-ink-soft underline">← All plans</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold md:text-4xl">{locale === "ne" && plan.nameNe ? plan.nameNe : plan.name}</h1>
          {plan.tagline && <p className="mt-1 max-w-2xl text-ink-soft">{plan.tagline}</p>}
        </div>
        <div className="text-right">
          <p className="text-3xl font-extrabold tabular-nums">{rs(plan.pricePerMeal)}</p>
          <p className="text-sm text-ink-mute">
            {t.perMeal}
            {plan.compareAtPrice && plan.compareAtPrice > plan.pricePerMeal ? ` · single orders ${rs(plan.compareAtPrice)}` : ""}
          </p>
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-2">
        {plan.features.map((f) => (
          <li key={f} className="rounded-full border-2 border-ink bg-paper-card px-3 py-1 text-xs font-semibold">{f}</li>
        ))}
      </ul>
      {plan.policyNote && <p className="mt-3 max-w-3xl text-sm text-ink-soft">{plan.policyNote}</p>}
      <SubscribeClient
        t={t}
        plan={{ id: plan.id, slug: plan.slug, name: plan.name, durationWeeks: plan.durationWeeks, minDaysPerWeek: plan.minDaysPerWeek, includesDelivery: plan.includesDelivery }}
        starts={starts}
        deliveryDays={settings.deliveryDays}
        dayOptions={dayOptions}
        customBoxes={customBoxes}
        addresses={addresses}
        slots={slots}
        methods={methods}
        walletBalance={balance}
        loggedIn={Boolean(user)}
        user={user ? { name: user.name, phone: user.phoneNumber ?? "", vegDefault: user.diet === "VEG" || user.diet === "VEGAN" } : null}
        cutoff={settings.orderCutoff}
      />
    </section>
  );
}
