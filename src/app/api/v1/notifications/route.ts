import { apiRoute } from "@/server/api/route";
import { iso, ok, paginate, readPage } from "@/server/api/http";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** In-app notifications, newest first (cursor pagination). `meta.unread` = unread count. `link` is a website path. */
export const GET = apiRoute({ auth: "user" }, async ({ req, user }) => {
  const [page, unread] = await Promise.all([
    paginate(readPage(req), (args) => db.notification.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...args })),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return ok(
    page.items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: iso(n.readAt), createdAt: iso(n.createdAt) })),
    { meta: { nextCursor: page.nextCursor, unread } },
  );
});
