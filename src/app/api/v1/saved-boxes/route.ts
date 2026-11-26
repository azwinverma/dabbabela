import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { created, readJson } from "@/server/api/http";
import { buildDiet, buildPick, savedBoxDto } from "@/server/api/customer-dto";
import { listCustomBoxes, saveBuiltBox } from "@/server/custom-boxes";

export const dynamic = "force-dynamic";

/**
 * The caller's saved Build-a-Dabba boxes, each re-priced now (`problem` = why it can't be ordered as built). Order
 * one with a cart line `{ kind: "custom", id }` on POST /cart/quote and POST /orders (re-priced again at checkout;
 * refused on a company-billed order).
 */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => {
  const rows = await listCustomBoxes(user.id);
  return rows.map((r) => savedBoxDto(r.box, r));
});

const body = z.object({
  name: z.string().max(60).optional(),
  picks: z.array(buildPick).min(1).max(20),
  diet: buildDiet,
});

/** Save a built dabba (validated + priced like /builder/quote; must have no `problem`). At most 30 per customer. */
export const POST = apiRoute({ auth: "user", limit: "write" }, async ({ req, user }) => {
  const b = await readJson(req, body);
  const box = await saveBuiltBox(user.id, { name: b.name, picks: b.picks, diet: b.diet ?? null });
  return created(savedBoxDto(box));
});
