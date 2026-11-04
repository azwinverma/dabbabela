"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentMethod, Weekday } from "@prisma/client";
import { quotePlanAction, subscribeAction, type PlanQuoteDTO } from "@/lib/actions/shop";
import { AddressCard, AddressForm, PaymentPicker, SummaryRow, type AddressView } from "@/components/site/DeliveryFields";
import { buttonClass } from "@/components/ui/Button";
import { formatDay, weekdayOf } from "@/lib/dates";
import { rs } from "@/lib/money";
import { format } from "@/lib/i18n";
import type { AccountDict } from "@/lib/i18n/account";
import { cn } from "@/lib/utils";

export type DayOptions = Record<string, { boxId: string; name: string; price: number; diet: string; isVeg: boolean; isPrimary: boolean; soldOut: boolean }[]>;
type Pick = { boxId?: string; customBoxId?: string };

const DAY_LABEL: Record<Weekday, string> = { SUN: "Sun", MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat" };
const ORDER: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

type Props = {
  t: AccountDict["plan"];
  plan: { id: string; slug: string; name: string; durationWeeks: number; minDaysPerWeek: number; includesDelivery: boolean };
  starts: string[];
  deliveryDays: Weekday[];
  dayOptions: DayOptions;
  customBoxes: { id: string; name: string }[];
  addresses: AddressView[];
  slots: { id: string; label: string; kitchenId: string }[];
  methods: PaymentMethod[];
  walletBalance: number;
  loggedIn: boolean;
  user: { name: string; phone: string; vegDefault: boolean } | null;
  cutoff: string;
};

export function SubscribeClient(p: Props) {
  const { t } = p;
  const router = useRouter();
  const [startDate, setStartDate] = useState(p.starts[0] ?? "");
  const [days, setDays] = useState<Weekday[]>(p.deliveryDays.filter((d) => d !== "SAT"));
  const [vegOnly, setVegOnly] = useState(Boolean(p.user?.vegDefault));
  const [addressId, setAddressId] = useState<string | null>(p.addresses.find((a) => a.isDefault && a.zoneId)?.id ?? p.addresses.find((a) => a.zoneId)?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [slotId, setSlotId] = useState("");
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(p.methods.includes("ESEWA") ? "ESEWA" : p.methods[0] ?? null);
  const [quote, setQuote] = useState<PlanQuoteDTO | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const [idempotencyKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`));

  const address = p.addresses.find((a) => a.id === addressId) ?? null;
  const kitchenSlots = p.slots.filter((s) => s.kitchenId === address?.kitchenId);
  const cleanPicks = useMemo(() => Object.fromEntries(Object.entries(picks).filter(([, v]) => v.boxId || v.customBoxId)), [picks]);

  useEffect(() => {
    if (!startDate || !days.length) return;
    let live = true;
    setLoading(true);
    const id = setTimeout(() => {
      quotePlanAction({ planId: p.plan.id, startDate, days, picks: cleanPicks, vegOnly, addressId, couponCode: coupon })
        .then((q) => {
          if (!live) return;
          if ("meals" in q) {
            setQuote(q);
            setQuoteError(null);
          } else {
            setQuote(null);
            setQuoteError(q.error);
          }
        })
        .catch(() => live && setQuoteError("We couldn't price the plan — check your connection"))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [p.plan.id, startDate, days, cleanPicks, vegOnly, addressId, coupon]);

  function toggleDay(d: Weekday) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : ORDER.filter((x) => x === d || cur.includes(x))));
  }

  const effectiveMethod: PaymentMethod | null = quote && quote.customerShare <= 0 && quote.companyShare > 0 ? "COMPANY_INVOICE" : method;
  const walletShort = effectiveMethod === "WALLET" && quote ? p.walletBalance < quote.customerShare : false;
  const canSubmit = Boolean(p.loggedIn && quote?.ok && address?.zoneId && effectiveMethod && !walletShort && !loading && !submitting);

  function submit() {
    if (!address || !effectiveMethod) return;
    setError(null);
    startSubmit(async () => {
      const r = await subscribeAction({ planId: p.plan.id, startDate, days, picks: cleanPicks, vegOnly, addressId: address.id, slotId: slotId || null, couponCode: coupon, method: effectiveMethod, idempotencyKey });
      if (!r.ok) {
        setError(r.error ?? "We couldn't start your plan");
        if (r.redirectTo) router.push(r.redirectTo);
        return;
      }
      router.push(r.redirectTo ?? "/account/plans");
    });
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        {/* step 1 */}
        <section aria-labelledby="s1" className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <h2 id="s1" className="text-xl font-extrabold">1 · When</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label>
              <span className="label">{t.start}</span>
              <select value={startDate} onChange={(e) => setStartDate(e.target.value)} className="field">
                {p.starts.map((d) => (
                  <option key={d} value={d}>
                    {formatDay(d, "long")}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm font-semibold">
              <input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} className="h-4 w-4 accent-sindoor" />
              {t.vegOnly}
            </label>
          </div>
          <fieldset className="mt-4">
            <legend className="label">
              {t.days} <span className="normal-case text-ink-mute">(at least {p.plan.minDaysPerWeek})</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {ORDER.filter((d) => p.deliveryDays.includes(d)).map((d) => (
                <label key={d} className={cn("cursor-pointer rounded-full border-2 px-4 py-1.5 text-sm font-bold", days.includes(d) ? "border-ink bg-ink text-paper" : "border-ink-line bg-white hover:border-ink")}>
                  <input type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)} className="sr-only" />
                  {DAY_LABEL[d]}
                </label>
              ))}
            </div>
            {days.length < p.plan.minDaysPerWeek && <p className="mt-2 text-sm text-sindoor">Pick at least {p.plan.minDaysPerWeek} days.</p>}
          </fieldset>
        </section>

        {/* step 2: calendar */}
        <section aria-labelledby="s2" className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <h2 id="s2" className="text-xl font-extrabold">2 · {t.calendar}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t.calendarIntro} Changes close at {p.cutoff} on each day, even after you've paid.</p>
          {quoteError && <p role="alert" className="mt-3 rounded-lg bg-sindoor-light px-3 py-2 text-sm font-semibold text-sindoor-dark">{quoteError}</p>}
          {!quote && !quoteError && (
            <div className="mt-4 space-y-2" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-12" />
              ))}
            </div>
          )}
          {quote && (
            <ol className={cn("mt-4 divide-y divide-ink-line rounded-xl border-2 border-ink-line bg-white", loading && "opacity-60")}>
              {quote.meals.map((m) => {
                const options = p.dayOptions[m.date] ?? [];
                const pick = picks[m.date];
                const value = pick?.customBoxId ? `c:${pick.customBoxId}` : pick?.boxId ? `b:${pick.boxId}` : "";
                const chef = options.find((o) => o.isPrimary && (!vegOnly || o.isVeg)) ?? options.find((o) => !vegOnly || o.isVeg);
                return (
                  <li key={m.date} className="grid gap-2 px-3 py-3 sm:grid-cols-[120px_1fr_auto] sm:items-center">
                    <span className="text-sm font-extrabold">
                      {formatDay(m.date)}
                      <span className="block text-xs font-normal text-ink-mute">{weekdayOf(m.date)}</span>
                    </span>
                    <label className="min-w-0">
                      <span className="sr-only">Lunch for {formatDay(m.date, "long")}</span>
                      <select
                        value={value}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPicks((cur) => ({ ...cur, [m.date]: v.startsWith("c:") ? { customBoxId: v.slice(2) } : v.startsWith("b:") ? { boxId: v.slice(2) } : {} }));
                        }}
                        className="field"
                      >
                        <option value="">{t.chefPick}{chef ? `: ${chef.name}` : ""}</option>
                        {options
                          .filter((o) => !o.soldOut && (!vegOnly || o.isVeg))
                          .map((o) => (
                            <option key={o.boxId} value={`b:${o.boxId}`}>
                              {o.name} · {o.diet.toLowerCase()}
                            </option>
                          ))}
                        {p.customBoxes.map((c) => (
                          <option key={c.id} value={`c:${c.id}`}>
                            My dabba: {c.name}
                          </option>
                        ))}
                      </select>
                      {m.problem && <span className="mt-1 block text-xs font-semibold text-sindoor">{m.problem}</span>}
                    </label>
                    <span className="text-right text-sm tabular-nums">
                      {m.surcharge > 0 ? <span className="font-semibold text-besar-dark">+{rs(m.surcharge)}</span> : <span className="text-ink-mute">included</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {quote && (quote.closures.length > 0 || quote.skippedDates.length > 0) && (
            <div className="mt-3 rounded-lg bg-ink/5 px-3 py-2 text-xs text-ink-soft">
              {quote.closures.length > 0 && (
                <p>
                  {t.closed} ({t.excluded.toLowerCase()}): {quote.closures.map((c) => `${formatDay(c.date)} — ${c.name}`).join("; ")}
                </p>
              )}
              {quote.skippedDates.length > 0 && <p>Too late to book: {quote.skippedDates.map((d) => formatDay(d)).join(", ")}</p>}
            </div>
          )}
        </section>

        {/* step 3: address */}
        <section aria-labelledby="s3" className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <h2 id="s3" className="text-xl font-extrabold">3 · Where</h2>
          {!p.loggedIn ? (
            <p className="mt-3 text-sm">
              <Link href={`/login?next=/plans/${p.plan.slug}`} className="font-bold text-sindoor underline">Log in</Link> or{" "}
              <Link href={`/register?next=/plans/${p.plan.slug}`} className="font-bold text-sindoor underline">create an account</Link> to choose your delivery address.
            </p>
          ) : (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {p.addresses.map((a) => (
                  <AddressCard key={a.id} a={a} selected={a.id === addressId} onSelect={() => setAddressId(a.id)} />
                ))}
              </div>
              {address && !address.zoneId && <p role="alert" className="mt-3 text-sm font-semibold text-sindoor">We don't deliver to {address.area} yet — pick another address.</p>}
              {adding ? (
                <div className="mt-4">
                  <AddressForm
                    compact
                    defaults={{ recipientName: p.user?.name, phone: p.user?.phone }}
                    onSaved={(r) => {
                      setAdding(false);
                      if (r.addressId) setAddressId(r.addressId);
                      router.refresh();
                    }}
                    onCancel={() => setAdding(false)}
                  />
                </div>
              ) : (
                <button type="button" onClick={() => setAdding(true)} className="mt-3 text-sm font-bold text-sindoor underline">
                  + Add an address
                </button>
              )}
              {address?.zoneId && kitchenSlots.length > 0 && (
                <div className="mt-4">
                  <span className="label">Delivery window</span>
                  <div className="flex flex-wrap gap-2">
                    {[{ id: "", label: "Any time in the lunch window" }, ...kitchenSlots].map((s) => (
                      <label key={s.id || "any"} className={cn("cursor-pointer rounded-full border-2 px-4 py-1.5 text-sm font-semibold", slotId === s.id ? "border-ink bg-ink text-paper" : "border-ink-line bg-white")}>
                        <input type="radio" name="slot" checked={slotId === s.id} onChange={() => setSlotId(s.id)} className="sr-only" />
                        {s.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {p.loggedIn && (
          <section aria-labelledby="s4" className="rounded-2xl border-2 border-ink bg-paper-card p-5">
            <h2 id="s4" className="text-xl font-extrabold">4 · Pay</h2>
            <div className="mt-3">
              {effectiveMethod === "COMPANY_INVOICE" ? (
                <p className="rounded-xl border-2 border-saag bg-saag-light px-4 py-3 font-semibold text-saag-dark">Your company covers this plan — nothing to pay now.</p>
              ) : (
                <PaymentPicker methods={p.methods} value={method} onChange={setMethod} walletBalance={p.walletBalance} />
              )}
              {walletShort && <p className="mt-2 text-sm text-sindoor">Not enough credit for this plan.</p>}
            </div>
          </section>
        )}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border-2 border-ink bg-paper-card p-5 shadow-sticker">
          <p className="text-lg font-extrabold">{p.plan.name}</p>
          {quote ? (
            <div className={cn("mt-3", loading && "opacity-60")} aria-live="polite">
              <p className="text-sm text-ink-soft">
                {format(t.meals, { n: quote.mealsTotal })} · {quote.meals[0] ? formatDay(quote.meals[0].date) : ""} → {quote.endDate ? formatDay(quote.endDate) : ""}
              </p>
              <div className="mt-3">
                <SummaryRow label="Lunches" value={quote.subtotal} />
                {quote.companyDiscount > 0 && <SummaryRow label="Team discount" value={quote.companyDiscount} negative />}
                {quote.couponDiscount > 0 && <SummaryRow label="Coupon" value={quote.couponDiscount} negative />}
                <SummaryRow label={p.plan.includesDelivery ? "Delivery (included)" : "Delivery"} value={quote.deliveryFee} />
                {quote.tax > 0 && <SummaryRow label={quote.taxInclusive ? "VAT included" : "VAT"} value={quote.tax} muted={quote.taxInclusive} />}
                <SummaryRow label="Total" value={quote.total} strong />
                {quote.companyShare > 0 && (
                  <>
                    <SummaryRow label="Company pays" value={quote.companyShare} muted />
                    <SummaryRow label="You pay" value={quote.customerShare} strong />
                  </>
                )}
              </div>
              <p className="mt-2 text-sm">
                <strong>{rs(quote.perMealEffective)}</strong> {t.perMeal}
                {quote.savings > 0 && <span className="ml-1 text-saag-dark">· you save {rs(quote.savings)} vs single orders</span>}
              </p>
              {(quote.error || quote.addressProblem) && <p role="alert" className="mt-3 rounded-lg bg-sindoor-light px-3 py-2 text-sm font-semibold text-sindoor-dark">{quote.addressProblem ?? quote.error}</p>}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="skeleton h-5" />
              <div className="skeleton h-7" />
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCoupon(couponInput.trim() || null);
            }}
            className="mt-4 flex gap-2"
          >
            <label htmlFor="pcoupon" className="sr-only">Coupon</label>
            <input id="pcoupon" value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} placeholder="Coupon code" className="field" maxLength={30} />
            <button type="submit" className={buttonClass("outline", "sm")}>Apply</button>
          </form>
          {coupon && quote?.couponError && <p className="mt-1 text-xs font-semibold text-sindoor">{quote.couponError}</p>}
          {quote?.couponCode && <p className="mt-1 text-xs font-semibold text-saag-dark">{quote.couponCode} applied</p>}
          {error && <p role="alert" className="mt-3 rounded-lg bg-sindoor-light px-3 py-2 text-sm font-semibold text-sindoor-dark">{error}</p>}
          {p.loggedIn ? (
            <button type="button" onClick={submit} disabled={!canSubmit} className={buttonClass("primary", "lg", "mt-5 w-full")}>
              {submitting ? "Starting…" : quote ? `${t.subscribe} · ${rs(effectiveMethod === "COMPANY_INVOICE" ? 0 : quote.customerShare)}` : t.subscribe}
            </button>
          ) : (
            <Link href={`/login?next=/plans/${p.plan.slug}`} className={buttonClass("primary", "lg", "mt-5 w-full")}>
              Log in to start
            </Link>
          )}
          <p className="mt-3 text-xs text-ink-mute">Renewal is manual — we remind you two days before the plan ends.</p>
        </div>
      </aside>
    </div>
  );
}
