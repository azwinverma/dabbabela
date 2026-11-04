import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Checkbox } from "@/components/ui/Fields";
import { rupeesInput } from "@/lib/money";
import type { Ingredient } from "@prisma/client";
import { saveIngredientAction } from "./actions";

export function IngredientForm({ ingredient, suppliers, allergens }: { ingredient?: Ingredient | null; suppliers: { id: string; name: string }[]; allergens: { code: string; name: string }[] }) {
  const i = ingredient;
  return (
    <ActionForm action={saveIngredientAction.bind(null, i?.id ?? null)} className="grid gap-3 sm:grid-cols-2">
      <Input name="name" label="Name" defaultValue={i?.name} required />
      <Input name="nameNe" label="Nepali name" defaultValue={i?.nameNe ?? ""} lang="ne" />
      <Select name="unit" label="Unit" defaultValue={i?.unit ?? "KG"} options={["KG", "G", "L", "ML", "PC", "PACK"].map((u) => ({ value: u, label: u.toLowerCase() }))} />
      <Input name="cost" label="Cost per unit (Rs)" inputMode="decimal" defaultValue={i ? rupeesInput(i.costPerUnit) : ""} required hint="Latest purchase price; receiving a PO updates it." />
      <Input name="safety" label="Safety stock" inputMode="decimal" defaultValue={i?.safetyStock ?? 0} hint="Alert when on hand drops below." />
      <Input name="reorder" label="Reorder quantity" inputMode="decimal" defaultValue={i?.reorderQty ?? 0} hint="Purchase suggestions round up to this." />
      <Input name="shelf" label="Shelf life (days)" inputMode="numeric" defaultValue={i?.shelfLifeDays ?? ""} />
      <Select name="supplierId" label="Default supplier" defaultValue={i?.supplierId ?? ""} placeholder="None" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
      <fieldset className="sm:col-span-2">
        <legend className="label">Allergens in this ingredient</legend>
        <div className="flex flex-wrap gap-3">
          {allergens.map((a) => (
            <Checkbox key={a.code} name="allergens" value={a.code} label={a.name} defaultChecked={i?.allergenCodes.includes(a.code)} />
          ))}
        </div>
      </fieldset>
      {i && <Checkbox name="isActive" label="Active" defaultChecked={i.isActive} className="sm:col-span-2" />}
      <div className="sm:col-span-2">
        <SubmitButton>{i ? "Save ingredient" : "Add ingredient"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
