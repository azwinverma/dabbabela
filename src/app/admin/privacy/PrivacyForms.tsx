"use client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { completeRequestAction, rejectRequestAction } from "./actions";

export function CompleteForm({ id, type }: { id: string; type: string }) {
  return (
    <ActionForm action={completeRequestAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="type" value={type} />
      {type === "DELETE" && <input name="confirm" placeholder="Type DELETE" className="field h-9 w-32 py-1" required aria-label="Confirm deletion" />}
      <input name="note" placeholder="Note (optional)" className="field h-9 w-44 py-1" aria-label="Note" />
      <SubmitButton size="sm" variant={type === "DELETE" ? "danger" : "dark"} pendingText="…">
        {type === "DELETE" ? "Anonymise now" : "Mark sent"}
      </SubmitButton>
    </ActionForm>
  );
}

export function RejectForm({ id }: { id: string }) {
  return (
    <ActionForm action={rejectRequestAction} className="flex items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="note" placeholder="Why (e.g. identity not confirmed)" className="field h-9 w-56 py-1" required aria-label="Reason" />
      <SubmitButton size="sm" variant="outline" pendingText="…">
        Reject
      </SubmitButton>
    </ActionForm>
  );
}
