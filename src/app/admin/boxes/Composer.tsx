"use client";

import { useMemo, useState } from "react";
import { rs } from "@/lib/money";

type Dish = { id: string; name: string; category: string; cost: number; diet: string; allergens: string[]; isActive: boolean };
type Row = { menuItemId: string; quantity: number };

const CAT_ORDER = ["BASE", "MAIN", "PROTEIN", "VEGETABLE", "SIDE", "ACHAR", "ADDON"];

/** Pick dishes + quantities + order for a dabba; live cost & allergen preview. Saves via hidden JSON field. */
export function Composer({ dishes, initial, price }: { dishes: Dish[]; initial: Row[]; price: number }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [pick, setPick] = useState("");
  const byId = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes]);
  const cost = rows.reduce((a, r) => a + (byId.get(r.menuItemId)?.cost ?? 0) * r.quantity, 0);
  const allergens = [...new Set(rows.flatMap((r) => byId.get(r.menuItemId)?.allergens ?? []))];
  const nonVeg = rows.map((r) => byId.get(r.menuItemId)).filter((d) => d && !["VEG", "VEGAN"].includes(d.diet));
  const move = (i: number, by: number) =>
    setRows((rs0) => {
      const j = i + by;
      if (j < 0 || j >= rs0.length) return rs0;
      const c = [...rs0];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  const available = CAT_ORDER.map((c) => ({ c, list: dishes.filter((d) => d.category === c && d.isActive && !rows.some((r) => r.menuItemId === d.id)) })).filter((g) => g.list.length);

  return (
    <div>
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      <ul className="divide-y divide-ink-line/50 rounded-lg border border-ink-line/70">
        {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-mute">No dishes yet — add from the list below.</li>}
        {rows.map((r, i) => {
          const d = byId.get(r.menuItemId);
          return (
            <li key={r.menuItemId} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex flex-col">
                <button type="button" onClick={() => move(i, -1)} className="text-xs leading-none text-ink-mute hover:text-ink" aria-label={`Move ${d?.name} up`}>
                  ▲
                </button>
                <button type="button" onClick={() => move(i, 1)} className="text-xs leading-none text-ink-mute hover:text-ink" aria-label={`Move ${d?.name} down`}>
                  ▼
                </button>
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{d?.name ?? "Unknown dish"}</span>
                <span className="ml-2 text-xs text-ink-mute">
                  {d?.category.toLowerCase()} · {rs(d?.cost ?? 0)}
                  {d && !d.isActive && " · archived"}
                </span>
              </span>
              <label className="flex items-center gap-1 text-xs">
                ×
                <input type="number" min={1} max={5} value={r.quantity} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, quantity: Math.max(1, Math.min(5, parseInt(e.target.value || "1", 10))) } : y)))} className="field w-16 py-1" aria-label={`Quantity of ${d?.name}`} />
              </label>
              <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="rounded px-2 py-1 text-xs font-semibold text-sindoor hover:bg-sindoor-light">
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="field" aria-label="Dish to add">
          <option value="">Add a dish…</option>
          {available.map((g) => (
            <optgroup key={g.c} label={g.c.toLowerCase()}>
              {g.list.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          disabled={!pick}
          onClick={() => {
            setRows((x) => [...x, { menuItemId: pick, quantity: 1 }]);
            setPick("");
          }}
          className="rounded-lg border border-ink bg-ink px-3 text-sm font-semibold text-paper disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <div className="mt-3 grid gap-2 rounded-lg bg-paper/60 p-3 text-xs sm:grid-cols-3">
        <p>
          Food cost <b className="tabular-nums">{rs(cost)}</b>
          {price > 0 && <span className="text-ink-mute"> · {Math.round((cost / price) * 100)}% of price</span>}
        </p>
        <p>Diet: {nonVeg.length ? <b className="text-sindoor">{[...new Set(nonVeg.map((d) => d!.diet.toLowerCase()))].join(", ")}</b> : <b className="text-saag">vegetarian</b>}</p>
        <p>Allergens: {allergens.length ? <b>{allergens.join(", ").toLowerCase()}</b> : "none listed"}</p>
      </div>
      <p className="mt-1 text-[11px] text-ink-mute">Packaging cost is added on save. Saved figures come from current recipes.</p>
    </div>
  );
}
