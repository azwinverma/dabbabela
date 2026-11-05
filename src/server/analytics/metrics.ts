import type { OrderPaymentStatus, OrderStatus, PaymentMethod, PaymentStatus, RefundMethod } from "@prisma/client";
import type { Permission } from "@/lib/permissions";

/**
 * Metric definitions — the single source of truth (docs/SUPER_ADMIN_ARCHITECTURE.md §4).
 * Every number on the dashboard and analytics pages shows `definition` next to it, and every metric is computed in
 * the database by the functions in this folder. tests/integration/analytics.test.ts checks each one against
 * hand-computed values from seeded rows.
 *
 * The four revenue bases are deliberately different numbers and must never be added together:
 *  · Bookings   — what was sold, at the moment it was sold (a meal plan counts ONCE, at purchase).
 *  · Cash       — money that actually came in / went out.
 *  · Recognised — value of meals actually handed over, net of VAT and refunds (a plan counts per meal delivered).
 *  · Deferred   — money already received for meals not yet delivered, plus wallet credit (a liability).
 */

/** Order statuses that are not a sale yet / any more. */
export const NOT_BOOKED: OrderStatus[] = ["PENDING_PAYMENT", "CANCELLED"];
/** Meal handed over → recognised. */
export const RECOGNISED_STATUSES: OrderStatus[] = ["DELIVERED"];
/** Still to be delivered (informational "scheduled revenue"). */
export const UPCOMING_STATUSES: OrderStatus[] = ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY"];
/** Paid but not delivered → deferred. FAILED_DELIVERY is still owed to the customer. */
export const DEFERRED_STATUSES: OrderStatus[] = [...UPCOMING_STATUSES, "FAILED_DELIVERY"];
export const DEFERRED_PAYMENT: OrderPaymentStatus[] = ["PAID", "PARTIALLY_REFUNDED"];
/** Payment rows that represent money received at some point. */
export const CASH_PAYMENT_STATUSES: PaymentStatus[] = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"];
/** Not new cash: wallet spends re-use money already counted; company-invoice payments are settled through invoices. */
export const NON_CASH_METHODS: PaymentMethod[] = ["WALLET", "COMPANY_INVOICE"];
/** Refunds that don't move cash (they become wallet credit, which stays in deferred revenue). */
export const NON_CASH_REFUNDS: RefundMethod[] = ["WALLET_CREDIT"];

export type MetricUnit = "paisa" | "count" | "ratio" | "meals";
export type Basis = "bookings" | "cash" | "refunds" | "recognised" | "upcoming" | "deferred" | "cancelled" | "receivables" | "orders" | "plans";

export type MetricDef = { key: string; label: string; definition: string; unit: MetricUnit; permission: Permission; basis?: Basis };

const M = <K extends string>(defs: Record<K, Omit<MetricDef, "key">>) =>
  Object.fromEntries(Object.entries(defs).map(([key, d]) => [key, { key, ...(d as object) }])) as Record<K, MetricDef>;

