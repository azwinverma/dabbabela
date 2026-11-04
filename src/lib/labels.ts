import type { ItemCategory, LeadStatus, OrderPaymentStatus, OrderStatus, PaymentMethod, PaymentStatus, RefundStatus, SubscriptionStatus, InvoiceStatus, Diet, AddressType } from "@prisma/client";

export type Tone = "neutral" | "info" | "warn" | "good" | "bad" | "brand";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  PENDING_PAYMENT: { label: "Awaiting payment", tone: "warn" },
  SCHEDULED: { label: "Scheduled", tone: "neutral" },
  CONFIRMED: { label: "Confirmed", tone: "info" },
  PREPARING: { label: "In the kitchen", tone: "brand" },
  PACKED: { label: "Packed", tone: "brand" },
  OUT_FOR_DELIVERY: { label: "On the way", tone: "brand" },
  DELIVERED: { label: "Delivered", tone: "good" },
  FAILED_DELIVERY: { label: "Delivery failed", tone: "bad" },
  CANCELLED: { label: "Cancelled", tone: "bad" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
};

export const ORDER_PAYMENT_STATUS: Record<OrderPaymentStatus, { label: string; tone: Tone }> = {
  UNPAID: { label: "Unpaid", tone: "warn" },
  PENDING: { label: "Payment pending", tone: "warn" },
  PAID: { label: "Paid", tone: "good" },
  INVOICED: { label: "Company invoice", tone: "info" },
  PARTIALLY_REFUNDED: { label: "Part refunded", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "warn" },
  PAID: { label: "Paid", tone: "good" },
  FAILED: { label: "Failed", tone: "bad" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Part refunded", tone: "info" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  ESEWA: "eSewa",
  KHALTI: "Khalti",
  BANK_TRANSFER: "Bank / QR",
  CASH: "Cash",
  COMPANY_INVOICE: "Company invoice",
  WALLET: "Credit",
};

export const REFUND_STATUS: Record<RefundStatus, { label: string; tone: Tone }> = {
  REQUESTED: { label: "Requested", tone: "warn" },
  APPROVED: { label: "Approved", tone: "info" },
  PROCESSED: { label: "Processed", tone: "good" },
  REJECTED: { label: "Rejected", tone: "bad" },
};

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ISSUED: { label: "Issued", tone: "warn" },
  PARTIALLY_PAID: { label: "Part paid", tone: "info" },
  PAID: { label: "Paid", tone: "good" },
  VOID: { label: "Void", tone: "bad" },
};

export const SUB_STATUS: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  PENDING_PAYMENT: { label: "Awaiting payment", tone: "warn" },
  ACTIVE: { label: "Active", tone: "good" },
  PAUSED: { label: "Paused", tone: "neutral" },
  COMPLETED: { label: "Completed", tone: "info" },
  CANCELLED: { label: "Cancelled", tone: "bad" },
};

export const LEAD_STATUS: Record<LeadStatus, { label: string; tone: Tone }> = {
  NEW: { label: "New", tone: "brand" },
  CONTACTED: { label: "Contacted", tone: "info" },
  TRIAL: { label: "Trial booked", tone: "warn" },
  PROPOSAL: { label: "Proposal sent", tone: "info" },
  WON: { label: "Won", tone: "good" },
  LOST: { label: "Lost", tone: "bad" },
};

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  BASE: "Base",
  MAIN: "Main",
  PROTEIN: "Protein",
  VEGETABLE: "Vegetable",
  SIDE: "Side",
  ACHAR: "Achar",
  ADDON: "Add-on",
};

export const DIET_LABEL: Record<Diet, { label: string; short: string; veg: boolean }> = {
  VEGAN: { label: "Vegan", short: "Vegan", veg: true },
  VEG: { label: "Vegetarian", short: "Veg", veg: true },
  EGG: { label: "Contains egg", short: "Egg", veg: false },
  CHICKEN: { label: "Chicken", short: "Chicken", veg: false },
  MUTTON: { label: "Mutton", short: "Mutton", veg: false },
  BUFF: { label: "Buff", short: "Buff", veg: false },
  PORK: { label: "Pork", short: "Pork", veg: false },
  FISH: { label: "Fish", short: "Fish", veg: false },
};

export const ADDRESS_TYPE_LABEL: Record<AddressType, string> = {
  HOME: "Home",
  OFFICE: "Office",
  SHOP: "Shop",
  COLLEGE: "College",
  SITE: "Work site",
  OTHER: "Other",
};

/** Next step in the kitchen → delivery flow. */
export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  SCHEDULED: "PREPARING",
  CONFIRMED: "PREPARING",
  PREPARING: "PACKED",
  PACKED: "OUT_FOR_DELIVERY",
  OUT_FOR_DELIVERY: "DELIVERED",
};
