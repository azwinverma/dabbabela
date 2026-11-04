"use client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { creditNoteAction, generateInvoiceAction, issueInvoiceAction, recordPaymentAction, voidInvoiceAction } from "./actions";

export function GenerateForm({ companies, from, to }: { companies: { id: string; name: string }[]; from: string; to: string }) {
  return (
    <ActionForm action={generateInvoiceAction} className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-semibold text-ink-soft">
        Company
        <select name="companyId" className="field mt-1 w-56" required>
          <option value="">Choose…</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-semibold text-ink-soft">
        From
        <input type="date" name="periodStart" defaultValue={from} className="field mt-1 w-40" required />
      </label>
      <label className="text-xs font-semibold text-ink-soft">
        To
        <input type="date" name="periodEnd" defaultValue={to} className="field mt-1 w-40" required />
      </label>
      <label className="text-xs font-semibold text-ink-soft">
        Lines
        <select name="grouping" className="field mt-1 w-40" defaultValue="ORDER">
          <option value="ORDER">One per order</option>
          <option value="DAY">One per day</option>
        </select>
      </label>
      <SubmitButton size="sm" variant="dark">
        Create draft
      </SubmitButton>
    </ActionForm>
  );
}

export function IssueButton({ id }: { id: string }) {
  return <ConfirmAction action={issueInvoiceAction.bind(null, id)} label="Issue invoice" variant="primary" confirm="Issue this invoice? Its number and lines are then final." />;
}

export function PaymentForm({ id }: { id: string }) {
  return (
    <ActionForm action={recordPaymentAction} className="flex flex-wrap items-start gap-2" resetOnSuccess>
      <input type="hidden" name="id" value={id} />
      <input name="amount" inputMode="decimal" placeholder="Amount received (Rs)" className="field h-9 w-44 py-1" required aria-label="Amount" />
      <input name="reference" placeholder="Bank / cheque ref" className="field h-9 w-40 py-1" required aria-label="Reference" />
      <SubmitButton size="sm" variant="dark" pendingText="…">
        Record payment
      </SubmitButton>
    </ActionForm>
  );
}

export function VoidForm({ id }: { id: string }) {
  return (
    <ActionForm action={voidInvoiceAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="reason" placeholder="Why void?" className="field h-9 w-48 py-1" required aria-label="Void reason" />
      <SubmitButton size="sm" variant="danger" pendingText="…" confirm="Void this invoice? Its meals become billable again.">
        Void
      </SubmitButton>
    </ActionForm>
  );
}

export function CreditNoteForm({ id }: { id: string }) {
  return (
    <ActionForm action={creditNoteAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="amount" inputMode="decimal" placeholder="Amount (Rs)" className="field h-9 w-32 py-1" required aria-label="Credit amount" />
      <input name="reason" placeholder="Reason" className="field h-9 w-48 py-1" required aria-label="Credit reason" />
      <SubmitButton size="sm" variant="outline" pendingText="…">
        Issue credit note
      </SubmitButton>
    </ActionForm>
  );
}
