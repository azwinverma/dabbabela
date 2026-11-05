"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { createPOAction } from "../actions";

type Ing = { id: string; name: string; unit: string; costPerUnit: number; supplierId: string | null; purchaseUnit: string | null; purchaseFactor: number };

export function NewPOForm({ kitchenId, suppliers, ingredients, today }: { kitchenId: string; suppliers: { id: string; name: string }[]; ingredients: Ing[]; today: string }) {
  const [supplier, setSupplier] = useState(suppliers[0]?.id ?? "");
  const [lines, setLines] = useState<{ id: string; ing: string; qty: string; cost: string; unit: string }[]>([{ id: "l0", ing: "", qty: "", cost: "", unit: "" }]);
  const list = [...ingredients].sort((a, b) => Number(b.supplierId === supplier) - Number(a.supplierId === supplier) || a.name.localeCompare(b.name));
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <ActionForm action={createPOAction} className="space-y-3">
      <input type="hidden" name="kitchenId" value={kitchenId} />
      <div className="grid grid-cols-2 gap-2">
        <select name="supplierId" value={supplier} onChange={(e) => setSupplier(e.target.value)} className="field" required aria-label="Supplier">
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" name="expectedOn" min={today} className="field" aria-label="Expected delivery" />
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => {
          const ing = ingredients.find((x) => x.id === l.ing);
          return (
            <div key={l.id} className="grid grid-cols-[1fr_60px_76px_70px_auto] gap-1.5">
              <select name="line_ingredient" value={l.ing} onChange={(e) => { const x = ingredients.find((y) => y.id === e.target.value); const unit = x?.purchaseUnit ?? x?.unit ?? ""; const per = x ? (x.purchaseUnit ? x.costPerUnit * x.purchaseFactor : x.costPerUnit) : 0; set(i, { ing: e.target.value, unit, cost: x ? String(Math.round(per) / 100) : l.cost }); }} className="field py-1.5" aria-label="Ingredient">
                <option value="">Ingredient…</option>
                {list.map((x) => <option key={x.id} value={x.id}>{x.name}{x.supplierId === supplier ? "" : " ·"}</option>)}
              </select>
              <input name="line_qty" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} placeholder="qty" inputMode="decimal" className="field py-1.5" aria-label="Quantity" />
              <select name="line_unit" value={l.unit} onChange={(e) => { const u = e.target.value; const per = ing ? (ing.purchaseUnit && u === ing.purchaseUnit ? ing.costPerUnit * ing.purchaseFactor : ing.costPerUnit) : 0; set(i, { unit: u, cost: ing ? String(Math.round(per) / 100) : l.cost }); }} className="field px-1 py-1.5" aria-label="Unit">
                {ing ? [...new Set([ing.purchaseUnit, ing.unit].filter(Boolean) as string[])].map((u) => <option key={u} value={u}>{u === "PACK" ? "sack" : u.toLowerCase()}</option>) : <option value="">unit</option>}
              </select>
              <input name="line_cost" value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} placeholder="Rs/unit" title="Price per unit chosen" inputMode="decimal" className="field py-1.5" aria-label="Unit cost" />
              <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="px-2 text-ink-mute hover:text-sindoor" aria-label="Remove line">×</button>
            </div>
          );
        })}
        <button type="button" onClick={() => setLines((ls) => [...ls, { id: `l${Date.now()}`, ing: "", qty: "", cost: "", unit: "" }])} className="text-sm font-semibold text-akash">+ Add line</button>
      </div>
      <input name="notes" placeholder="Notes for the supplier" className="field" />
      <SubmitButton variant="dark">Create draft</SubmitButton>
    </ActionForm>
  );
}
