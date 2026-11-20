import { apiRoute } from "@/server/api/route";
import { apiRiderActor } from "@/server/api/ops-dto";
import { completeRoute } from "@/server/dispatch";

export const dynamic = "force-dynamic";

/** Finish a route once no stop is still out (`completeRoute`). Riders: own route only; then hand the cash to dispatch. */
export const POST = apiRoute<{ permission: "rider.edit" }, { id: string }>({ auth: { permission: "rider.edit" }, limit: "write" }, async ({ user, params }) => {
  const who = await apiRiderActor(user, { routeId: params.id });
  const r = await completeRoute(params.id, who);
  return { id: r.id, status: r.status, cashCollected: r.cashCollected };
});
