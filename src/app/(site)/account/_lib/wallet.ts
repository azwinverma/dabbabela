import type { DashboardDict } from "@/lib/i18n/dashboard";
import { ledgerReasonLabel } from "@/lib/ledger-labels";

/** Label for a ledger reason; REFERRAL is translated (Nepali dictionary), the rest are English for now. */
export function walletReasonLabel(reason: string, d: Pick<DashboardDict, "wallet">) {
  if (reason === "REFERRAL") return d.wallet.referral;
  return ledgerReasonLabel(reason);
}