export const METRICS = M({
  bookings: {
    label: "Bookings",
    unit: "paisa",
    permission: "analytics.view",
    basis: "bookings",
    definition:
      "Σ total of single orders + Σ total of meal plans CREATED in the range (Kathmandu time). A meal plan counts once, at purchase — its meals are never counted again when they are cooked or delivered. Excludes checkouts never completed (awaiting online payment) and cancelled single orders. A plan cancelled later stays booked; the unused part shows as a refund or wallet credit.",
  },
  bookingsSingle: { label: "Single-order bookings", unit: "paisa", permission: "analytics.view", basis: "bookings", definition: "Σ total of orders not from a meal plan, created in the range, not cancelled and not awaiting online payment." },
  bookingsPlans: { label: "Meal-plan bookings", unit: "paisa", permission: "analytics.view", basis: "plans", definition: "Σ total of meal plans bought in the range (status anything but awaiting payment). Counted once at purchase." },
  cashIn: {
    label: "Cash collected",
    unit: "paisa",
    permission: "analytics.view",
    basis: "cash",
    definition:
      "Σ amount of payments with paid time in the range (status Paid / Partly refunded / Refunded), excluding wallet-credit spends (already counted when first paid) and company-invoice placeholders (company money arrives against invoices).",
  },
  refundsOut: { label: "Refunds paid out", unit: "paisa", permission: "analytics.view", basis: "refunds", definition: "Σ amount of refunds marked Processed in the range, paid back by gateway, bank or cash. Refunds as wallet credit move no cash and are excluded." },
  netCash: { label: "Net cash", unit: "paisa", permission: "analytics.view", basis: "cash", definition: "Cash collected − refunds paid out." },
  walletSpend: { label: "Paid with wallet credit", unit: "paisa", permission: "analytics.view", basis: "cash", definition: "Σ payments made from wallet credit in the range. Not new cash — shown so method totals reconcile." },
  recognised: {
    label: "Recognised revenue",
    unit: "paisa",
    permission: "analytics.view",
    basis: "recognised",
    definition: "Σ (total − VAT − refunded amount) of orders Delivered with delivery date in the range. Each meal of a plan is recognised on its own delivery day, using its share of the plan price.",
  },
  recognisedVat: { label: "VAT on recognised", unit: "paisa", permission: "analytics.view", basis: "recognised", definition: "Σ VAT recorded on orders Delivered in the range." },
  aov: { label: "Average order value", unit: "paisa", permission: "analytics.view", basis: "recognised", definition: "Recognised revenue ÷ number of Delivered orders (one order per meal-day; a plan contributes one order per meal)." },
  upcoming: { label: "Scheduled revenue", unit: "paisa", permission: "analytics.view", basis: "upcoming", definition: "Same formula as recognised, for orders Scheduled → Out for delivery with delivery date in the range. Informational: not revenue yet." },
  deferred: {
    label: "Deferred revenue (now)",
    unit: "paisa",
    permission: "analytics.view",
    basis: "deferred",
    definition: "Snapshot right now, ignoring the date range: Σ (total − VAT − refunded) of orders paid (Paid / Partly refunded) but not yet delivered (Scheduled → Out for delivery, or Delivery failed) + wallet credit balance (Σ credit ledger). A liability, not income.",
  },
  deferredPlans: { label: "Deferred prepaid plan revenue", unit: "paisa", permission: "analytics.view", basis: "deferred", definition: "The part of deferred revenue that belongs to paid meal plans: paid, undelivered plan meals (total − VAT − refunded)." },
  walletBalance: { label: "Wallet credit owed", unit: "paisa", permission: "analytics.view", definition: "Σ amount over the whole credit ledger (credits − spends). Customer-level, so it is shown only without kitchen/zone/company filters." },
  cancelled: { label: "Cancelled order value", unit: "paisa", permission: "analytics.view", basis: "cancelled", definition: "Σ total of orders Cancelled with delivery date in the range (single orders and plan meals)." },
  bookedByDelivery: {
    label: "Booked by delivery date",
    unit: "paisa",
    permission: "analytics.view",
    basis: "orders",
    definition: "Σ (subtotal + delivery fee) of orders Scheduled → Delivered by delivery date (the figure formerly labelled “gross sales”). Includes meals not yet delivered and VAT, so it is NOT revenue.",
  },
  receivablesPending: { label: "Awaiting payment", unit: "paisa", permission: "analytics.view", basis: "receivables", definition: "Σ amount of payments still Pending right now (online not completed, cash not yet collected, transfer not verified)." },
  receivablesInvoices: { label: "Company invoices outstanding", unit: "paisa", permission: "analytics.view", definition: "Σ (total − paid) of company invoices Issued or Partly paid, right now." },
  runRate: {
    label: "Plan run-rate (30 days)",
    unit: "paisa",
    permission: "analytics.view",
    basis: "plans",
    definition:
      "MRR-equivalent: Σ over Active and Paused plans covering today of (total − VAT) ÷ plan days × 30, where plan days = end − start + 1; plus Active corporate contracts covering today: agreed price per meal × minimum meals per day × service days in the next 30 (delivery weekdays minus closures). Renewal is manual, so this is a run-rate, not contracted recurring revenue.",
  },
  churn: { label: "Plan churn", unit: "ratio", permission: "dashboard.view", definition: "Plans cancelled in the range ÷ plans active at the start of the range." },
  renewalsDue: { label: "Renewals due (7 days)", unit: "count", permission: "dashboard.view", basis: "plans", definition: "Active plans whose end date falls within the next 7 days (renewal is manual — these customers need a reminder)." },
  expectedMeals: { label: "Expected plan meals", unit: "meals", permission: "dashboard.view", definition: "Σ quantity on plan-meal orders Scheduled → Out for delivery for each of the next 7 days." },
  newCustomers: { label: "New customers", unit: "count", permission: "dashboard.view", definition: "Customers whose FIRST delivered order (ever) has a delivery date in the range." },
  activeCustomers: { label: "Active customers", unit: "count", permission: "dashboard.view", definition: "Customers with at least one delivered order in the range." },
  returningCustomers: { label: "Returning customers", unit: "count", permission: "dashboard.view", definition: "Active customers who also had a delivered order before the range started." },
  frequency: { label: "Orders per customer", unit: "ratio", permission: "dashboard.view", definition: "Delivered orders in the range ÷ active customers." },
  ltv: { label: "Historical LTV", unit: "paisa", permission: "analytics.view", definition: "Average over customers with a delivered order of Σ recognised revenue since signup (all time, same filters). Historical only — no prediction." },
  rating: { label: "Average rating", unit: "ratio", permission: "dashboard.view", definition: "Mean of 1–5 ratings customers left on orders delivered in the range (only customers who chose to rate)." },
  complaints: { label: "Complaints", unit: "count", permission: "dashboard.view", definition: "Support tickets opened in the range, by category (orders linked to a ticket follow the kitchen filter)." },
  delayed: { label: "Delayed now", unit: "count", permission: "dashboard.view", basis: "orders", definition: "Orders Packed or Out for delivery whose slot end (Kathmandu) has passed — or whose delivery day is already over." },
  overCapacity: { label: "Over capacity (7 days)", unit: "count", permission: "dashboard.view", definition: "Kitchen-days in the next 7 where booked meals (all live statuses) exceed the day's capacity (override or kitchen default)." },
  shortIngredients: { label: "Short ingredients (tomorrow)", unit: "count", permission: "dashboard.view", definition: "Ingredients whose recipe need for tomorrow's confirmed orders exceeds stock on hand in that kitchen." },
  foodCostEst: { label: "Food cost (estimated)", unit: "paisa", permission: "analytics.view", definition: "Σ recipe-cost snapshot (costTotal) of orders delivered in the range." },
  foodCostActual: { label: "Food cost (actual)", unit: "paisa", permission: "analytics.view", definition: "Σ |quantity| × unit cost of stock Usage + Waste movements in the range." },
  packagingEst: { label: "Packaging (estimated)", unit: "paisa", permission: "analytics.view", definition: "Σ packaging-cost snapshot on orders delivered in the range (from the dabba's packaging cost)." },
  packagingActual: { label: "Packaging (actual)", unit: "paisa", permission: "analytics.view", definition: "Σ approved/paid expenses in category PACKAGING dated in the range." },
  deliveryEst: { label: "Delivery (estimated)", unit: "paisa", permission: "analytics.view", definition: "Σ route cost entered on delivery routes dated in the range." },
  deliveryActual: { label: "Delivery (actual)", unit: "paisa", permission: "analytics.view", definition: "Σ approved/paid expenses in category DELIVERY dated in the range." },
  gatewayEst: { label: "Gateway fees (estimated)", unit: "paisa", permission: "analytics.view", definition: "Σ estimated gateway fee on payments collected in the range." },
  gatewayActual: { label: "Gateway fees (actual)", unit: "paisa", permission: "analytics.view", definition: "Σ fee from imported gateway statements on payments collected in the range (only payments with a statement line)." },
  overheads: { label: "Other operating expenses", unit: "paisa", permission: "analytics.view", definition: "Σ approved/paid expenses dated in the range in every category except FOOD, PACKAGING, DELIVERY, GATEWAY_FEES and capital (CAPEX) categories." },
});

export type MetricKey = keyof typeof METRICS;
export const definition = (k: MetricKey) => METRICS[k].definition;
