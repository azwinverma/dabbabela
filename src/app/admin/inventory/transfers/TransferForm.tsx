"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { transferAction } from "../actions";

type Ing = { id: string; name: string; unit: string; purchaseUnit: string | null; onHand: number };

export function TransferForm({ fromKitchen, kitchens, ingredients, locations }: { fromKitchen: { id: string; name: string }; kitchens: { id: string; name: string }[]; ingredients: Ing[]; locations: { id: string; name: string; kitchenId: string }[] }) {
  const [to, setTo] = useState(kitchens[0]?.id ?? "");
  const [lines, setLines] = useState<{ id: string; ing: string }[]>([{ id: "t0", ing: "" }]);
  const destLocations = locations.filter((l) => l.kitchenId === to);
  if (!kitchens.length) return <p className="text-sm text-ink-mute">You need a second kitchen in your scope to transfer stock.</p>;
  return (
    <ActionForm action={transferAction} className="space-y-3" resetOnSuccess>
      <input type="hidden" name="fromKitchenId" value={fromKitchen.id} />
      <p className="text-sm">From <strong>{fromKitchen.name}</strong> to</p>
      <div className="grid grid-cols-2 gap-2">
        <select name="toKitchenId" value={to} onChange={(e) => setTo(e.target.value)} className="field" aria-label="Destination kitchen">
          {kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <select name="toLocationId" className="field" aria-label="Destination location" key={to}>
          <option value="">No location</option>
          {destLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => {
          const ing = ingredients.find((x) => x.id === l.ing);
          const units = ing ? [...new Set([ing.unit, ...(ing.purchaseUnit ? [ing.purchaseUnit] : [])])] : [];
          return (
            <div key={l.id} className="grid grid-cols-[1fr_64px_72px_auto] gap-1.5">
              <select name="line_ingredient" value={l.ing} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ing: e.target.value } : x)))} className="field py-1.5" aria-label="Ingredient">
                <option value="">Ingredient…</option>
                {ingredients.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.onHand} {x.unit.toLowerCase()})</option>)}
              </select>
              <input name="line_qty" inputMode="decimal" placeholder="qty" className="field py-1.5" aria-label="Quantity" />
              <select name="line_unit" key={l.ing} defaultValue={ing?.unit} className="field px-1 py-1.5" aria-label="Unit">
                {units.map((u) => <option key={u} value={u}>{u === "PACK" ? "sack" : u.toLowerCase()}</option>)}
              </select>
              <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="px-2 text-ink-mute hover:text-sindoor" aria-label="Remove line">×</button>
            </div>
          );
        })}
        <button type="button" onClick={() => setLines((ls) => [...ls, { id: `t${Date.now()}`, ing: "" }])} className="text-sm font-semibold text-akash">+ Add line</button>
      </div>
      <input name="note" placeholder="Why (goes in the audit log)" className="field" />
      <SubmitButton variant="dark" confirm="Move this stock now? Both kitchens update immediately.">Transfer stock</SubmitButton>
    </ActionForm>
  );
}
