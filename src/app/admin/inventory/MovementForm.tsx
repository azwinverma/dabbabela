"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { movementAction } from "./actions";

const HELP: Record<string, string> = {
  RECEIPT: "Goods in without a purchase order (e.g. market run). Opens a lot with this cost and expiry.",
  USAGE: "Manual usage outside a production batch. Takes the earliest-expiring lot first.",
  WASTE: "Spoiled, dropped, expired. Deducts stock — say why.",
  RETURN: "Sent back to a supplier. Deducts stock — say why.",
  ADJUSTMENT: "Stock-count correction: type +5 or −2. Say why.",
};

type Ing = { id: string; name: string; unit: string; purchaseUnit?: string | null };

export function MovementForm({ kitchenId, ingredients, today, fixedIngredient, locations = [] }: { kitchenId: string; ingredients: Ing[]; today: string; fixedIngredient?: Ing; locations?: { id: string; name: string }[] }) {
  const [type, setType] = useState("RECEIPT");
  const [ingId, setIngId] = useState(fixedIngredient?.id ?? "");
  const ing = fixedIngredient ?? ingredients.find((i) => i.id === ingId);
  const units = ing ? [...new Set([ing.unit, ...(ing.purchaseUnit ? [ing.purchaseUnit] : []), ...(ing.unit === "KG" ? ["G"] : ing.unit === "L" ? ["ML"] : [])])] : [];
  return (
    <ActionForm action={movementAction} className="space-y-3" resetOnSuccess>
      <input type="hidden" name="kitchenId" value={kitchenId} />
      {fixedIngredient ? (
        <input type="hidden" name="ingredientId" value={fixedIngredient.id} />
      ) : (
        <select name="ingredientId" className="field" required aria-label="Ingredient" value={ingId} onChange={(e) => setIngId(e.target.value)}>
          <option value="">Ingredient…</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.unit.toLowerCase()})
            </option>
          ))}
        </select>
      )}
      <select name="type" className="field" value={type} onChange={(e) => setType(e.target.value)} aria-label="Movement type">
        {Object.keys(HELP).map((t) => (
          <option key={t} value={t}>
            {t.charAt(0) + t.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
      <p className="text-xs text-ink-mute">{HELP[type]}</p>
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <input name="quantity" inputMode="decimal" required placeholder={type === "ADJUSTMENT" ? "e.g. -2.5" : "Quantity"} className="field" />
        <select name="unit" className="field" aria-label="Unit" key={ing?.id ?? "none"} defaultValue={ing?.unit ?? ""}>
          {units.map((u) => (
            <option key={u} value={u}>
              {u === "PACK" ? "pack/sack" : u.toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      {type === "RECEIPT" && (
        <div className="grid grid-cols-2 gap-2">
          <input name="unitCost" inputMode="decimal" placeholder="Rs per unit chosen" className="field" />
          <input name="expiresOn" type="date" min={today} className="field" aria-label="Expiry" />
          {locations.length > 0 && (
            <select name="locationId" className="field col-span-2" aria-label="Store in">
              <option value="">No location</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <input name="note" placeholder={type === "RECEIPT" || type === "USAGE" ? "Note (optional)" : "Reason (required)"} required={!["RECEIPT", "USAGE"].includes(type)} className="field" />
      <SubmitButton className="w-full" variant="dark">Record</SubmitButton>
    </ActionForm>
  );
}
