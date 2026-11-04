"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rs } from "@/lib/money";
import { buttonClass } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/ActionForm";
import type { ActionResult } from "@/lib/action";
import type { RecipeLineInput } from "./actions";

type Ing = { id: string; name: string; unit: string; costPerUnit: number; allergenCodes: string[] };

export function RecipeEditor({
  ingredients,
  initial,
  save,
  builderPrice,
}: {
  ingredients: Ing[];
  initial: { yieldPortions: number; method: string; notes: string; lines: RecipeLineInput[] };
  save: (input: { yieldPortions: number; method: string; notes: string; lines: RecipeLineInput[] }) => Promise<ActionResult>;
  builderPrice: number;
}) {
  const [lines, setLines] = useState<RecipeLineInput[]>(initial.lines.length ? initial.lines : [{ ingredientId: "", quantity: 0, wastePct: 0 }]);
  const [yieldPortions, setYield] = useState(initial.yieldPortions || 10);
  const [method, setMethod] = useState(initial.method);
  const [notes, setNotes] = useState(initial.notes);
  const [res, setRes] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const lineCost = (l: RecipeLineInput) => {
    const ing = byId.get(l.ingredientId);
    if (!ing || !(l.quantity > 0)) return 0;
    return (ing.costPerUnit * l.quantity) / Math.max(0.05, 1 - Math.min(90, l.wastePct || 0) / 100);
  };
  const batch = lines.reduce((a, l) => a + lineCost(l), 0);
  const perPortion = Math.round(batch / Math.max(1, yieldPortions));
  const allergens = [...new Set(lines.flatMap((l) => byId.get(l.ingredientId)?.allergenCodes ?? []))];
  const set = (i: number, patch: Partial<RecipeLineInput>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="w-36">
          <span className="label">Yield (portions)</span>
          <input type="number" min={1} value={yieldPortions} onChange={(e) => setYield(Math.max(1, parseInt(e.target.value || "1", 10)))} className="field" />
        </label>
        <p className="pb-2 text-sm text-ink-mute">Quantities below are for the whole batch, in each ingredient’s stock unit.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-mute">
              <th className="pb-1.5">Ingredient</th>
              <th className="w-28 pb-1.5">Quantity</th>
              <th className="w-24 pb-1.5">Waste %</th>
              <th className="w-28 pb-1.5 text-right">Line cost</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const ing = byId.get(l.ingredientId);
              return (
                <tr key={i} className="border-t border-ink-line/40">
                  <td className="py-1.5 pr-2">
                    <select value={l.ingredientId} onChange={(e) => set(i, { ingredientId: e.target.value })} className="field" aria-label={`Ingredient ${i + 1}`}>
                      <option value="">Choose…</option>
                      {ingredients.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.unit.toLowerCase()} · {rs(g.costPerUnit)})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-1">
                      <input type="number" step="0.001" min={0} value={l.quantity || ""} onChange={(e) => set(i, { quantity: parseFloat(e.target.value) || 0 })} className="field" aria-label={`Quantity ${i + 1}`} />
                      <span className="text-xs text-ink-mute">{ing?.unit.toLowerCase()}</span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" min={0} max={90} value={l.wastePct || ""} onChange={(e) => set(i, { wastePct: parseInt(e.target.value || "0", 10) })} className="field" aria-label={`Waste ${i + 1}`} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{rs(Math.round(lineCost(l)))}</td>
                  <td className="py-1.5 text-right">
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="rounded px-2 py-1 text-xs font-semibold text-sindoor hover:bg-sindoor-light" aria-label={`Remove line ${i + 1}`}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setLines((ls) => [...ls, { ingredientId: "", quantity: 0, wastePct: 0 }])} className="mt-2 rounded-md border border-ink-line bg-white px-3 py-1.5 text-xs font-semibold hover:border-ink">
        + Add ingredient
      </button>
      <div className="mt-4 grid gap-3 rounded-xl bg-paper/60 p-3 text-sm sm:grid-cols-4">
        <p>
          <span className="block text-xs text-ink-mute">Batch cost</span>
          <span className="font-semibold tabular-nums">{rs(Math.round(batch))}</span>
        </p>
        <p>
          <span className="block text-xs text-ink-mute">Cost per portion</span>
          <span className="font-semibold tabular-nums">{rs(perPortion)}</span>
        </p>
        <p>
          <span className="block text-xs text-ink-mute">Food cost vs builder price</span>
          <span className="font-semibold tabular-nums">{builderPrice ? `${Math.round((perPortion / builderPrice) * 100)}%` : "—"}</span>
        </p>
        <p>
          <span className="block text-xs text-ink-mute">Allergens from ingredients</span>
          <span className="font-semibold">{allergens.length ? allergens.join(", ").toLowerCase() : "none"}</span>
        </p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label>
          <span className="label">Method</span>
          <textarea rows={5} value={method} onChange={(e) => setMethod(e.target.value)} className="field" />
        </label>
        <label>
          <span className="label">Notes (what changed in this version)</span>
          <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} className="field" />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          className={buttonClass("primary", "sm")}
          onClick={() =>
            start(async () => {
              const r = await save({ yieldPortions, method, notes, lines: lines.filter((l) => l.ingredientId) });
              setRes(r);
              if (r.ok) router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save as new version"}
        </button>
        <span className="text-xs text-ink-mute">Older versions stay on record; orders keep the version they were cooked with.</span>
      </div>
      {res?.message && <FormMessage ok={res.ok} message={res.message} />}
    </div>
  );
}
