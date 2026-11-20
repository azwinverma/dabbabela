import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { iso, readQuery, ymd } from "@/server/api/http";
import { pickApiKitchen } from "@/server/api/auth";
import { isoDateStr, piiOf } from "@/server/api/ops-dto";
import { dateOnly, todayKTM } from "@/lib/dates";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const q = z.object({ kitchenId: z.string().max(64).optional(), date: isoDateStr.optional() });

/** Failed deliveries of a kitchen-day with the rider's last reason; resolve with POST /dispatch/failed/{orderId}/resolve. */
export const GET = apiRoute({ auth: { permission: "dispatch.view" } }, async ({ req, user }) => {
  const p = readQuery(req, q);
  const kitchen = await pickApiKitchen(user, p.kitchenId);
  const date = p.date ?? todayKTM();
  const pii = piiOf(user);
  const rows = await db.order.findMany({
    where: { kitchenId: kitchen.id, deliveryDate: dateOnly(date), status: "FAILED_DELIVERY" },
    include: { deliveryEvents: { where: { type: "FAILED" }, orderBy: { createdAt: "desc" }, take: 1 }, assignment: { include: { route: { select: { id: true, name: true } } } } },
    orderBy: { updatedAt: "desc" },
  });
  return {
    kitchen,
    date,
    failed: rows.map((o) => ({
      orderId: o.id,
      number: o.number,
      deliveryDate: ymd(o.deliveryDate),
      contactName: o.contactName,
      contactPhone: pii.phone(o.contactPhone),
      area: o.area,
      placeName: o.placeName,
      route: o.assignment ? { id: o.assignment.route.id, name: o.assignment.route.name } : null,
      reason: o.deliveryEvents[0]?.note ?? null,
      failedAt: iso(o.deliveryEvents[0]?.createdAt),
    })),
  };
});
