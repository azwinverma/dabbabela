import type { OrderStatus } from "@prisma/client";

/**
 * Fulfilment state machine. Payment and subscription states are tracked separately
 * (Order.paymentStatus, Subscription.status) — see docs/ARCHITECTURE.md §Order lifecycle.
 */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["CONFIRMED", "PREPARING", "CANCELLED", "SKIPPED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["PACKED", "CANCELLED"],
  PACKED: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "FAILED_DELIVERY"],
  FAILED_DELIVERY: ["OUT_FOR_DELIVERY", "CANCELLED", "DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  SKIPPED: ["SCHEDULED"],
};

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class TransitionError extends Error {
  constructor(
    public from: OrderStatus,
    public to: OrderStatus,
  ) {
    super(`Can't move an order from ${from} to ${to}`);
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

/** Orders that occupy kitchen capacity and appear in demand. */
export const LIVE_STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"];
/** Orders the kitchen will cook (payment secured or not required up-front). */
export const COOK_STATUSES: OrderStatus[] = ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED"];
/** Still changeable by the customer before the cut-off. */
export const EDITABLE_STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "SCHEDULED"];
/** Counted as revenue. */
export const REVENUE_STATUSES: OrderStatus[] = ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED"];
