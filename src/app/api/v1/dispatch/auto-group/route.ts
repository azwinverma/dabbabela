import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { assertKitchenScope } from "@/server/api/auth";
import { isoDateStr } from "@/server/api/ops-dto";
import { autoGroupRoutes } from "@/server/dispatch";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({ kitchenId: z.string().min(1).max(64), date: isoDateStr });

/** Put every unrouted order of the kitchen-day on one route per slot × zone (open PLANNED routes are reused). */
export const POST = apiRoute({ auth: { permission: "dispatch.edit" }, limit: "write" }, async ({ req, user }) => {
  const b = await readJson(req, schema);
  assertKitchenScope(user, b.kitchenId);
  const r = await autoGroupRoutes(b.kitchenId, b.date);
  if (r.stops) await audit({ actorId: user.id, action: "dispatch.auto_group", entity: "Kitchen", entityId: b.kitchenId, summary: `${b.date}: ${r.stops} stop(s) grouped, ${r.routes} new route(s)` });
  return r;
});
