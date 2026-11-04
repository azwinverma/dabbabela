"use client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { approveRefundAction, processRefundAction, rejectRefundAction, adjustCreditAction } from "./actions";

export function ApproveButton({ id }: { id: string }) {
  return <ConfirmAction action={approveRefundAction.bind(null, id)} label="Approve" variant="dark" confirm="Approve this refund?" />;
}

export function RejectForm({ id }: { id: string }) {
  return (
    <ActionForm action={rejectRefundAction} className="flex gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="reason" placeholder="Reason" className="field h-9 w-36 py-1" required aria-label="Reject reason" />
      <SubmitButton size="sm" variant="danger" pendingText="…">
        Reject
      </SubmitButton>
    </ActionForm>
  );
}

export function ProcessForm({ id, wallet }: { id: string; wallet: boolean }) {
  return (
    <ActionForm action={processRefundAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={id} />
      {!wallet && (
        <>
          <input name="providerRef" placeholder="Gateway / bank txn ref" className="field h-9 w-44 py-1" aria-label="Transaction reference" />
          <input type="file" name="proof" accept="image/jpeg,image/png,image/webp,application/pdf" className="max-w-48 text-xs" aria-label="Receipt" />
        </>
      )}
      <SubmitButton size="sm" variant="dark" pendingText="…">
        {wallet ? "Post credit" : "Mark processed"}
      </SubmitButton>
    </ActionForm>
  );
}

export function AdjustForm({ userId }: { userId: string }) {
  return (
    <ActionForm action={adjustCreditAction} className="flex flex-wrap items-start gap-2" resetOnSuccess>
      <input type="hidden" name="userId" value={userId} />
      <input name="amount" placeholder="+100 or -50" inputMode="decimal" className="field h-9 w-32 py-1" required aria-label="Amount" />
      <input name="note" placeholder="Reason (required)" className="field h-9 w-56 py-1" required aria-label="Reason" />
      <SubmitButton size="sm" variant="dark" pendingText="…">
        Adjust credit
      </SubmitButton>
    </ActionForm>
  );
}
