import "server-only";
import { z } from "zod";
import { recordPacking } from "@/server/kitchen";
import { scopedOrder } from "./ops-dto";
import type { ApiUser } from "./auth";

/** Packing check body (the four checks of the kitchen screen). All four must pass for the order to become PACKED. */
export const packCheck = z.object({
  itemsOk: z.boolean(),
  labelOk: z.boolean(),
  allergenOk: z.boolean(),
  sealedOk: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

/** One packing check on an order in scope (404 otherwise) → `recordPacking`. */
export async function packOne(user: ApiUser, orderId: string, check: z.infer<typeof packCheck>) {
  const o = await scopedOrder(user, orderId);
  const r = await recordPacking(orderId, user.id, { ...check, note: check.note ?? "" });
  return { orderId, number: o.number, packed: r.packed, reason: r.packed ? null : "rejected" in r && r.rejected?.[0]?.reason ? r.rejected[0].reason : "Check failed — fix and check again" };
}
