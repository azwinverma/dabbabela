"use client";

import { useEffect, useState } from "react";
import type { PaymentMethod } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { formatDay } from "@/lib/dates";
import { rs } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/labels";
import { addMealAction, quoteAddMealAction, renewPlanAction, swapMealAction, type AddMealQuoteDTO } from "@/lib/actions/plans";

export type SwapChoice = { boxId: string; name: string; delta: number; current: boolean; soldOut: boolean };

/** Swap one meal's dabba (before the day's cut-off). The price difference is shown before confirming. */
export function SwapMeal({ orderId, options, cutoff, paid }: { orderId: string; options: SwapChoice[]; cutoff: string; paid: boolean }) {
  const current = options.find((o) => o.current)?.boxId ?? "";
  const [boxId, setBoxId] = useState(current);
  const chosen = options.find((o) => o.boxId === boxId);
  const choices = options.filter((o) => !o.soldOut || o.current);
  if (choices.length < 2) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-akash">Swap dabba</summary>
      <ActionForm action={swapMealAction} className="mt-2 space-y-2 rounded-lg border border-ink-line bg-white p-3">
        <input type="hidden" name="orderId" value={orderId} />
        <label className="block">
          <span className="label">Dabba for this day</span>
          <select name="boxId" value={boxId} onChange={(e) => setBoxId(e.target.value)} className="field">
            {choices.map((o) => (
              <option key={o.boxId} value={o.boxId}>
                {o.name}
                {o.current ? " (current)" : o.delta > 0 ? ` (+${rs(o.delta)})` : o.delta < 0 ? ` (−${rs(-o.delta)})` : " (same price)"}
              </option>
            ))}
          </select>
        </label>
        {chosen && !chosen.current && chosen.delta !== 0 && (
          <p className="text-xs text-ink-soft">
            {chosen.delta > 0
              ? paid
                ? `${rs(chosen.delta)} more — taken from your Dabba Bela credit.`
                : `${rs(chosen.delta)} more — added to what you pay for the plan.`
              : paid
                ? `${rs(-chosen.delta)} less — added to your Dabba Bela credit.`
                : `${rs(-chosen.delta)} less to pay.`}
          </p>
        )}
        <p className="text-xs text-ink-mute">Changes close at {cutoff} on the day.</p>
        <SubmitButton size="sm" pendingText="Swapping…">Swap</SubmitButton>
      </ActionForm>
    </details>
  );
}

export type AddMealDay = { date: string; options: { boxId: string; name: string; price: number }[] };

/** Buy one extra meal at the plan's per-meal price; payment goes through the normal payment page. */
export function AddMeal({ subscriptionId, days, methods, idempotencyKey }: { subscriptionId: string; days: AddMealDay[]; methods: PaymentMethod[]; idempotencyKey: string }) {
  const [date, setDate] = useState(days[0]?.date ?? "");
  const day = days.find((d) => d.date === date);
  const [boxId, setBoxId] = useState(day?.options[0]?.boxId ?? "");
  const [quote, setQuote] = useState<AddMealQuoteDTO | null>(null);
  useEffect(() => {
    const first = days.find((d) => d.date === date)?.options[0]?.boxId ?? "";
    setBoxId((cur) => (days.find((d) => d.date === date)?.options.some((o) => o.boxId === cur) ? cur : first));
  }, [date, days]);
  useEffect(() => {
    if (!date || !boxId) return;
    let live = true;
    quoteAddMealAction({ subscriptionId, date, boxId }).then((q) => live && setQuote(q)).catch(() => live && setQuote({ ok: false, error: "We couldn't price that meal" }));
    return () => {
      live = false;
    };
  }, [subscriptionId, date, boxId]);
  if (!days.length) return <p className="text-sm text-ink-mute">No days open for extra meals right now.</p>;
  return (
    <ActionForm action={addMealAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label>
        <span className="label">Day</span>
        <select name="date" value={date} onChange={(e) => setDate(e.target.value)} className="field">
          {days.map((d) => (
            <option key={d.date} value={d.date}>{formatDay(d.date, "long")}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">Dabba</span>
        <select name="boxId" value={boxId} onChange={(e) => setBoxId(e.target.value)} className="field">
          {day?.options.map((o) => (
            <option key={o.boxId} value={o.boxId}>{o.name} · {rs(o.price)}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">Pay with</span>
        <select name="method" defaultValue={methods.includes("ESEWA") ? "ESEWA" : methods[0]} className="field">
          {methods.map((m) => (
            <option key={m} value={m}>{METHOD_LABEL[m]}</option>
          ))}
        </select>
      </label>
      <div className="self-end text-sm" aria-live="polite">
        {quote?.ok ? (
          <p>
            <b>{rs(quote.total)}</b>
            {quote.deliveryFee ? ` incl. ${rs(quote.deliveryFee)} delivery` : " · delivery included"}
            {quote.tax ? ` · VAT ${rs(quote.tax)}${quote.taxInclusive ? " incl." : ""}` : ""}
          </p>
        ) : quote ? (
          <p className="text-sindoor">{quote.error}</p>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <SubmitButton size="sm" pendingText="Adding…">Add meal &amp; pay</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** One-click renewal: same days, address and picks from the next service day; payment on the next page. */
export function RenewPlan({ id, methods, weeks, defaultWeeks, idempotencyKey, summary }: { id: string; methods: PaymentMethod[]; weeks: number[]; defaultWeeks: number; idempotencyKey: string; summary: string | null }) {
  return (
    <ActionForm action={renewPlanAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {weeks.length > 1 ? (
        <label>
          <span className="label">Length</span>
          <select name="weeks" defaultValue={String(defaultWeeks)} className="field w-32">
            {weeks.map((w) => (
              <option key={w} value={w}>{w} week{w === 1 ? "" : "s"}</option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="weeks" value={defaultWeeks} />
      )}
      <label>
        <span className="label">Pay with</span>
        <select name="method" defaultValue={methods.includes("ESEWA") ? "ESEWA" : methods[0]} className="field w-44">
          {methods.map((m) => (
            <option key={m} value={m}>{METHOD_LABEL[m]}</option>
          ))}
        </select>
      </label>
      <SubmitButton size="sm" pendingText="Renewing…">Renew plan</SubmitButton>
      {summary && <p className="w-full text-xs text-ink-mute">{summary}</p>}
    </ActionForm>
  );
}
