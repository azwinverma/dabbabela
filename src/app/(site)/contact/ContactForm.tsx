"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Textarea } from "@/components/ui/Fields";
import { contactAction } from "@/lib/actions/public";

export function ContactForm({ defaults }: { defaults?: { name?: string; email?: string; phone?: string } }) {
  return (
    <ActionForm action={contactAction} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
      {(s) => (
        <>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <Input label="Your name" name="name" required autoComplete="name" defaultValue={defaults?.name} error={s.errors?.name} />
          <Input label="Email" name="email" type="email" required autoComplete="email" defaultValue={defaults?.email} error={s.errors?.email} />
          <Input label="Phone (optional)" name="phone" type="tel" autoComplete="tel" defaultValue={defaults?.phone} error={s.errors?.phone} />
          <Select
            label="About"
            name="category"
            options={[
              { value: "GENERAL", label: "General question" },
              { value: "ORDER", label: "An order" },
              { value: "DELIVERY", label: "Delivery" },
              { value: "FOOD", label: "Food or allergy" },
              { value: "PAYMENT", label: "Payment" },
              { value: "CORPORATE", label: "Lunch for a team" },
            ]}
          />
          <Input label="Subject" name="subject" className="sm:col-span-2" />
          <Textarea label="Message" name="message" required rows={5} className="sm:col-span-2" error={s.errors?.message} />
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Sending…">Send message</SubmitButton>
            <p className="mt-2 text-xs text-ink-mute">For an existing order, include the order number — or use Help in your account.</p>
          </div>
        </>
      )}
    </ActionForm>
  );
}
