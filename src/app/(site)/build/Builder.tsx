"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Minus, Plus, Check } from "lucide-react";
import type { Diet } from "@prisma/client";
import { useCart } from "@/components/site/cart";
import { buttonClass } from "@/components/ui/Button";
import { quoteBuildAction, saveBuildAction, type BuildQuote } from "@/lib/actions/build";
import { rs } from "@/lib/money";
import { cn } from "@/lib/utils";
import { DIET_LABEL } from "@/lib/labels";
import { VegDot, SpiceMeter } from "@/components/site/BoxCard";

export type BuilderGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  options: { id: string; name: string; description: string | null; price: number; diet: Diet; spice: number; image: string | null; portion: string | null; allergens: string[] }[];
};

type Picks = Record<string, number>; // menuItemId → qty

export function Builder({
  groups,
  dates,
  loggedIn,
  maxQty,
  initial,
  labels,
}: {
  groups: BuilderGroup[];
  dates: { value: string; label: string }[];
  loggedIn: boolean;
  maxQty: number;
  initial: { name: string; picks: { menuItemId: string; qty: number }[] } | null;
  avoid: string[];
  labels: { add: string; day: string; noDays: string; sharedKitchen: string };
}) {
  const cart = useCart();
  const [picks, setPicks] = useState<Picks>(() => Object.fromEntries((initial?.picks ?? []).map((p) => [p.menuItemId, p.qty])));
  const [name, setName] = useState(initial?.name ?? "");
  const [date, setDate] = useState(dates[0]?.value ?? "");
  const [quote, setQuote] = useState<BuildQuote | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();

  const list = useMemo(() => Object.entries(picks).filter(([, q]) => q > 0).map(([menuItemId, qty]) => ({ menuItemId, qty })), [picks]);
  const groupOf = useMemo(() => new Map(groups.flatMap((g) => g.options.map((o) => [o.id, g] as const))), [groups]);

  useEffect(() => {
    const id = setTimeout(() => start(async () => setQuote(await quoteBuildAction(list))), 200);
    return () => clearTimeout(id);
  }, [list]);

  function countIn(g: BuilderGroup) {
    return g.options.reduce((a, o) => a + (picks[o.id] ?? 0), 0);
  }

  function toggle(g: BuilderGroup, id: string) {
    setMsg(null);
    setPicks((p) => {
      const next = { ...p };
      if (next[id]) {
        delete next[id];
        return next;
      }
      if (g.max === 1) for (const o of g.options) delete next[o.id];
      else if (countIn(g) >= g.max) return p;
      next[id] = 1;
      return next;
    });
  }

  function bump(id: string, d: number) {
    const g = groupOf.get(id)!;
    setPicks((p) => {
      const cur = p[id] ?? 0;
      const total = countIn(g);
      const nextQ = Math.max(0, Math.min(maxQty, cur + d));
      if (d > 0 && total >= g.max) return p;
      const next = { ...p, [id]: nextQ };
      if (!nextQ) delete next[id];
      return next;
    });
  }

  function save() {
    setMsg(null);
    startSave(async () => {
      const r = await saveBuildAction({ name, picks: list });
      if (!r.ok) {
        setMsg({ ok: false, text: r.message });
        return;
      }
      if (date) cart.add({ kind: "custom", id: r.id, name: r.name, price: r.price, date, accent: "saag" });
      setMsg({ ok: true, text: date ? `Saved “${r.name}” and added it for ${dates.find((d) => d.value === date)?.label}.` : `Saved “${r.name}”.` });
    });
  }

  const ready = quote && !quote.problem && list.length > 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-10">
        {groups.map((g, gi) => {
          const n = countIn(g);
          return (
            <fieldset key={g.id}>
              <legend className="flex w-full items-baseline justify-between gap-3 border-b-2 border-ink pb-2">
                <span className="font-display text-xl font-extrabold">
                  <span className="mr-2 text-besar-dark">{gi + 1}.</span>
                  {g.name}
                </span>
                <span className={cn("text-sm font-semibold", n < g.min ? "text-sindoor" : "text-ink-mute")}>
                  {g.min > 0 ? `pick ${g.min === g.max ? g.min : `${g.min}–${g.max}`}` : `optional · up to ${g.max}`}
                </span>
              </legend>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {g.options.map((o) => {
                  const on = (picks[o.id] ?? 0) > 0;
                  const full = !on && g.max > 1 && n >= g.max;
                  return (
                    <div key={o.id} className={cn("flex gap-3 rounded-xl border-2 p-3 transition", on ? "border-ink bg-besar-light shadow-sticker-sm" : "border-ink/15 bg-paper-card", full && "opacity-50")}>
                      <button type="button" onClick={() => toggle(g, o.id)} disabled={full} aria-pressed={on} className="flex flex-1 items-start gap-3 text-left disabled:cursor-not-allowed">
                        <span aria-hidden className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center border-2 border-ink", g.max === 1 ? "rounded-full" : "rounded-md", on && "bg-ink text-paper")}>
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                            <VegDot veg={DIET_LABEL[o.diet].veg} className="h-3.5 w-3.5" /> {o.name}
                          </span>
                          {o.description && <span className="mt-0.5 block text-xs text-ink-soft">{o.description}</span>}
                          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-mute">
                            <span className="font-bold text-ink">{rs(o.price)}</span>
                            {o.spice > 0 && <SpiceMeter level={o.spice} />}
                            {o.allergens.length > 0 && <span>· {o.allergens.join(", ")}</span>}
                          </span>
                        </span>
                      </button>
                      {on && g.max > 1 && maxQty > 1 && (
                        <div className="flex flex-col items-center justify-center gap-1" aria-label={`Quantity of ${o.name}`}>
                          <button type="button" onClick={() => bump(o.id, 1)} className="rounded-md border border-ink/30 p-0.5" aria-label="More">
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <span className="text-sm font-bold">{picks[o.id]}</span>
                          <button type="button" onClick={() => bump(o.id, -1)} className="rounded-md border border-ink/30 p-0.5" aria-label="Less">
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="card p-5 shadow-sticker" aria-live="polite">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-mute">Your dabba</p>
          {list.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">Start by picking a base or a main.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {list.map((p) => {
                const o = groups.flatMap((g) => g.options).find((x) => x.id === p.menuItemId);
                return (
                  <li key={p.menuItemId} className="flex justify-between gap-2">
                    <span>
                      {o?.name}
                      {p.qty > 1 ? ` ×${p.qty}` : ""}
                    </span>
                    <span className="text-ink-mute">{o ? rs(o.price * p.qty) : ""}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 flex items-baseline justify-between border-t-2 border-ink pt-3">
            <span className="font-semibold">Price</span>
            <span className={cn("font-display text-2xl font-extrabold text-sindoor", pending && "opacity-50")}>{rs(quote?.price ?? 0)}</span>
          </div>
          {quote?.floorApplied && <p className="mt-1 text-xs text-ink-mute">A dabba starts at {rs(quote.floor)} — that covers the box, packing and delivery handling.</p>}
          {quote && list.length > 0 && (
            <div className="mt-3 space-y-1 text-sm">
              <p className="flex items-center gap-1.5">
                <VegDot veg={quote.isVeg} /> {DIET_LABEL[quote.diet].label}
              </p>
              <p className="text-ink-soft">Allergens: {quote.allergens.length ? quote.allergens.map((a) => a.name).join(", ") : "none listed"}</p>
            </div>
          )}
          {quote?.problem && list.length > 0 && <p className="mt-3 rounded-lg bg-besar-light px-3 py-2 text-sm font-semibold text-besar-dark">{quote.problem}</p>}

          <label className="mt-4 block">
            <span className="label">Name it</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Thursday usual" className="field" />
          </label>
          {dates.length ? (
            <label className="mt-3 block">
              <span className="label">{labels.day}</span>
              <select value={date} onChange={(e) => setDate(e.target.value)} className="field">
                {dates.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="mt-3 text-sm text-ink-mute">{labels.noDays}</p>
          )}
          {loggedIn ? (
            <button type="button" onClick={save} disabled={!ready || saving} className={buttonClass("primary", "md", "mt-4 w-full")}>
              {saving ? "Saving…" : date ? `Save & ${labels.add.toLowerCase()}` : "Save dabba"}
            </button>
          ) : (
            <Link href="/login?next=/build" className={buttonClass("primary", "md", "mt-4 w-full")}>
              Log in to save & order
            </Link>
          )}
          {msg && (
            <p role={msg.ok ? "status" : "alert"} className={cn("mt-3 rounded-lg px-3 py-2 text-sm font-medium", msg.ok ? "bg-saag-light text-saag-dark" : "bg-sindoor-light text-sindoor-dark")}>
              {msg.text}{" "}
              {msg.ok && (
                <Link href="/checkout" className="font-semibold underline">
                  Checkout
                </Link>
              )}
            </p>
          )}
          <p className="mt-4 text-xs text-ink-mute">{labels.sharedKitchen}</p>
        </div>
      </aside>
    </div>
  );
}
