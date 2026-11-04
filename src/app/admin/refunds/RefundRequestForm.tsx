"use client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { requestRefundAction } from "./actions";

export function RefundRequestForm({ paymentId, max, orders }: { paymentId: string; max: number; orders: { id: string; label: string }[] }) {
  return (
    <ActionForm action={requestRefundAction} className="space-y-2 border-t border-ink-line/60 pt-3" resetOnSuccess>
      <p className="text-xs font-bold uppercase tracking-wide text-ink-mute">Request a refund · up to Rs {(max / 100).toFixed(2)}</p>
      <input type="hidden" name="paymentId" value={paymentId} />
      <select name="orderId" className="field" aria-label="Order">
        <option value="">Whole payment</option>
        {orders.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input name="amount" inputMode="decimal" placeholder="Amount (Rs)" className="field" required aria-label="Amount" />
        <select name="method" className="field" defaultValue="WALLET_CREDIT" aria-label="Refund method">
          <option value="WALLET_CREDIT">Wallet credit</option>
          <option value="ORIGINAL">Back to eSewa/Khalti</option>
          <option value="BANK">Bank transfer</option>
          <option value="CASH">Cash</option>
        </select>
      </div>
      <input name="reason" placeholder="Reason (customer sees this)" className="field" required aria-label="Reason" />
      <SubmitButton size="sm" variant="dark">
        Request refund
      </SubmitButton>
    </ActionForm>
  );
}
