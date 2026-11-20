import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { updatePreferences } from "@/server/profile";

export const dynamic = "force-dynamic";

const schema = z.object({
  diet: z.enum(["ANY", "VEG", "EGG_OK", "VEGAN"]).optional(),
  spiceTolerance: z.number().int().min(0).max(4).optional(),
  /** Allergen codes (unknown codes are ignored). Printed on every dabba label. */
  allergies: z.array(z.string().max(40)).max(30).optional(),
  avoidOnionGarlic: z.boolean().optional(),
  dietaryNotes: z.string().max(300).optional(),
});

/** Food preferences (diet, spice, allergies, notes). Omitted fields keep their value. */
export const PATCH = apiRoute({ auth: "user", limit: "write" }, async ({ req, user }) => {
  const b = await readJson(req, schema);
  const r = await updatePreferences(user.id, {
    diet: b.diet ?? user.diet,
    spiceTolerance: b.spiceTolerance ?? user.spiceTolerance,
    allergies: b.allergies ?? user.allergies,
    avoidOnionGarlic: b.avoidOnionGarlic ?? user.avoidOnionGarlic,
    dietaryNotes: b.dietaryNotes ?? user.dietaryNotes ?? "",
  });
  return { message: r.message };
});
