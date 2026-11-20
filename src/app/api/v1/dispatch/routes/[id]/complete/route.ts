import { apiRoute } from "@/server/api/route";
import { scopedRoute } from "@/server/api/ops-dto";
import { completeRoute } from "@/server/dispatch";

export const dynamic = "force-dynamic";

/** Close a route once no stop is still out (`completeRoute`, as staff). */
export const POST = apiRoute<{ permission: "dispatch.edit" }, { id: string }>({ auth: { permission: "dispatch.edit" }, limit: "write" }, async ({ user, params }) => {
  const r0 = await scopedRoute(user, params.id);
  const r = await completeRoute(r0.id, { id: user.id, isStaff: true });
  return { routeId: r.id, status: r.status };
});
