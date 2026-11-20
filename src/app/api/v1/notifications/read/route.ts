import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().max(64).optional() });

/** Mark one notification (`id`) or all of the caller's notifications (no `id`) as read. */
export const POST = apiRoute({ auth: "user", limit: "write" }, async ({ req, user }) => {
  const { id } = await readJson(req, schema);
  const r = await db.notification.updateMany({ where: { userId: user.id, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
  return { marked: r.count, message: id ? "Marked as read" : "All caught up" };
});
