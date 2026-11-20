import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { created, readJson } from "@/server/api/http";
import { throwIfFailed } from "@/server/api/customer-dto";
import { requestDeletion } from "@/server/profile";

export const dynamic = "force-dynamic";

const schema = z.object({ confirm: z.string().max(20), note: z.string().max(500).nullable().optional() });

/**
 * Ask for the account to be deleted (`confirm: "DELETE"`). Staff confirm within 7 days; order and tax records are
 * anonymised, not deleted. One open request at a time.
 */
export const POST = apiRoute({ auth: "user", limit: "write" }, async ({ req, user }) => {
  const b = await readJson(req, schema);
  const r = await requestDeletion(user.id, { confirm: b.confirm, note: b.note ?? null });
  throwIfFailed(r);
  return created({ requested: true, message: r.message });
});
