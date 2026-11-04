"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Textarea } from "@/components/ui/Fields";
import { createTicketAction } from "@/lib/actions/account";

export function NewTicket({ orders }: { orders: { id: string; label: string }[] }) {
  return (
    <ActionForm action={createTicketAction} className="space-y-3" resetOnSuccess>
      {(state) => (
        <>
          <Select
            label="Topic"
            name="category"
            defaultValue="GENERAL"
            options={[
              { value: "ORDER", label: "An order" },
              { value: "FOOD", label: "Food quality / allergy" },
              { value: "DELIVERY", label: "Delivery" },
              { value: "PAYMENT", label: "Payment or refund" },
              { value: "ACCOUNT", label: "My account" },
              { value: "CORPORATE", label: "Team / company account" },
              { value: "GENERAL", label: "Something else" },
            ]}
          />
          {orders.length > 0 && <Select label="Related order (optional)" name="orderId" placeholder="—" options={orders.map((o) => ({ value: o.id, label: o.label }))} />}
          <Input label="Subject" name="subject" required maxLength={160} error={state.errors?.subject} />
          <Textarea label="Message" name="body" rows={4} required maxLength={4000} error={state.errors?.body} />
          <SubmitButton>Send</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
