"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentMethod } from "@prisma/client";
import { useCart, toCartLines } from "@/components/site/cart";
import { AddressCard, AddressForm, PaymentPicker, SummaryRow, type AddressView } from "@/components/site/DeliveryFields";
import { quoteCartAction, placeOrderAction, type CartQuoteDTO } from "@/lib/actions/shop";
import { buttonClass } from "@/components/ui/Button";
import { formatDay } from "@/lib/dates";
import { rs } from "@/lib/money";
import { format } from "@/lib/i18n";
import type { AccountDict } from "@/lib/i18n/account";
import { cn } from "@/lib/utils";

type Props = {
  t: AccountDict["checkout"];
  addresses: AddressView[];
  slots: { id: string; label: string; kitchenId: string }[];
  methods: PaymentMethod[];
  walletBalance: number;
  user: { name: string; phone: string; allergies: string[] };
  company: { name: string } | null;
};

export function CheckoutClient({ t, addresses, slots, methods, walletBalance, user, company }: Props) {
  const cart = useCart();
  const router = useRouter();
  const [addressId, setAddressId] = useState<string | null>(addresses.find((a) => a.isDefault && a.zoneId)?.id ?? addresses.find((a) => a.zoneId)?.id ?? addresses[0]?.id ?? null);
  const [adding, setAdding] = useState(addresses.length === 0);
  const [slotId, setSlotId] = useState<string>("");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(methods.includes("ESEWA") ? "ESEWA" : methods[0] ?? null);
  const [notes, setNotes] = useState("");
  const [quote, setQuote] = useState<CartQuoteDTO | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placing, startPlacing] = useTransition();
  const [idempotencyKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`));

  const lines = useMemo(() => toCartLines(cart.items), [cart.items]);
  const address = addresses.find((a) => a.id === addressId) ?? null;
  const kitchenSlots = slots.filter((s) => s.kitchenId === address?.kitchenId);

  useEffect(() => {
    if (!cart.ready || !lines.length) return;
    let live = true;
    setQuoting(true);
    quoteCartAction({ lines, addressId, couponCode: coupon })
      .then((q) => live && setQuote(q))
      .catch(() => live && setError("We couldn't price your order — check your connection"))
      .finally(() => live && setQuoting(false));
    return () => {
      live = false;
    };
  }, [cart.ready, lines, addressId, coupon]);

  useEffect(() => {
    if (slotId && !kitchenSlots.some((s) => s.id === slotId)) setSlotId("");
  }, [kitchenSlots, slotId]);

  if (!cart.ready)
    return (
      <div className="mt-8 grid gap-4" aria-busy="true">
        <div className="skeleton h-24" />
        <div className="skeleton h-48" />
      </div>
    );

  if (!cart.items.length)
    return (
      <div className="mt-8 rounded-2xl border-2 border-dashed border-ink-line p-10 text-center">
        <p className="text-lg text-ink-soft">{t.empty}</p>
        <Link href="/menu" className={buttonClass("primary", "md", "mt-4")}>
          {t.browse}
        </Link>
      </div>
    );

  const billedToCompany = quote ? quote.customerShare <= 0 && quote.companyShare > 0 : false;
  const effectiveMethod: PaymentMethod | null = billedToCompany ? "COMPANY_INVOICE" : method;
  const walletShort = effectiveMethod === "WALLET" && quote ? walletBalance < quote.customerShare : false;
  const canPlace = Boolean(quote?.ok && address?.zoneId && effectiveMethod && !walletShort && !quoting && !placing);
  const byDate = new Map<string, CartQuoteDTO["lines"]>();
  for (const l of quote?.lines ?? []) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);

  function place() {
    if (!address || !effectiveMethod) return;
    setError(null);
    startPlacing(async () => {
      const r = await placeOrderAction({ lines, addressId: address.id, slotId: slotId || null, couponCode: coupon, method: effectiveMethod, notes: notes || null, idempotencyKey });
      if (!r.ok) {
        setError(r.error ?? "We couldn't place your order");
        if (r.redirectTo) router.push(r.redirectTo);
        return;
      }
      cart.clear();
      router.push(r.redirectTo ?? "/account");
    });
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        {/* lines */}
        <section aria-labelledby="items-h">
          <h2 id="items-h" className="text-xl font-extrabold">Your dabbas</h2>
          <div className="mt-3 space-y-4">
            {(quote ? [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)) : groupItems(cart.items)).map(([date, ls]) => (
              <div key={date} className="rounded-2xl border-2 border-ink bg-paper-card p-4">
                <p className="text-sm font-extrabold">{formatDay(date, "long")}</p>
                <ul className="mt-2 divide-y divide-ink-line">
                  {ls.map((l) => {
                    const item = cart.items.find((i) => i.key === l.key);
                    const ql = "problem" in l ? (l as CartQuoteDTO["lines"][number]) : null;
                    return (
                      <li key={l.key} className="py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold">{l.name}</p>
                            {ql?.customizations.length ? <p className="text-xs text-ink-mute">{ql.customizations.join(" · ")}</p> : item?.subsLabel ? <p className="text-xs text-ink-mute">{item.subsLabel}</p> : null}
                            {ql?.problem && <p className="mt-1 text-sm font-semibold text-sindoor">{ql.problem}</p>}
                            {ql?.warning && (
                              <p className="mt-1 rounded bg-sindoor-light px-2 py-0.5 text-xs font-semibold text-sindoor-dark">
                                {t.allergenWarning}: {ql.warning}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {item && (
                              <label className="sr-only" htmlFor={`q-${item.key}`}>
                                Quantity
                              </label>
                            )}
                            {item && (
                              <select id={`q-${item.key}`} value={item.qty} onChange={(e) => cart.setQty(item.key, Number(e.target.value))} className="field w-16 py-1">
                                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            )}
                            <span className="w-20 text-right font-bold tabular-nums">{ql ? rs(ql.unitPrice * ql.qty) : item ? rs(item.price * item.qty) : ""}</span>
                            {item && (
                              <button type="button" onClick={() => cart.remove(item.key)} className="text-xs font-semibold text-ink-mute underline" aria-label={`Remove ${l.name}`}>
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          {user.allergies.length > 0 && <p className="mt-3 text-xs text-ink-mute">Your allergies ({user.allergies.join(", ").toLowerCase()}) will be printed on each label. Shared kitchen — we can't guarantee zero cross-contact.</p>}
        </section>

        {/* address */}
        <section aria-labelledby="addr-h">
          <h2 id="addr-h" className="text-xl font-extrabold">{t.deliverTo}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {addresses.map((a) => (
              <AddressCard key={a.id} a={a} selected={a.id === addressId} onSelect={() => setAddressId(a.id)} />
            ))}
          </div>
          {address && !address.zoneId && (
            <p role="alert" className="mt-3 rounded-lg border border-sindoor/30 bg-sindoor-light px-3 py-2 text-sm text-sindoor-dark">
              {t.notCovered} ({address.area}). Pick another address, or <Link href="/delivery-areas" className="font-semibold underline">see our delivery areas</Link>.
            </p>
          )}
          {adding ? (
            <div className="mt-4 rounded-2xl border-2 border-ink bg-paper-card p-5">
              <AddressForm
                compact
                defaults={{ recipientName: user.name, phone: user.phone }}
                onSaved={(r) => {
                  setAdding(false);
                  if (r.addressId) setAddressId(r.addressId);
                  router.refresh();
                }}
                onCancel={addresses.length ? () => setAdding(false) : undefined}
              />
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="mt-3 text-sm font-bold text-sindoor underline underline-offset-2">
              + {t.addNew}
            </button>
          )}
        </section>

        {address?.zoneId && (
          <section aria-labelledby="slot-h">
            <h2 id="slot-h" className="text-xl font-extrabold">{t.slot}</h2>
            <div role="radiogroup" className="mt-3 flex flex-wrap gap-2">
              {[{ id: "", label: t.anySlot }, ...kitchenSlots].map((s) => (
                <label key={s.id || "any"} className={cn("cursor-pointer rounded-full border-2 px-4 py-1.5 text-sm font-semibold", slotId === s.id ? "border-ink bg-ink text-paper" : "border-ink-line bg-white hover:border-ink")}>
                  <input type="radio" name="slot" value={s.id} checked={slotId === s.id} onChange={() => setSlotId(s.id)} className="sr-only" />
                  {s.label}
                </label>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="label">Note for this order (optional)</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 500))} className="field" placeholder="e.g. extra achar on the side, please" />
            </label>
          </section>
        )}

        <section aria-labelledby="pay-h">
          <h2 id="pay-h" className="text-xl font-extrabold">{t.payWith}</h2>
          <div className="mt-3">
            {billedToCompany ? (
              <p className="rounded-xl border-2 border-saag bg-saag-light px-4 py-3 font-semibold text-saag-dark">{format(t.billedToCompany, { company: quote?.company?.name ?? company?.name ?? "your company" })}</p>
            ) : (
              <PaymentPicker methods={methods} value={method} onChange={setMethod} walletBalance={walletBalance} />
            )}
            {walletShort && <p className="mt-2 text-sm text-sindoor">Your credit ({rs(walletBalance)}) doesn't cover this order — pick another method.</p>}
          </div>
        </section>
      </div>

      {/* summary */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border-2 border-ink bg-paper-card p-5 shadow-sticker">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCoupon(couponInput.trim() || null);
            }}
            className="flex gap-2"
          >
            <label className="sr-only" htmlFor="coupon">
              {t.coupon}
            </label>
            <input id="coupon" value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} placeholder={t.coupon} className="field" maxLength={30} />
            <button type="submit" className={buttonClass("outline", "sm")}>
              {t.apply}
            </button>
          </form>
          {quote?.couponError && coupon && <p className="mt-1 text-xs font-semibold text-sindoor">{quote.couponError}</p>}
          {quote?.couponCode && <p className="mt-1 text-xs font-semibold text-saag-dark">{quote.couponCode} applied</p>}

          <div className={cn("mt-4", quoting && "opacity-60")} aria-live="polite">
            {quote ? (
              <>
                <SummaryRow label="Subtotal" value={quote.subtotal} />
                {quote.companyDiscount > 0 && <SummaryRow label="Team discount" value={quote.companyDiscount} negative />}
                {quote.couponDiscount > 0 && <SummaryRow label="Coupon" value={quote.couponDiscount} negative />}
                <SummaryRow label={`Delivery (${quote.days.length} day${quote.days.length === 1 ? "" : "s"})`} value={quote.deliveryFee} />
                {quote.tax > 0 && <SummaryRow label={quote.taxInclusive ? "VAT included" : "VAT"} value={quote.tax} muted={quote.taxInclusive} />}
                <SummaryRow label="Total" value={quote.total} strong />
                {quote.companyShare > 0 && (
                  <>
                    <SummaryRow label={format(t.companyPays, { company: quote.company?.name ?? "Company" })} value={quote.companyShare} muted />
                    <SummaryRow label={t.youPay} value={quote.customerShare} strong />
                  </>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <div className="skeleton h-5" />
                <div className="skeleton h-5" />
                <div className="skeleton h-7" />
              </div>
            )}
          </div>
          {quote && !quote.ok && (quote.error || quote.addressProblem) && (
            <p role="alert" className="mt-3 rounded-lg bg-sindoor-light px-3 py-2 text-sm font-semibold text-sindoor-dark">
              {quote.addressProblem ?? quote.error}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-sindoor-light px-3 py-2 text-sm font-semibold text-sindoor-dark">
              {error}
            </p>
          )}
          <button type="button" onClick={place} disabled={!canPlace} className={buttonClass("primary", "lg", "mt-5 w-full")}>
            {placing ? t.placing : quote ? `${t.place} · ${rs(billedToCompany ? 0 : quote.customerShare)}` : t.place}
          </button>
          {!address && <p className="mt-2 text-center text-xs text-ink-mute">Add a delivery address to continue.</p>}
        </div>
      </aside>
    </div>
  );
}

function groupItems(items: ReturnType<typeof useCart>["items"]) {
  const m = new Map<string, { key: string; name: string }[]>();
  for (const i of items) m.set(i.date, [...(m.get(i.date) ?? []), { key: i.key, name: i.name }]);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}
