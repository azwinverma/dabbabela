"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Select, Textarea } from "@/components/ui/Fields";
import { cancelPlanAction, changePlanAddressAction, pausePlanAction, resumePlanAction } from "@/lib/actions/account";

export function PlanActions({
  id,
  status,
  addresses,
  currentAddressId,
  cancelPolicy = "CREDIT",
}: {
  id: string;
  status: string;
  addresses: { id: string; label: string; covered: boolean }[];
  currentAddressId: string | null;
  cancelPolicy?: "CREDIT" | "REFUND" | "STAFF_ONLY";
}) {
  const canCancel = status === "PENDING_PAYMENT" || (cancelPolicy !== "STAFF_ONLY" && ["ACTIVE", "PAUSED"].includes(status));
  const [panel, setPanel] = useState<null | "cancel" | "address">(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "ACTIVE" && (
          <ActionForm action={pausePlanAction}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton size="sm" variant="outline" pendingText="…" confirm="Pause this plan? Upcoming meals go on hold until you resume.">
              Pause
            </SubmitButton>
          </ActionForm>
        )}
        {status === "PAUSED" && (
          <ActionForm action={resumePlanAction}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton size="sm" pendingText="…">Resume</SubmitButton>
          </ActionForm>
        )}
        {["ACTIVE", "PAUSED"].includes(status) && (
          <button type="button" onClick={() => setPanel(panel === "address" ? null : "address")} className="rounded-xl border-2 border-ink px-3 py-1.5 text-sm font-semibold">
            Change address
          </button>
        )}
        {canCancel && (
          <button type="button" onClick={() => setPanel(panel === "cancel" ? null : "cancel")} className="rounded-xl border-2 border-sindoor px-3 py-1.5 text-sm font-semibold text-sindoor">
            Cancel plan
          </button>
        )}
      </div>
      {panel === "address" && (
        <ActionForm action={changePlanAddressAction} className="space-y-3 rounded-xl border-2 border-ink-line bg-white p-4">
          <input type="hidden" name="id" value={id} />
          <Select
            label="Send upcoming meals to"
            name="addressId"
            defaultValue={currentAddressId ?? ""}
            options={addresses.map((a) => ({ value: a.id, label: `${a.label}${a.covered ? "" : " (not covered yet)"}` }))}
          />
          <p className="text-xs text-ink-mute">Meals already locked for today stay where they are.</p>
          <SubmitButton size="sm">Move meals</SubmitButton>
        </ActionForm>
      )}
      {panel === "cancel" && (
        <ActionForm action={cancelPlanAction} className="space-y-3 rounded-xl border-2 border-sindoor/40 bg-sindoor-light/40 p-4">
          {(state) => (
            <>
              <input type="hidden" name="id" value={id} />
              <p className="text-sm">
                Meals before their cut-off are cancelled and what you paid for them {cancelPolicy === "REFUND" ? "is refunded to your original payment method" : "goes back to your Dabba Bela credit"}. Meals already locked will still be delivered.
              </p>
              <Textarea label="Why are you cancelling?" name="reason" rows={2} required error={state.errors?.reason} />
              <SubmitButton size="sm" variant="danger" confirm="Cancel the rest of this plan?">
                Cancel plan
              </SubmitButton>
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
