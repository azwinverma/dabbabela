"use client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { saveSpendAction } from "./actions";

export function SpendForm({ ym }: { ym: string }) {
  return (
    <ActionForm action={saveSpendAction} className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-semibold text-ink-soft">
        Month
        <input type="month" name="ym" defaultValue={ym} className="field mt-1 w-40" required />
      </label>
      <label className="text-xs font-semibold text-ink-soft">
        Spend (Rs)
        <input name="amount" inputMode="decimal" placeholder="25000" className="field mt-1 w-36" required />
      </label>
      <SubmitButton size="sm" variant="dark">
        Save
      </SubmitButton>
    </ActionForm>
  );
}
