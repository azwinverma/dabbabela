import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { iso, readQuery, ymd } from "@/server/api/http";
import { pickApiKitchen } from "@/server/api/auth";
import { cashDue, isoDateStr, piiOf } from "@/server/api/ops-dto";
import { manifest, ridersForKitchen, routeCash, routeChanges } from "@/server/dispatch";
import { dateOnly, todayKTM } from "@/lib/dates";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const q = z.object({ kitchenId: z.string().max(64).optional(), date: isoDateStr.optional(), slotId: z.string().max(64).optional() });

/**
 * Dispatch board for a kitchen-day (same data as /admin/dispatch): the manifest grouped slot × zone → hand-off point,
 * orders not yet on a route, routes with rider / stops / cash, riders, slots, zones, failed deliveries and stops whose
 * delivery changed after routing. Phones are masked without customers.pii.
 */
export const GET = apiRoute({ auth: { permission: "dispatch.view" } }, async ({ req, user }) => {
  const p = readQuery(req, q);
  const kitchen = await pickApiKitchen(user, p.kitchenId);
  const date = p.date ?? todayKTM();
  const pii = piiOf(user);
  const [groups, slots, zones, riders, routes, failed] = await Promise.all([
    manifest(kitchen.id, date, p.slotId || null),
    db.deliverySlot.findMany({ where: { kitchenId: kitchen.id, isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true, startTime: true, endTime: true } }),
    db.deliveryZone.findMany({ where: { kitchenId: kitchen.id, isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    ridersForKitchen(kitchen.id),
    db.deliveryRoute.findMany({
      where: { kitchenId: kitchen.id, date: dateOnly(date) },
      include: { rider: { select: { id: true, name: true, phoneNumber: true } }, slot: { select: { label: true } }, assignments: { orderBy: { sequence: "asc" }, include: { order: { select: { id: true, number: true, status: true, area: true, placeName: true, contactName: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    db.order.findMany({ where: { kitchenId: kitchen.id, deliveryDate: dateOnly(date), status: "FAILED_DELIVERY" }, include: { deliveryEvents: { where: { type: "FAILED" }, orderBy: { createdAt: "desc" }, take: 1 } } }),
  ]);
  const cash = new Map(await Promise.all(routes.map(async (r) => [r.id, await routeCash(r.id)] as const)));
  const changes = await routeChanges(routes.map((r) => r.id));
  const orderDto = (o: (typeof groups)[number]["stops"][number]["orders"][number]) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    contactName: o.contactName,
    contactPhone: pii.phone(o.contactPhone),
    meals: o.items.reduce((a, i) => a + i.quantity, 0),
    paymentMethod: o.payment?.method ?? null,
    cashDue: cashDue(o),
    route: o.assignment ? { id: o.assignment.route.id, name: o.assignment.route.name } : null,
  });
  const all = groups.flatMap((g) => g.stops.flatMap((s) => s.orders));
  return {
    kitchen,
    date,
    summary: {
      orders: all.length,
      handOffPoints: groups.reduce((a, g) => a + g.stops.length, 0),
      unrouted: all.filter((o) => !o.assignment && o.status !== "DELIVERED").length,
      out: all.filter((o) => o.status === "OUT_FOR_DELIVERY").length,
      failed: failed.length,
      changedAfterRouting: changes.size,
    },
    groups: groups.map((g) => ({
      slot: g.slot,
      zoneId: g.zoneId,
      zone: g.zone,
      stops: g.stops.map((s) => ({ key: s.key, placeName: s.placeName, area: s.area, landmark: s.landmark, company: s.company, office: s.office, instructions: s.instructions, meals: s.meals, cash: s.cash, orders: s.orders.map(orderDto) })),
    })),
    unrouted: all.filter((o) => !o.assignment && o.status !== "DELIVERED").map(orderDto),
    routes: routes.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      slotId: r.slotId,
      slotLabel: r.slot?.label ?? null,
      zoneId: r.zoneId,
      rider: r.rider ? { id: r.rider.id, name: r.rider.name, phone: pii.phone(r.rider.phoneNumber) } : null,
      cost: r.cost,
      startedAt: iso(r.startedAt),
      completedAt: iso(r.completedAt),
      cash: cash.get(r.id) ?? null,
      stops: r.assignments.map((a) => ({ sequence: a.sequence, orderId: a.order.id, number: a.order.number, status: a.order.status, area: a.order.area, placeName: a.order.placeName, contactName: a.order.contactName, changed: changes.get(a.order.id) ?? null })),
    })),
    riders: riders.map((r) => ({ id: r.id, name: r.name, phone: pii.phone(r.phone), vehicle: r.vehicle, zoneIds: r.zoneIds, available: r.available })),
    slots,
    zones,
    failed: failed.map((o) => ({ orderId: o.id, number: o.number, deliveryDate: ymd(o.deliveryDate), contactName: o.contactName, area: o.area, reason: o.deliveryEvents[0]?.note ?? null, failedAt: iso(o.deliveryEvents[0]?.createdAt) })),
  };
});
