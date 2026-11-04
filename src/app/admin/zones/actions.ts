"use server";

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { rs } from "@/lib/money";
import { findZone } from "@/server/coverage";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

export async function saveZone(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules", async (user) => {
    const name = f.str(fd, "name", 100);
    if (!name) throw new FieldError("name", "Name is required");
    const kitchenId = f.str(fd, "kitchenId");
    if (!kitchenId || !(await db.kitchen.findUnique({ where: { id: kitchenId } }))) throw new FieldError("kitchenId", "Pick the kitchen that serves this zone");
    const areas = [...new Set(f.list(fd, "areas"))];
    if (!areas.length) throw new FieldError("areas", "List at least one locality");
    const data = {
      name,
      city: f.str(fd, "city", 60) || "Kathmandu",
      kitchenId,
      areas,
      wards: [...new Set(f.list(fd, "wards").map((w) => w.toUpperCase()))],
      fee: f.money(fd, "fee", "Delivery fee"),
      freeAbove: f.moneyOpt(fd, "freeAbove", "Free above"),
      minOrder: f.moneyOpt(fd, "minOrder", "Minimum order") ?? 0,
      etaNote: f.opt(fd, "etaNote", 80),
      isActive: f.bool(fd, "isActive"),
      sortOrder: f.int(fd, "sortOrder", 0),
    };
    const before = id ? await db.deliveryZone.findUnique({ where: { id } }) : null;
    if (before && before.kitchenId !== kitchenId) {
      const live = await db.order.count({ where: { zoneId: id!, status: { in: ["SCHEDULED", "PENDING_PAYMENT", "CONFIRMED"] } } });
      if (live) return fail(`${live} upcoming orders in this zone are booked with the current kitchen. Change the kitchen after they're delivered.`);
    }
    // a locality should belong to one zone only
    const clash = await db.deliveryZone.findFirst({ where: { id: id ? { not: id } : undefined, isActive: true, areas: { hasSome: areas } }, select: { name: true, areas: true } });
    if (clash && data.isActive) return fail(`${clash.areas.filter((a) => areas.includes(a)).join(", ")} already belong(s) to ${clash.name}`);
    const z = id ? await db.deliveryZone.update({ where: { id }, data }) : await db.deliveryZone.create({ data });
    // re-link saved addresses in these areas that had no zone yet
    const relinked = await db.address.updateMany({ where: { zoneId: null, archivedAt: null, area: { in: areas, mode: "insensitive" } }, data: { zoneId: z.id } });
    await audit({ actorId: user.id, action: id ? "zone.update" : "zone.create", entity: "DeliveryZone", entityId: z.id, summary: z.name, before, after: data });
    return done(`Zone saved${relinked.count ? ` · ${relinked.count} waiting customer address(es) now covered` : ""}`, id ? undefined : `/admin/zones/${z.id}`);
  }, ["/admin/zones", "/delivery-areas"]);
}

export async function testArea(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules", async () => {
    const area = f.str(fd, "area", 80);
    const ward = f.intOpt(fd, "ward");
    const municipality = f.opt(fd, "municipality", 80);
    if (!area && !ward) return fail("Type a locality or ward");
    const z = await findZone({ area, ward, municipality });
    return z ? done(`✓ "${area || `ward ${ward}`}" → ${z.name} (${z.kitchen.name}), delivery ${rs(z.fee)}`) : fail(`✗ "${area || `ward ${ward}`}" isn't covered by any active zone`);
  });
}

export async function toggleZone(id: string): Promise<ActionResult> {
  return guarded("rules", async (user) => {
    const z = await db.deliveryZone.findUnique({ where: { id } });
    if (!z) return fail("Not found");
    await db.deliveryZone.update({ where: { id }, data: { isActive: !z.isActive } });
    await audit({ actorId: user.id, action: z.isActive ? "zone.pause" : "zone.activate", entity: "DeliveryZone", entityId: id, summary: z.name });
    return done(z.isActive ? "Zone paused — new orders here are blocked; existing ones still go out" : "Zone active");
  }, ["/admin/zones"]);
}
