import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { packCheck, packOne } from "@/server/api/kitchen-pack";

export const dynamic = "force-dynamic";

/** Packing check for one order (`recordPacking`): all checks pass → PACKED; any fails → recorded, not packed. */
export const POST = apiRoute<{ permission: "kitchen.edit" }, { id: string }>({ auth: { permission: "kitchen.edit" }, limit: "write" }, async ({ req, user, params }) => {
  const check = await readJson(req, packCheck);
  return packOne(user, params.id, check);
});
