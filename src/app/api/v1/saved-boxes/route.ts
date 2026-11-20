import { apiRoute } from "@/server/api/route";
import { iso } from "@/server/api/http";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The caller's saved Build-a-Dabba boxes (order one with a cart line `{ kind: "custom", id }`). `price` is the last
 * computed price (display only; checkout re-prices). Creating/editing boxes stays on the website builder for now.
 */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => {
  const rows = await db.customBox.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } });
  return rows.map((b) => ({ id: b.id, name: b.name, price: b.price, items: Array.isArray(b.items) ? b.items : [], updatedAt: iso(b.updatedAt) }));
});
