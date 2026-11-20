/** Human labels for CreditLedger.reason (customer wallet and admin ledger views). */
export const LEDGER_REASON_LABEL: Record<string, string> = {
  SKIP_CREDIT: "Skipped plan meal",
  REFUND: "Refund",
  ADJUSTMENT: "Adjustment",
  SPEND: "Spent on an order",
  REVERSAL: "Reversal",
  GOODWILL: "Goodwill credit",
  CANCEL_CREDIT: "Cancelled order",
  DISRUPTION_CREDIT: "Kitchen closed",
  REFERRAL: "Referral reward",
  TOPUP: "Top-up",
  TOPUP_REVERSAL: "Top-up refunded",
};

export const ledgerReasonLabel = (reason: string) => LEDGER_REASON_LABEL[reason] ?? reason;
