import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { scopedOrder } from "@/server/api/ops-dto";
import { resolveFailed } from "@/server/dispatch";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["RETRY", "CANCEL"]),
  reason: z.string().trim().min(3, "Give a reason (at least a few words) — it goes in the audit log").max(500),
});

/**
 * Resolve a failed delivery (`resolveFailed`): RETRY sends it out again (customer notified); CANCEL cancels it and
 * credits the customer's wallet — so Idempotency-Key is required.
 */
export const POST = apiRoute<{ permission: "dispatch.edit" }, { orderId: string }>({ auth: { permission: "dispatch.edit" }, idempotent: "dispatch-resolve", limit: "write" }, async ({ req, user, params }) => {
  const b = await readJson(req, schema);
  const o = await scopedOrder(user, params.orderId);
  await resolveFailed(o.id, user.id, b.action, b.reason);
  await audit({ actorId: user.id, action: `dispatch.failed_${b.action.toLowerCase()}`, entity: "Order", entityId: o.id, summary: o.number, reason: b.reason });
  const now = await db.order.findUniqueOrThrow({ where: { id: o.id }, select: { status: true } });
  return { orderId: o.id, number: o.number, status: now.status };
});
