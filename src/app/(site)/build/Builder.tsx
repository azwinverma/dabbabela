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

type BoxDiet = "VEGAN" | "VEG" | "EGG_OK";

export type BuilderGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  /** Picking from this step makes the whole dabba follow this diet. */
  boxDiet: BoxDiet | null;
  options: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    diet: Diet;
    spice: number;
    image: string | null;
    portion: string | null;
    allergens: string[];
    portions: { id: string; label: string; priceDelta: number }[];
  }[];
};

type BuildPick = { qty: number; portionId: string | null };
type Picks = Record<string, BuildPick>; // menuItemId → pick

const DIET_CHOICES: { value: BoxDiet | ""; label: string }[] = [
  { value: "", label: "Anything" },
  { value: "EGG_OK", label: "No meat" },
  { value: "VEG", label: "Veg" },
  { value: "VEGAN", label: "Vegan" },
];
const DIET_WORD: Record<BoxDiet, string> = { VEGAN: "vegan", VEG: "veg", EGG_OK: "no-meat" };

/** Same rule as the server (`dietSatisfies` in src/server/builder.ts); the server re-checks. */
function fits(diet: Diet, level: BoxDiet) {
  if (level === "VEGAN") return diet === "VEGAN";
  if (level === "VEG") return diet === "VEGAN" || diet === "VEG";
  return diet === "VEGAN" || diet === "VEG" || diet === "EGG";
}

