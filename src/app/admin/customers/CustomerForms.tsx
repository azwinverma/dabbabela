"use client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { ConfirmDialog } from "@/components/admin/Dialog";
import {
  setActiveAction,
  saveNoteAction,
  addNoteAction,
  openPrivacyRequestAction,
  updateCustomerAction,
  creditAction,
  decideCreditAction,
  commPrefsAction,
  processPrivacyAction,
} from "./actions";

const PREF_TOPIC_LABEL: Record<string, string> = { ORDER_UPDATES: "Order updates", PLAN_REMINDERS: "Plan reminders", MARKETING: "Offers & news" };
const PREF_CHANNEL_LABEL: Record<string, string> = { IN_APP: "In app", EMAIL: "Email", SMS: "SMS" };

export function ActiveForm({ id, active }: { id: string; active: boolean }) {
  return (
    <ActionForm action={setActiveAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <input name="reason" placeholder="Reason (audited)" className="field h-9 w-56 py-1" required minLength={3} aria-label="Reason" />
      <SubmitButton size="sm" variant={active ? "danger" : "dark"} pendingText="…">
        {active ? "Suspend" : "Reactivate"}
      </SubmitButton>
    </ActionForm>
  );
}

export function NoteForm({ id, note }: { id: string; note: string }) {
  return (
    <ActionForm action={saveNoteAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label className="block text-xs font-semibold text-ink-mute" htmlFor={`pin-${id}`}>
        Pinned note
      </label>
      <textarea id={`pin-${id}`} name="note" defaultValue={note} rows={2} className="field" placeholder="Staff-only, shown at the top (never to the customer)" />
      <SubmitButton size="sm" variant="outline">
        Save pinned note
      </SubmitButton>
    </ActionForm>
  );
}

export function TimelineNoteForm({ id }: { id: string }) {
  return (
    <ActionForm action={addNoteAction} className="space-y-2" resetOnSuccess>
      <input type="hidden" name="id" value={id} />
      <label className="block text-xs font-semibold text-ink-mute" htmlFor={`tn-${id}`}>
        Add a support note
      </label>
      <textarea id={`tn-${id}`} name="note" rows={2} maxLength={1000} required className="field" placeholder="What happened, what was agreed" />
      <SubmitButton size="sm" variant="dark">
        Add note
      </SubmitButton>
    </ActionForm>
  );
}

export type EditableProfile = {
  name: string;
  phone: string;
  locale: string;
  diet: string;
  spiceTolerance: number;
  allergies: string[];
  avoidOnionGarlic: boolean;
  dietaryNotes: string;
};

export function ProfileEditForm({ id, value, allergens, canEditPhone }: { id: string; value: EditableProfile; allergens: { code: string; name: string }[]; canEditPhone: boolean }) {
  return (
    <ActionForm action={updateCustomerAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={id} />
      <label className="text-xs font-semibold text-ink-soft">
        Name
        <input name="name" defaultValue={value.name} required minLength={2} maxLength={80} className="field mt-1" />
      </label>
      {canEditPhone && (
        <label className="text-xs font-semibold text-ink-soft">
          Mobile (re-verification needed after a change)
          <input name="phone" defaultValue={value.phone} inputMode="tel" className="field mt-1" />
        </label>
      )}
      <label className="text-xs font-semibold text-ink-soft">
        Language
        <select name="locale" defaultValue={value.locale} className="field mt-1">
          <option value="en">English</option>
          <option value="ne">Nepali</option>
        </select>
      </label>
      <label className="text-xs font-semibold text-ink-soft">
        Diet
        <select name="diet" defaultValue={value.diet} className="field mt-1">
          <option value="ANY">No restriction</option>
          <option value="VEG">Vegetarian</option>
          <option value="EGG_OK">Vegetarian + egg</option>
          <option value="VEGAN">Vegan</option>
        </select>
      </label>
      <label className="text-xs font-semibold text-ink-soft">
        Spice
        <select name="spiceTolerance" defaultValue={String(value.spiceTolerance)} className="field mt-1">
          {["None", "Mild", "Medium", "Hot", "Very hot"].map((l, i) => (
            <option key={l} value={i}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" name="avoidOnionGarlic" defaultChecked={value.avoidOnionGarlic} /> No onion / garlic
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="text-xs font-semibold text-ink-soft">Allergies (as the customer told us)</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {allergens.map((a) => (
            <label key={a.code} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="allergies" value={a.code} defaultChecked={value.allergies.includes(a.code)} /> {a.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="text-xs font-semibold text-ink-soft sm:col-span-2">
        Dietary notes
        <textarea name="dietaryNotes" defaultValue={value.dietaryNotes} rows={2} maxLength={500} className="field mt-1" />
      </label>
      <label className="text-xs font-semibold text-ink-soft sm:col-span-2">
        Why (optional, goes in the audit log)
        <input name="reason" maxLength={300} className="field mt-1" placeholder="e.g. customer called to update allergies" />
      </label>
      <div className="sm:col-span-2">
        <SubmitButton size="sm" variant="dark">
          Save changes
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CreditForm({ id, canApprove }: { id: string; canApprove: boolean }) {
  return (
    <ActionForm action={creditAction} className="flex flex-wrap items-start gap-2" resetOnSuccess>
      <input type="hidden" name="id" value={id} />
      <input name="amount" placeholder="Rs" inputMode="decimal" className="field h-9 w-24 py-1" required aria-label="Credit in rupees" />
      <input name="note" placeholder="Reason (required)" className="field h-9 w-56 py-1" required minLength={3} aria-label="Reason" />
      <SubmitButton size="sm" variant="dark" pendingText="…">
        {canApprove ? "Add credit" : "Request credit"}
      </SubmitButton>
    </ActionForm>
  );
}

export function CreditDecision({ id, requestId }: { id: string; requestId: string }) {
  return (
    <div className="flex gap-1">
      <ConfirmDialog action={decideCreditAction} fields={{ id, requestId, approve: "true" }} label="Approve" title="Approve this credit?" description="The amount goes into the customer's wallet now. You are recorded as the approver." confirmLabel="Approve" tone="primary" triggerVariant="dark" />
      <ConfirmDialog action={decideCreditAction} fields={{ id, requestId, approve: "false" }} label="Reject" title="Reject this credit request?" reasonLabel="Why" confirmLabel="Reject" />
    </div>
  );
}

export function CommPrefsForm({ id, prefs, topics, channels }: { id: string; prefs: Record<string, boolean>; topics: readonly string[]; channels: readonly string[] }) {
  return (
    <ActionForm action={commPrefsAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <table className="w-full text-sm">
        <caption className="sr-only">Communication preferences</caption>
        <thead>
          <tr className="text-left text-xs text-ink-mute">
            <th scope="col" className="pb-1 font-semibold">Topic</th>
            {channels.map((c) => (
              <th key={c} scope="col" className="pb-1 text-center font-semibold">
                {PREF_CHANNEL_LABEL[c] ?? c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topics.map((t) => (
            <tr key={t}>
              <th scope="row" className="py-1 text-left font-medium">
                {PREF_TOPIC_LABEL[t] ?? t}
              </th>
              {channels.map((c) => (
                <td key={c} className="text-center">
                  <input type="checkbox" name={`${t}:${c}`} defaultChecked={prefs[`${t}:${c}`]} aria-label={`${PREF_TOPIC_LABEL[t] ?? t} by ${PREF_CHANNEL_LABEL[c] ?? c}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <input name="reason" required minLength={3} maxLength={300} className="field h-9 py-1" placeholder="Who asked? e.g. customer by phone (required)" aria-label="Reason" />
      <SubmitButton size="sm" variant="outline">
        Save preferences
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

export function ProcessPrivacyButton({ id, requestId, type }: { id: string; requestId: string; type: string }) {
  if (type === "DELETE")
    return (
      <ConfirmDialog
        action={processPrivacyAction}
        fields={{ id, requestId }}
        label="Process deletion"
        title="Delete this customer's personal data?"
        description="Name, contact details, addresses, saved dabbas and notes are anonymised and every session is ended. Orders, payments, invoices and the credit ledger are kept for accounting. This can't be undone."
        requireText="DELETE"
        reasonLabel="Note for the record"
        confirmLabel="Anonymise"
      />
    );
  return <ConfirmDialog action={processPrivacyAction} fields={{ id, requestId }} label="Mark sent" title="Mark this export request done?" description="Send the customer their data export first (Download data above)." confirmLabel="Mark done" tone="primary" />;
}
