"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Fields";
import { leadAction } from "@/lib/actions/public";

export function LeadForm() {
  return (
    <ActionForm action={leadAction} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
      {(s) => (
        <>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <Input label="Organisation" name="companyName" required autoComplete="organization" error={s.errors?.companyName} hint="Office, shop, school, project site…" />
          <Input label="Your name" name="contactName" required autoComplete="name" error={s.errors?.contactName} />
          <Input label="Email" name="email" type="email" required autoComplete="email" error={s.errors?.email} />
          <Input label="Phone" name="phone" type="tel" required autoComplete="tel" placeholder="98XXXXXXXX" error={s.errors?.phone} />
          <Input label="Location" name="location" placeholder="e.g. Kamaladi, Kathmandu" />
          <Input label="People who'd eat" name="headcount" type="number" min={1} max={5000} placeholder="25" />
          <Select
            label="Days a week"
            name="mealsPerWeek"
            placeholder="Choose"
            options={[3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} days` }))}
          />
          <Select
            label="Who would pay"
            name="billing"
            placeholder="Not sure yet"
            options={[
              { value: "Company pays", label: "Company pays" },
              { value: "Staff pay", label: "Staff pay themselves" },
              { value: "Split", label: "Split between both" },
            ]}
          />
          <Textarea label="Anything we should know" name="message" rows={3} className="sm:col-span-2" placeholder="Dietary needs, delivery point, start date…" />
          <Checkbox name="trial" label="We'd like a free tasting for a few people first" className="sm:col-span-2" />
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Sending…" size="lg">
              Send enquiry
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
