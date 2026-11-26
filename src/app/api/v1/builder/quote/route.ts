import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { quoteBuild } from "@/server/custom-boxes";
import { buildDiet, buildPick } from "@/server/api/customer-dto";

export const dynamic = "force-dynamic";

const buildBody = z.object({ picks: z.array(buildPick).max(20), diet: buildDiet });

/**
 * Live price + validation of a build (the website builder's preview): group min/max, diet and combination rules,
 * portions, kitchen availability, per-dish max quantity and the minimum dabba price. `problem` = first blocking
 * problem (null = can be saved/ordered); `warnings` never block. Prices are computed on the server only.
 */
export const POST = apiRoute({ auth: "optional", limit: "read" }, async ({ req }) => {
  const b = await readJson(req, buildBody);
  return quoteBuild(b.picks, b.diet ?? null);
});
