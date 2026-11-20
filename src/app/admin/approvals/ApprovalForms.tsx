"use client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { approveApprovalAction, cancelApprovalAction, rejectApprovalAction, retryApprovalAction } from "./actions";

export function DecisionForms({ id }: { id: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ActionForm action={approveApprovalAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <label className="block text-sm font-semibold" htmlFor="approve-note">
          Note (optional)
        </label>
        <textarea id="approve-note" name="note" rows={2} maxLength={500} className="field w-full" />
        <SubmitButton variant="dark" pendingText="Approving…" confirm="Approve and carry this out now?">
          Approve &amp; execute
        </SubmitButton>
      </ActionForm>
      <ActionForm action={rejectApprovalAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <label className="block text-sm font-semibold" htmlFor="reject-note">
          Why reject? (required)
        </label>
        <textarea id="reject-note" name="note" rows={2} minLength={3} maxLength={500} required className="field w-full" />
        <SubmitButton variant="danger" pendingText="Rejecting…">
          Reject
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

export function RetryForm({ id }: { id: string }) {
  return (
    <ActionForm action={retryApprovalAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="dark" size="sm" pendingText="Retrying…" confirm="Try carrying this out again?">
        Retry execution
      </SubmitButton>
    </ActionForm>
  );
}

export function CancelForm({ id }: { id: string }) {
  return (
    <ActionForm action={cancelApprovalAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="outline" size="sm" pendingText="…" confirm="Withdraw this request?">
        Withdraw request
      </SubmitButton>
    </ActionForm>
  );
}
