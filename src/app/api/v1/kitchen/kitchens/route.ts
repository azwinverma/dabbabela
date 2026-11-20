import { apiRoute } from "@/server/api/route";
import { scopedKitchens } from "@/server/api/auth";

export const dynamic = "force-dynamic";

/** Active kitchens in the caller's scope (first = default for the kitchen/dispatch screens). */
export const GET = apiRoute({ auth: { permission: ["kitchen.view", "dispatch.view"] } }, async ({ user }) => {
  return scopedKitchens(user);
});
