"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { cancelOrderAction, skipMealAction, unskipMealAction } from "@/lib/actions/account";

export function MealActions({
  orderId,
  kind,
  status,
  open,
  credited,
  labels,
}: {
  orderId: string;
  kind: "plan" | "single";
  status: string;
  open: boolean;
  credited?: boolean;
  labels: { skip: string; unskip: string; cancel: string };
}) {
  if (!open) return null;
  const form = (action: typeof skipMealAction, label: string, variant: "outline" | "danger" | "ghost", confirm?: string) => (
    <ActionForm action={action} className="inline-block">
      <input type="hidden" name="orderId" value={orderId} />
      <SubmitButton size="sm" variant={variant} pendingText="…" confirm={confirm}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
  if (kind === "plan" && (status === "SCHEDULED" || status === "PENDING_PAYMENT")) return form(skipMealAction, labels.skip, "outline");
  if (kind === "plan" && status === "SKIPPED" && !credited) return form(unskipMealAction, labels.unskip, "ghost");
  if (kind === "single" && (status === "SCHEDULED" || status === "PENDING_PAYMENT"))
    return form(cancelOrderAction, labels.cancel, "danger", "Cancel this dabba? If you've paid, the amount goes back to your credit.");
  return null;
}
