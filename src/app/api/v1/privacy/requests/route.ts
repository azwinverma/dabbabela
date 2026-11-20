import { apiRoute } from "@/server/api/route";
import { iso } from "@/server/api/http";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The caller's privacy requests (export / deletion) and their status. */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => {
  const rows = await db.dataRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ id: r.id, type: r.type, status: r.status, createdAt: iso(r.createdAt), completedAt: iso(r.completedAt) }));
});
