import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { created, readJson } from "@/server/api/http";
import { assertKitchenScope } from "@/server/api/auth";
import { isoDateStr } from "@/server/api/ops-dto";
import { assignOrders, createRoute } from "@/server/dispatch";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  kitchenId: z.string().min(1).max(64),
  date: isoDateStr,
  name: z.string().trim().min(1, "Name the route").max(80),
  slotId: z.string().max(64).nullable().optional(),
  zoneId: z.string().max(64).nullable().optional(),
  riderId: z.string().max(64).nullable().optional(),
  orderIds: z.array(z.string().min(1).max(64)).max(200).optional(),
});

/** Create a route for a kitchen-day (`createRoute`), optionally with a rider and stops (`assignOrders`, in order). */
export const POST = apiRoute({ auth: { permission: "dispatch.edit" }, limit: "write" }, async ({ req, user }) => {
  const b = await readJson(req, schema);
  assertKitchenScope(user, b.kitchenId);
  const r = await createRoute({ kitchenId: b.kitchenId, date: b.date, name: b.name, slotId: b.slotId || null, zoneId: b.zoneId || null, riderId: b.riderId || null });
  const stops = b.orderIds?.length ? await assignOrders(r.id, b.orderIds) : 0;
  if (stops) await audit({ actorId: user.id, action: "dispatch.assign", entity: "DeliveryRoute", entityId: r.id, summary: `${r.name}: ${stops} stop(s) added`, after: { orderIds: b.orderIds } });
  return created({ id: r.id, name: r.name, status: r.status, riderId: r.riderId, stops });
});
