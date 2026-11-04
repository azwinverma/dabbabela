"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { movementAction } from "./actions";

const HELP: Record<string, string> = {
  RECEIPT: "Goods in without a purchase order (e.g. market run). Adds stock.",
  USAGE: "Manual usage outside a production batch. Deducts stock.",
  WASTE: "Spoiled, dropped, expired. Deducts stock — say why.",
  RETURN: "Sent back to a supplier. Deducts stock — say why.",
  ADJUSTMENT: "Stock-count correction: type +5 or −2. Say why.",
};

export function MovementForm({ kitchenId, ingredients, today, fixedIngredient }: { kitchenId: string; ingredients: { id: string; name: string; unit: string }[]; today: string; fixedIngredient?: string }) {
  const [type, setType] = useState("RECEIPT");
  return (
    <ActionForm action={movementAction} className="space-y-3" resetOnSuccess>
      <input type="hidden" name="kitchenId" value={kitchenId} />
      {fixedIngredient ? (
        <input type="hidden" name="ingredientId" value={fixedIngredient} />
      ) : (
        <select name="ingredientId" className="field" required aria-label="Ingredient">
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
      <input name="quantity" inputMode="decimal" required placeholder={type === "ADJUSTMENT" ? "e.g. -2.5" : "Quantity"} className="field" />
      {type === "RECEIPT" && (
        <div className="grid grid-cols-2 gap-2">
          <input name="unitCost" inputMode="decimal" placeholder="Unit cost (Rs)" className="field" />
          <input name="expiresOn" type="date" min={today} className="field" aria-label="Expiry" />
        </div>
      )}
      <input name="note" placeholder={type === "RECEIPT" || type === "USAGE" ? "Note (optional)" : "Reason (required)"} required={!["RECEIPT", "USAGE"].includes(type)} className="field" />
      <SubmitButton className="w-full" variant="dark">Record</SubmitButton>
    </ActionForm>
  );
}
