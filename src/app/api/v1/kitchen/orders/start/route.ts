import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { kitchenWhereFor } from "@/server/api/auth";
import { idList } from "@/server/api/ops-dto";
import { setOrderStatus } from "@/server/orders";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({ orderIds: idList });

/**
 * Bulk "start preparing" (→ PREPARING), like the kitchen screen. Orders outside the caller's kitchens are ignored and
 * reported as rejected ("Not found in your kitchens"); illegal transitions are rejected with the reason.
 */
export const POST = apiRoute({ auth: { permission: "kitchen.edit" }, limit: "write" }, async ({ req, user }) => {
  const { orderIds } = await readJson(req, schema);
  const inScope = await db.order.findMany({ where: { id: { in: orderIds }, ...kitchenWhereFor(user) }, select: { id: true } });
  const ok = new Set(inScope.map((o) => o.id));
  const r = await setOrderStatus([...ok], "PREPARING", user.id, "Kitchen started");
  return { changed: r.changed, rejected: [...r.rejected, ...orderIds.filter((id) => !ok.has(id)).map((id) => ({ id, reason: "Not found in your kitchens" }))] };
});
