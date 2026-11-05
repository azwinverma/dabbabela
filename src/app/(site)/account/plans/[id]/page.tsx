import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { activeCompany, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDay, formatStamp, isoDate, ktmNow } from "@/lib/dates";
import { rs } from "@/lib/money";
import { SUB_STATUS } from "@/lib/labels";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { Badge } from "@/components/ui/Badge";
import { orderableDates } from "@/server/calendar";
import { boxFacts, getOffersForDates } from "@/server/menu";
import { availableMethods } from "@/server/payments/methods";
import { cancelPolicyFor, earliestCutoff, extraMeals, planMealPrice, POLICY_TEXT, quoteRenewal, skipPolicyFor, swapOptions, weeksRange } from "@/server/subscriptions";
import { OrderRow } from "../../OrderRow";
import { MealActions } from "../../MealActions";
import { changeable } from "../../_lib/meals";
import { PlanActions } from "../PlanActions";
import { AddMeal, RenewPlan, SwapMeal, type AddMealDay, type SwapChoice } from "../PlanTools";

export default async function PlanDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/account/plans/${id}`);
  const sub = await db.subscription.findFirst({
    where: { id, userId: user.id },
    include: {
      plan: true,
      price: true,
      address: { include: { zone: true } },
      renewedFrom: { select: { id: true, reference: true } },
      renewals: { select: { id: true, reference: true, status: true }, orderBy: { createdAt: "desc" } },
      orders: { include: { items: { select: { name: true, quantity: true, boxId: true } } }, orderBy: { deliveryDate: "asc" } },
      changes: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!sub) notFound();
  const [settings, locale, extras] = await Promise.all([getSettings(), getLocale(), extraMeals(sub.id)]);
  const t = accountDict(locale).account;
  const now = ktmNow();
  const company = activeCompany(user);

  // Change window: lock + global cut-off (shared helper), then the per-day menu cut-off and company override.
  const baseOpen = await changeable(sub.orders, settings);
  const upcoming = sub.orders.filter((o) => baseOpen.get(o.id));
  const offersByKitchen = new Map<string, Awaited<ReturnType<typeof getOffersForDates>>>();
  for (const k of new Set(upcoming.map((o) => o.kitchenId))) offersByKitchen.set(k, await getOffersForDates(upcoming.filter((o) => o.kitchenId === k).map((o) => isoDate(o.deliveryDate)), k));
  const open = new Map<string, boolean>();
  for (const o of sub.orders) {
    const d = isoDate(o.deliveryDate);
    const cutoff = earliestCutoff(offersByKitchen.get(o.kitchenId)?.get(d)?.cutoff, company?.cutoffOverride) ?? settings.orderCutoff;
    open.set(o.id, Boolean(baseOpen.get(o.id)) && (d > now.date || now.time < cutoff));
  }
  const swaps = new Map<string, { options: SwapChoice[]; cutoff: string }>();
  if (sub.status === "ACTIVE") {
    const swappable = sub.orders.filter((o) => open.get(o.id) && o.status === "SCHEDULED").slice(0, 21);
    const results = await Promise.all(swappable.map((o) => swapOptions(o.id, user.id).then((r) => [o.id, r] as const)));
    for (const [oid, r] of results) swaps.set(oid, { cutoff: r.cutoff, options: r.options.map((x) => ({ boxId: x.boxId, name: x.name, delta: x.delta, current: x.current, soldOut: x.soldOut })) });
  }

  // Extra meals: orderable days for the plan's kitchen, priced at the plan's per-meal price.
  const kitchenId = sub.address?.zone?.kitchenId ?? sub.orders[sub.orders.length - 1]?.kitchenId ?? null;
  let addDays: AddMealDay[] = [];
  if (sub.status === "ACTIVE" && kitchenId) {
    const dates = await orderableDates(settings, 10, kitchenId);
    const offers = await getOffersForDates(dates, kitchenId);
    addDays = dates
      .map((date) => ({
        date,
        options: (offers.get(date)?.items ?? []).filter((i) => !i.soldOut && (!sub.vegOnly || boxFacts(i.box).isVeg)).map((i) => ({ boxId: i.box.id, name: i.box.name, price: planMealPrice(sub, i.price) })),
      }))
      .filter((d) => d.options.length);
  }
  const methods = await availableMethods(settings, { hasCompany: false, customerShare: 1, forPlan: true });

  // Renewal (once per plan).
  const renewal = sub.renewals.find((r) => r.status !== "CANCELLED") ?? null;
  const canRenew = !renewal && ["ACTIVE", "PAUSED", "COMPLETED"].includes(sub.status) && sub.plan.isActive;
  let renewSummary: string | null = null;
  if (canRenew) {
    try {
      const r = await quoteRenewal(user, sub.id);
      renewSummary = `${r.quote.mealsTotal} lunches, ${formatDay(r.quote.dates[0])} → ${formatDay(r.quote.endDate)} · ${rs(r.quote.total)} at today's price of ${rs(r.quote.plan.pricePerMeal)} per meal. Your days, address and picks carry over; we re-check menus, holidays and locked days.`;
    } catch (e) {
      renewSummary = e instanceof Error ? e.message : null;
    }
  }
  const range = weeksRange(sub.plan);
  const weeks = Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/account/plans" className="text-sm font-semibold text-ink-soft underline">← Plans</Link>
        <h2 className="text-2xl font-extrabold">{sub.plan.name}</h2>
        <Badge tone={SUB_STATUS[sub.status].tone}>{SUB_STATUS[sub.status].label}</Badge>
      </div>
      <p className="text-sm text-ink-soft">
        {sub.reference} · {formatDay(isoDate(sub.startDate))} → {formatDay(isoDate(sub.endDate))} · {sub.mealsTotal} lunches · {rs(sub.pricePerMeal)} per meal · total {rs(sub.total)}
      </p>
      {(sub.renewedFrom || renewal) && (
        <p className="text-sm">
          {sub.renewedFrom && <>Renewal of <Link href={`/account/plans/${sub.renewedFrom.id}`} className="font-semibold underline">{sub.renewedFrom.reference}</Link>. </>}
          {renewal && <>Renewed as <Link href={`/account/plans/${renewal.id}`} className="font-semibold underline">{renewal.reference}</Link> ({SUB_STATUS[renewal.status as keyof typeof SUB_STATUS]?.label ?? renewal.status}).</>}
        </p>
      )}
      {sub.plan.policyNote && <p className="rounded-lg bg-besar-light px-3 py-2 text-sm">{sub.plan.policyNote}</p>}
      <p className="text-xs text-ink-mute">{POLICY_TEXT.skip[skipPolicyFor(sub.plan, settings)]} {POLICY_TEXT.cancel[cancelPolicyFor(sub.plan)]} Swaps are priced at your plan&apos;s per-meal price.</p>
      <PlanActions id={sub.id} status={sub.status} addresses={user.addresses.map((a) => ({ id: a.id, label: `${a.label} — ${a.area}`, covered: Boolean(a.zoneId) }))} currentAddressId={sub.addressId} cancelPolicy={cancelPolicyFor(sub.plan)} />

      {canRenew && (
        <section id="renew" className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <h3 className="text-lg font-extrabold">Renew</h3>
          <p className="mb-3 text-sm text-ink-soft">One click sets up the next plan. You pay on the next page — nothing is charged automatically.</p>
          <RenewPlan id={sub.id} methods={methods} weeks={weeks} defaultWeeks={range.default} idempotencyKey={randomUUID()} summary={renewSummary} />
        </section>
      )}

      <section>
        <h3 className="text-lg font-extrabold">Lunches</h3>
        <ul className="mt-3 space-y-2">
          {sub.orders.map((o) => {
            const swap = swaps.get(o.id);
            return (
              <OrderRow
                key={o.id}
                o={o}
                actions={
                  open.get(o.id) ? (
                    <div className="flex flex-wrap items-start gap-2">
                      <MealActions orderId={o.id} kind="plan" status={o.status} open credited={o.paymentStatus === "REFUNDED"} labels={t} />
                      {swap && <SwapMeal orderId={o.id} options={swap.options} cutoff={swap.cutoff} paid={o.paymentStatus === "PAID"} />}
                    </div>
                  ) : null
                }
              />
            );
          })}
        </ul>
      </section>

      {(sub.status === "ACTIVE" || extras.length > 0) && (
        <section>
          <h3 className="text-lg font-extrabold">Extra meals</h3>
          {extras.length > 0 && (
            <ul className="mt-3 space-y-2">
              {extras.map((o) => (
                <OrderRow key={o.id} o={o} />
              ))}
            </ul>
          )}
          {sub.status === "ACTIVE" && (
            <div className="mt-3 rounded-2xl border-2 border-ink-line bg-white p-4">
              <p className="mb-3 text-sm text-ink-soft">Add a lunch (for you or a guest) at your plan&apos;s per-meal price.</p>
              <AddMeal subscriptionId={sub.id} days={addDays} methods={methods} idempotencyKey={randomUUID()} />
            </div>
          )}
        </section>
      )}

      <section>
        <h3 className="text-lg font-extrabold">History</h3>
        {sub.changes.length === 0 ? (
          <p className="mt-2 text-sm text-ink-mute">No changes yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {sub.changes.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-3">
                <span className="font-semibold">{c.type.toLowerCase().replace("_", " ")}</span>
                {c.date && <span>{formatDay(isoDate(c.date))}</span>}
                {c.detail && <span className="text-ink-soft">{c.detail}</span>}
                {c.amount ? <span className="tabular-nums">{c.amount > 0 ? rs(c.amount) : `−${rs(-c.amount)}`}</span> : null}
                <span className="text-xs text-ink-mute">{formatStamp(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
