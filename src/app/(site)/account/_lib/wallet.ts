import type { DashboardDict } from "@/lib/i18n/dashboard";

const REASON: Record<string, string> = {
  SKIP_CREDIT: "Skipped plan meal",
  REFUND: "Refund",
  ADJUSTMENT: "Adjustment",
  SPEND: "Spent on an order",
  REVERSAL: "Reversal",
  GOODWILL: "Goodwill credit",
  CANCEL_CREDIT: "Cancelled order",
  DISRUPTION_CREDIT: "Kitchen closed",
};

/** Label for a ledger reason; REFERRAL is translated (Nepali dictionary), the rest are English for now. */
export function walletReasonLabel(reason: string, d: Pick<DashboardDict, "wallet">) {
  if (reason === "REFERRAL") return d.wallet.referral;
  return REASON[reason] ?? reason;
}