export function Builder({
  groups,
  dates,
  loggedIn,
  maxQty,
  floor,
  initial,
  labels,
}: {
  groups: BuilderGroup[];
  dates: { value: string; label: string }[];
  loggedIn: boolean;
  maxQty: number;
  floor: number;
  initial: { name: string; picks: { menuItemId: string; qty: number; portionId?: string | null }[] } | null;
  avoid: string[];
  labels: { add: string; day: string; noDays: string; sharedKitchen: string };
}) {
  const cart = useCart();
  const optionById = useMemo(() => new Map(groups.flatMap((g) => g.options.map((o) => [o.id, o] as const))), [groups]);
  const groupOf = useMemo(() => new Map(groups.flatMap((g) => g.options.map((o) => [o.id, g] as const))), [groups]);
  const [picks, setPicks] = useState<Picks>(() =>
    Object.fromEntries((initial?.picks ?? []).filter((p) => optionById.has(p.menuItemId)).map((p) => [p.menuItemId, { qty: p.qty, portionId: p.portionId ?? null }])),
  );
  const [diet, setDiet] = useState<BoxDiet | "">("");
  const [name, setName] = useState(initial?.name ?? "");
  const [date, setDate] = useState(dates[0]?.value ?? "");
  const [quote, setQuote] = useState<BuildQuote | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();

  const list = useMemo(
    () =>
      Object.entries(picks)
        .filter(([, p]) => p.qty > 0)
        .map(([menuItemId, p]) => ({ menuItemId, qty: p.qty, portionId: p.portionId })),
    [picks],
  );

  useEffect(() => {
    const id = setTimeout(() => start(async () => setQuote(await quoteBuildAction(list, diet || null))), 200);
    return () => clearTimeout(id);
  }, [list, diet]);

  // Dabba-wide diet: the customer's choice plus any step that forces one.
  const levels = useMemo(() => {
    const out: { level: BoxDiet; why: string }[] = [];
    if (diet) out.push({ level: diet, why: "you chose it" });
    for (const g of groups) if (g.boxDiet && g.options.some((o) => picks[o.id])) out.push({ level: g.boxDiet, why: `your ${g.name.toLowerCase()} pick` });
    return out;
  }, [diet, groups, picks]);

  function blockedBy(o: BuilderGroup["options"][number]) {
    return levels.find((l) => !fits(o.diet, l.level)) ?? null;
  }

  function unitPrice(o: BuilderGroup["options"][number], portionId: string | null) {
    const p = portionId ? o.portions.find((x) => x.id === portionId) : o.portions[0];
    return Math.max(0, o.price + (p?.priceDelta ?? 0));
  }

  // Client preview — instant and transparent. The server quote below replaces it.
  const previewLines = list.map((p) => {
    const o = optionById.get(p.menuItemId)!;
    const portion = p.portionId ? o.portions.find((x) => x.id === p.portionId) : o.portions[0];
    return { id: p.menuItemId, name: o.name, qty: p.qty, unit: unitPrice(o, p.portionId), portion: o.portions.length > 1 ? portion?.label ?? null : null };
  });
  const previewRaw = previewLines.reduce((a, l) => a + l.unit * l.qty, 0);
  const preview = list.length && previewRaw < floor ? floor : previewRaw;

  // Client-side hints (the server repeats every check).
  const localProblems: string[] = [];
  for (const g of groups) {
    const n = countIn(g);
    if (n < g.min) localProblems.push(g.min === 1 ? `${g.name}: pick one` : `${g.name}: pick at least ${g.min}`);
  }
  for (const l of previewLines) {
    const b = blockedBy(optionById.get(l.id)!);
    if (b) localProblems.push(`${l.name} can't go in a ${DIET_WORD[b.level]} dabba (${b.why})`);
  }

  function countIn(g: BuilderGroup) {
    return g.options.reduce((a, o) => a + (picks[o.id]?.qty ?? 0), 0);
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
      const o = optionById.get(id)!;
      next[id] = { qty: 1, portionId: o.portions[0]?.id ?? null };
      return next;
    });
  }

  function bump(id: string, d: number) {
    const g = groupOf.get(id)!;
    setPicks((p) => {
      const cur = p[id]?.qty ?? 0;
      if (d > 0 && countIn(g) >= g.max) return p;
      const nextQ = Math.max(0, Math.min(maxQty, cur + d));
      const next = { ...p };
      if (!nextQ) delete next[id];
      else next[id] = { ...(p[id] ?? { portionId: null }), qty: nextQ };
      return next;
    });
  }

  function setPortion(id: string, portionId: string) {
    setPicks((p) => (p[id] ? { ...p, [id]: { ...p[id], portionId } } : p));
  }

  function save() {
    setMsg(null);
    startSave(async () => {
      const r = await saveBuildAction({ name, picks: list, diet: diet || null });
      if (!r.ok) {
        setMsg({ ok: false, text: r.message });
        return;
      }
      if (date) cart.add({ kind: "custom", id: r.id, name: r.name, price: r.price, date, accent: "saag" });
      setMsg({ ok: true, text: date ? `Saved “${r.name}” and added it for ${dates.find((d) => d.value === date)?.label}.` : `Saved “${r.name}”.` });
    });
  }

  const serverFresh = quote && !pending;
  const problems = serverFresh ? quote.problems : localProblems;
  const ready = serverFresh && !quote.problem && list.length > 0;
  const shownPrice = serverFresh ? quote.price : preview;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-10">
        <fieldset>
          <legend className="text-sm font-semibold">What kind of dabba?</legend>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
            {DIET_CHOICES.map((c) => (
              <label key={c.value} className={cn("cursor-pointer rounded-full border-2 px-3 py-1.5 text-sm font-semibold", diet === c.value ? "border-ink bg-ink text-paper" : "border-ink/20")}>
                <input type="radio" name="box-diet" value={c.value} checked={diet === c.value} onChange={() => setDiet(c.value)} className="sr-only" />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

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
              {g.boxDiet && <p className="mt-2 text-xs text-ink-mute">Picking here makes the whole dabba {DIET_WORD[g.boxDiet]}.</p>}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {g.options.map((o) => {
                  const pick = picks[o.id];
                  const on = Boolean(pick);
                  const full = !on && g.max > 1 && n >= g.max;
                  const blocked = !on ? blockedBy(o) : null;
                  const disabled = full || Boolean(blocked);
                  return (
                    <div key={o.id} className={cn("flex flex-col gap-2 rounded-xl border-2 p-3 transition", on ? "border-ink bg-besar-light shadow-sticker-sm" : "border-ink/15 bg-paper-card", disabled && "opacity-50")}>
                      <div className="flex gap-3">
                        <button type="button" onClick={() => toggle(g, o.id)} disabled={disabled} aria-pressed={on} className="flex flex-1 items-start gap-3 text-left disabled:cursor-not-allowed">
                          <span aria-hidden className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center border-2 border-ink", g.max === 1 ? "rounded-full" : "rounded-md", on && "bg-ink text-paper")}>
                            {on && <Check className="h-3 w-3" />}
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                              <VegDot veg={DIET_LABEL[o.diet].veg} className="h-3.5 w-3.5" /> {o.name}
                            </span>
                            {o.description && <span className="mt-0.5 block text-xs text-ink-soft">{o.description}</span>}
                            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-mute">
                              <span className="font-bold text-ink">{rs(unitPrice(o, pick?.portionId ?? null))}</span>
                              {o.spice > 0 && <SpiceMeter level={o.spice} />}
                              {o.allergens.length > 0 && <span>· {o.allergens.join(", ")}</span>}
                            </span>
                            {blocked && <span className="mt-1 block text-xs font-semibold text-sindoor">Not {DIET_WORD[blocked.level]} ({blocked.why})</span>}
                          </span>
                        </button>
                        {on && g.max > 1 && maxQty > 1 && (
                          <div className="flex flex-col items-center justify-center gap-1" role="group" aria-label={`Quantity of ${o.name}`}>
                            <button type="button" onClick={() => bump(o.id, 1)} className="rounded-md border border-ink/30 p-1" aria-label={`One more ${o.name}`}>
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            <span className="text-sm font-bold" aria-live="polite">
                              {pick!.qty}
                            </span>
                            <button type="button" onClick={() => bump(o.id, -1)} className="rounded-md border border-ink/30 p-1" aria-label={`One less ${o.name}`}>
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      {on && o.portions.length > 1 && (
                        <div role="radiogroup" aria-label={`Portion size for ${o.name}`} className="flex flex-wrap gap-1.5 pl-8">
                          {o.portions.map((p) => {
                            const sel = (pick!.portionId ?? o.portions[0].id) === p.id;
                            return (
                              <label key={p.id} className={cn("cursor-pointer rounded-full border px-2.5 py-1 text-xs font-semibold", sel ? "border-ink bg-ink text-paper" : "border-ink/30")}>
                                <input type="radio" name={`portion-${o.id}`} value={p.id} checked={sel} onChange={() => setPortion(o.id, p.id)} className="sr-only" />
                                {p.label}
                                {p.priceDelta !== 0 && ` ${p.priceDelta > 0 ? "+" : "−"}${rs(Math.abs(p.priceDelta))}`}
                              </label>
                            );
                          })}
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
        <div className="card p-5 shadow-sticker">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-mute">Your dabba</p>
          {list.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">Start by picking a base or a main.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {previewLines.map((l) => (
                <li key={l.id} className="flex justify-between gap-2">
                  <span>
                    {l.name}
                    {l.portion ? ` (${l.portion})` : ""}
                    {l.qty > 1 ? ` ×${l.qty}` : ""}
                  </span>
                  <span className="tabular-nums text-ink-mute">{rs(l.unit * l.qty)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-baseline justify-between border-t-2 border-ink pt-3" aria-live="polite">
            <span className="font-semibold">Price</span>
            <span className={cn("font-display text-2xl font-extrabold text-sindoor tabular-nums", !serverFresh && "opacity-60")}>{rs(shownPrice)}</span>
          </div>
          <p className="mt-1 text-xs text-ink-mute">{serverFresh ? "Price confirmed by the kitchen." : "Updating price…"}</p>
          {(serverFresh ? quote.floorApplied : list.length > 0 && previewRaw < floor) && <p className="mt-1 text-xs text-ink-mute">A dabba starts at {rs(floor)} — that covers the box, packing and delivery handling.</p>}
          {quote && list.length > 0 && (
            <div className="mt-3 space-y-1 text-sm">
              <p className="flex items-center gap-1.5">
                <VegDot veg={quote.isVeg} /> {DIET_LABEL[quote.diet].label}
              </p>
              <p className="text-ink-soft">Allergens: {quote.allergens.length ? quote.allergens.map((a) => a.name).join(", ") : "none listed"}</p>
            </div>
          )}
          {list.length > 0 && problems.length > 0 && (
            <ul role="alert" className="mt-3 space-y-1 rounded-lg bg-besar-light px-3 py-2 text-sm font-semibold text-besar-dark">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {serverFresh && quote.warnings.length > 0 && list.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg bg-paper px-3 py-2 text-xs text-ink-soft">
              {quote.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

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
