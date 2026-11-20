import { apiRoute } from "@/server/api/route";
import { scopedOrder } from "@/server/api/ops-dto";
import { unassignOrder } from "@/server/dispatch";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Take an order off its route (`unassignOrder`). */
export const DELETE = apiRoute<{ permission: "dispatch.edit" }, { orderId: string }>({ auth: { permission: "dispatch.edit" }, limit: "write" }, async ({ user, params }) => {
  const o = await scopedOrder(user, params.orderId);
  const a = await db.deliveryAssignment.findUnique({ where: { orderId: o.id }, select: { routeId: true } });
  await unassignOrder(o.id);
  await audit({ actorId: user.id, action: "dispatch.unassign", entity: "Order", entityId: o.id, summary: `${o.number} removed from route`, before: a });
  return { orderId: o.id, removedFrom: a?.routeId ?? null };
});
