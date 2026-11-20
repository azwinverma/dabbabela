import { apiRoute } from "@/server/api/route";
import { scopedRoute } from "@/server/api/ops-dto";
import { startRoute } from "@/server/dispatch";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Dispatch the route (`startRoute`): packed stops go OUT_FOR_DELIVERY (customers get their hand-off code); stops not
 * packed yet stay behind and are counted in `notPacked`.
 */
export const POST = apiRoute<{ permission: "dispatch.edit" }, { id: string }>({ auth: { permission: "dispatch.edit" }, limit: "write" }, async ({ user, params }) => {
  const r0 = await scopedRoute(user, params.id);
  const r = await startRoute(r0.id, user.id);
  await audit({ actorId: user.id, action: "dispatch.start_route", entity: "DeliveryRoute", entityId: r0.id, summary: `${r0.name}: ${r.out} out` });
  return { routeId: r0.id, out: r.out, notPacked: r.notPacked, rejected: r.rejected };
});
