import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { scopedRoute } from "@/server/api/ops-dto";
import { setRouteRider } from "@/server/dispatch";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({ riderId: z.string().min(1).max(64).nullable() });

/** Assign, change or clear (null) the route's rider (`setRouteRider`: active, available, same kitchen). Audited. */
export const PUT = apiRoute<{ permission: "dispatch.edit" }, { id: string }>({ auth: { permission: "dispatch.edit" }, limit: "write" }, async ({ req, user, params }) => {
  const { riderId } = await readJson(req, schema);
  const r = await scopedRoute(user, params.id);
  if (riderId === r.riderId) return { routeId: r.id, riderId, changed: false };
  await setRouteRider(r.id, riderId);
  await audit({ actorId: user.id, action: "dispatch.reassign_rider", entity: "DeliveryRoute", entityId: r.id, summary: `${r.name}: rider changed`, before: { riderId: r.riderId }, after: { riderId } });
  return { routeId: r.id, riderId, changed: true };
});
