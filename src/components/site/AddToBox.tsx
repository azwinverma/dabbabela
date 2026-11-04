"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { useCart } from "./cart";
import { buttonClass } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { rs } from "@/lib/money";

type BoxRef = { id: string; name: string; price: number; accent?: string; image?: string | null; kind?: "box" | "custom" };
type Sub = { id: string; from: string; to: string; priceDelta: number };
type Labels = { add: string; added: string; checkout: string; day: string; none: string; swaps?: string; swapNone?: string };

const DEFAULT_LABELS: Labels = { add: "Add to my dabbas", added: "Added", checkout: "Checkout", day: "Delivery day", none: "No delivery days open right now." };

export function AddToBox({
  box,
  date,
  dates,
  subs = [],
  disabledReason,
  compact,
  className,
  labels = DEFAULT_LABELS,
}: {
  box: BoxRef;
  date?: string;
  dates?: { value: string; label: string; price?: number; soldOut?: boolean }[];
  subs?: Sub[];
  disabledReason?: string | null;
  compact?: boolean;
  className?: string;
  labels?: Labels;
}) {
  const cart = useCart();
  const open = dates?.filter((d) => !d.soldOut) ?? [];
  const [picked, setPicked] = useState(date ?? open[0]?.value ?? "");
  const [chosen, setChosen] = useState<Record<string, string>>({}); // from-dish → sub id
  const [added, setAdded] = useState(false);

  if (disabledReason) return <p className={cn("text-xs font-semibold text-ink-mute", className)}>{disabledReason}</p>;
  if (!date && !open.length) return <p className={cn("text-xs text-ink-mute", className)}>{labels.none}</p>;

  const dayPrice = (dates?.find((d) => d.value === picked)?.price ?? box.price) as number;
  const picks = Object.values(chosen).map((id) => subs.find((s) => s.id === id)!).filter(Boolean);
  const price = dayPrice + picks.reduce((a, s) => a + s.priceDelta, 0);
  const groups = [...new Set(subs.map((s) => s.from))];

  function add() {
    if (!picked) return;
    cart.add({
      kind: box.kind ?? "box",
      id: box.id,
      name: box.name,
      price,
      date: picked,
      accent: box.accent,
      image: box.image,
      subs: picks.map((s) => s.id),
      subsLabel: picks.map((s) => `${s.from} → ${s.to}`).join(", ") || undefined,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2400);
  }

  return (
    <div className={cn("space-y-3", className)}>
      {groups.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="label">{labels.swaps ?? "Swaps"}</legend>
          {groups.map((from) => (
            <label key={from} className="block text-sm">
              <span className="sr-only">{from}</span>
              <select
                className="field"
                value={chosen[from] ?? ""}
                onChange={(e) => setChosen((c) => ({ ...c, [from]: e.target.value }))}
              >
                <option value="">
                  {from} — {labels.swapNone ?? "no swap"}
                </option>
                {subs
                  .filter((s) => s.from === from)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {from} → {s.to} {s.priceDelta ? `(${s.priceDelta > 0 ? "+" : ""}${rs(s.priceDelta)})` : ""}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!date && dates && (
          <label className="min-w-0">
            <span className="sr-only">{labels.day}</span>
            <select value={picked} onChange={(e) => setPicked(e.target.value)} className="h-10 max-w-[11rem] rounded-xl border-2 border-ink bg-white px-2 text-sm font-semibold">
              {dates.map((d) => (
                <option key={d.value} value={d.value} disabled={d.soldOut}>
                  {d.label}
                  {d.soldOut ? " — sold out" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={add} className={buttonClass(added ? "dark" : "primary", compact ? "sm" : "md")} aria-live="polite">
          {added ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          {added ? labels.added : labels.add}
          {!compact && <span className="opacity-80">· {rs(price)}</span>}
        </button>
        {added && (
          <Link href="/checkout" className="text-sm font-semibold text-sindoor underline underline-offset-2">
            {labels.checkout}
          </Link>
        )}
      </div>
    </div>
  );
}
