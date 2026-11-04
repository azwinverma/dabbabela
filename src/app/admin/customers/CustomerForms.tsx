"use client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { setActiveAction, saveNoteAction, openPrivacyRequestAction } from "./actions";

export function ActiveForm({ id, active }: { id: string; active: boolean }) {
  return (
    <ActionForm action={setActiveAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <input name="reason" placeholder="Reason" className="field h-9 w-48 py-1" required aria-label="Reason" />
      <SubmitButton size="sm" variant={active ? "danger" : "dark"} pendingText="…">
        {active ? "Deactivate" : "Reactivate"}
      </SubmitButton>
    </ActionForm>
  );
}

export function NoteForm({ id, note }: { id: string; note: string }) {
  return (
    <ActionForm action={saveNoteAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <textarea name="note" defaultValue={note} rows={3} className="field" placeholder="Staff-only note (never shown to the customer)" aria-label="Internal note" />
      <SubmitButton size="sm" variant="outline">
        Save note
      </SubmitButton>
    </ActionForm>
  );
}

export function PrivacyRequestForm({ id }: { id: string }) {
  return (
    <ActionForm action={openPrivacyRequestAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <select name="type" className="field h-9 w-40 py-1" aria-label="Request type">
        <option value="EXPORT">Data export</option>
        <option value="DELETE">Deletion</option>
      </select>
      <SubmitButton size="sm" variant="outline" pendingText="…">
        Log request
      </SubmitButton>
    </ActionForm>
  );
}
