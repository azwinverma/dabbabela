"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Checkbox, Select, Textarea, Input } from "@/components/ui/Fields";
import { createTicketAction, feedbackAction } from "@/lib/actions/account";
import { cn } from "@/lib/utils";

function Stars({ name, label, required, initial }: { name: string; label: string; required?: boolean; initial?: number | null }) {
  const [v, setV] = useState(initial ?? 0);
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={cn("cursor-pointer rounded-lg border-2 px-3 py-1.5 text-sm font-bold", v >= n ? "border-ink bg-besar" : "border-ink-line bg-white")}>
            <input type="radio" name={name} value={n} checked={v === n} onChange={() => setV(n)} className="sr-only" required={required} />
            {n}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function FeedbackForm({ orderId, existing }: { orderId: string; existing?: { rating: number; taste: number | null; portion: number | null; onTime: boolean | null; comment: string | null; publishConsent: boolean } | null }) {
  return (
    <ActionForm action={feedbackAction} className="space-y-4">
      <input type="hidden" name="orderId" value={orderId} />
      <Stars name="rating" label="Overall" required initial={existing?.rating} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Stars name="taste" label="Taste" initial={existing?.taste} />
        <Stars name="portion" label="Portion size" initial={existing?.portion} />
      </div>
      <Select
        label="Did it arrive on time?"
        name="onTime"
        defaultValue={existing?.onTime === true ? "yes" : existing?.onTime === false ? "no" : ""}
        placeholder="—"
        options={[
          { value: "yes", label: "Yes, within my window" },
          { value: "no", label: "No, it was late" },
        ]}
      />
      <Textarea label="Anything else?" name="comment" rows={3} defaultValue={existing?.comment ?? ""} maxLength={1000} />
      <Checkbox name="publishConsent" defaultChecked={existing?.publishConsent} label="You may quote this on the website with my first name" hint="Optional. We never publish reviews without this." />
      <SubmitButton>{existing ? "Update feedback" : "Send feedback"}</SubmitButton>
    </ActionForm>
  );
}

export function ProblemForm({ orderId, number }: { orderId: string; number: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-sindoor underline underline-offset-2">
        Something wrong with this order?
      </button>
    );
  return (
    <ActionForm action={createTicketAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      <Select
        label="What happened?"
        name="category"
        defaultValue="FOOD"
        options={[
          { value: "FOOD", label: "Food (missing item, quality, allergy)" },
          { value: "DELIVERY", label: "Delivery (late, not received)" },
          { value: "PAYMENT", label: "Payment or refund" },
          { value: "ORDER", label: "Something else about this order" },
        ]}
      />
      <Input label="Subject" name="subject" defaultValue={`Order ${number}`} required maxLength={160} />
      <Textarea label="Tell us more" name="body" rows={4} required maxLength={4000} placeholder="What went wrong, and what would make it right?" />
      <SubmitButton>Send to support</SubmitButton>
    </ActionForm>
  );
}
