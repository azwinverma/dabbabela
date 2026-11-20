import { apiRoute } from "@/server/api/route";
import { notFound } from "@/server/api/http";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Sign out one of the caller's sessions (another device, or this one). Someone else's session id → 404. */
export const DELETE = apiRoute<"user", { id: string }>({ auth: "user", limit: "write" }, async ({ user, params }) => {
  const r = await db.session.deleteMany({ where: { id: params.id, userId: user.id } });
  if (!r.count) throw notFound("Session not found");
  await audit({ actorId: user.id, action: "user.session_revoke", entity: "Session", entityId: params.id, summary: params.id === user.sessionId ? "own current session (mobile app)" : "via mobile app" });
  return { revoked: 1, current: params.id === user.sessionId };
});
