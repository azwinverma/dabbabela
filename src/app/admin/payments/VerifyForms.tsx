"use client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { verifyPaymentAction, rejectPaymentAction } from "./actions";

export function VerifyForms({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm action={verifyPaymentAction} className="flex items-start gap-2">
        <input type="hidden" name="id" value={id} />
        <input name="reference" placeholder="Bank txn ref" className="field h-9 w-36 py-1" aria-label="Bank transaction reference" required />
        <SubmitButton size="sm" variant="dark" pendingText="…">
          Verify
        </SubmitButton>
      </ActionForm>
      <ActionForm action={rejectPaymentAction} className="flex items-start gap-2">
        <input type="hidden" name="id" value={id} />
        <input name="reason" placeholder="Why not received" className="field h-9 w-40 py-1" aria-label="Rejection reason" required />
        <SubmitButton size="sm" variant="danger" pendingText="…">
          Reject
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
