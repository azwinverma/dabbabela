"use client";
import type { LeadStatus } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Textarea } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { LEAD_STATUS } from "@/lib/labels";
import { saveLeadAction, convertLeadAction, setLeadStatusAction } from "./actions";

export function LeadForm({ lead }: { lead: { id: string; status: LeadStatus; quotePerMeal: string; quoteValidUntil: string; nextFollowUp: string } }) {
  return (
    <ActionForm action={saveLeadAction} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="id" value={lead.id} />
      <Select name="status" label="Stage" defaultValue={lead.status} options={Object.entries(LEAD_STATUS).map(([v, x]) => ({ value: v, label: x.label }))} />
      <Input name="nextFollowUp" type="date" label="Next follow-up" defaultValue={lead.nextFollowUp} />
      <Input name="quotePerMeal" label="Quoted Rs per meal" defaultValue={lead.quotePerMeal} />
      <Input name="quoteValidUntil" type="date" label="Quote valid until" defaultValue={lead.quoteValidUntil} />
      <Textarea name="addNote" label="Add a note" rows={2} className="md:col-span-2" placeholder="Called HR — tasting booked for Tuesday" />
      <div className="md:col-span-2">
        <SubmitButton size="sm">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ConvertButton({ id }: { id: string }) {
  return <ConfirmAction action={convertLeadAction.bind(null, id)} label="Convert to company" variant="dark" confirm="Create a company account from this lead?" />;
}

export function MoveButton({ id, to, label }: { id: string; to: LeadStatus; label: string }) {
  return <ConfirmAction action={setLeadStatusAction.bind(null, id, to)} label={label} variant="ghost" size="sm" className="h-7 px-2 text-xs" />;
}
