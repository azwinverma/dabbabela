import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { idList, scopedRoute } from "@/server/api/ops-dto";
import { assignOrders } from "@/server/dispatch";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({ orderIds: idList });

/** Add stops to a route, in the given order (`assignOrders`; orders on other routes move; same kitchen-day only). */
export const POST = apiRoute<{ permission: "dispatch.edit" }, { id: string }>({ auth: { permission: "dispatch.edit" }, limit: "write" }, async ({ req, user, params }) => {
  const { orderIds } = await readJson(req, schema);
  const r = await scopedRoute(user, params.id);
  const n = await assignOrders(r.id, orderIds);
  await audit({ actorId: user.id, action: "dispatch.assign", entity: "DeliveryRoute", entityId: r.id, summary: `${r.name}: ${n} stop(s) added`, after: { orderIds } });
  return { routeId: r.id, added: n };
});
