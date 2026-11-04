"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea } from "@/components/ui/Fields";
import { areaRequestAction } from "@/lib/actions/public";

export function AreaRequestForm({ area, title }: { area: string; title: string }) {
  return (
    <ActionForm action={areaRequestAction} resetOnSuccess className="space-y-3">
      {(s) => (
        <>
          <p className="font-display font-bold">{title}</p>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <Input name="area" label="Area / tole" defaultValue={area} required error={s.errors?.area} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="name" label="Your name" required autoComplete="name" error={s.errors?.name} />
            <Input name="email" type="email" label="Email" required autoComplete="email" error={s.errors?.email} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="phone" type="tel" label="Phone (optional)" autoComplete="tel" error={s.errors?.phone} />
            <Input name="people" type="number" min={1} max={500} label="People who'd order (optional)" />
          </div>
          <Textarea name="note" label="Anything else (optional)" rows={2} />
          <SubmitButton pendingText="Sending…">Send request</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
