import { apiRoute } from "@/server/api/route";
import { iso } from "@/server/api/http";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Signed-in devices/sessions of the caller (no tokens are ever returned). */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => {
  const rows = await db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { updatedAt: "desc" }, select: { id: true, ipAddress: true, userAgent: true, createdAt: true, updatedAt: true, expiresAt: true } });
  return rows.map((s) => ({ id: s.id, current: s.id === user.sessionId, ipAddress: s.ipAddress, userAgent: s.userAgent, createdAt: iso(s.createdAt), lastActiveAt: iso(s.updatedAt), expiresAt: iso(s.expiresAt) }));
});

/** Sign out every other session (keeps this one). */
export const DELETE = apiRoute({ auth: "user", limit: "write" }, async ({ user }) => {
  const r = await db.session.deleteMany({ where: { userId: user.id, id: { not: user.sessionId } } });
  await audit({ actorId: user.id, action: "user.sessions_revoke_others", entity: "User", entityId: user.id, summary: `${r.count} session(s) signed out via mobile app` });
  return { revoked: r.count };
});
