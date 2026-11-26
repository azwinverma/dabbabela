import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { notFound, readJson } from "@/server/api/http";
import { CustomBoxError, deleteCustomBox, updateBuiltBox } from "@/server/custom-boxes";
import { buildDiet, buildPick, savedBoxDto } from "@/server/api/customer-dto";

export const dynamic = "force-dynamic";

type P = { id: string };

const body = z.object({
  name: z.string().max(60).optional(),
  picks: z.array(buildPick).min(1).max(20).optional(),
  diet: buildDiet,
});

/** Rename and/or rebuild one of the caller's saved boxes (picks re-validated + re-priced). Another customer's → 404. */
export const PATCH = apiRoute<"user", P>({ auth: "user", limit: "write" }, async ({ req, user, params }) => {
  const b = await readJson(req, body);
  try {
    return savedBoxDto(await updateBuiltBox(user.id, params.id, { name: b.name, picks: b.picks, diet: b.diet ?? null }));
  } catch (e) {
    if (e instanceof CustomBoxError && e.message === "Saved dabba not found") throw notFound(e.message);
    throw e;
  }
});

/** Delete a saved box. Refused (422 BUILD_REJECTED) while an active plan has it booked on an upcoming day. */
export const DELETE = apiRoute<"user", P>({ auth: "user", limit: "write" }, async ({ user, params }) => {
  if (!(await deleteCustomBox(user.id, params.id))) throw notFound("Saved dabba not found");
  return { message: "Deleted" };
});
