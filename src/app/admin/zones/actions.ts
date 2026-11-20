"use server";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { rs } from "@/lib/money";
import { CoverageError, parseBandLines, parseZoneRules, quoteCoverage, relinkUncoveredAddresses, validateZoneRules, zoneRulesJson } from "@/server/coverage";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

/** Zone rules from the form: origin pin, distance bands ("km, Rs" per line), served slots. */
async function readRules(fd: FormData, kitchenId: string) {
  const lat = f.str(fd, "originLat", 30);
  const lng = f.str(fd, "originLng", 30);
  if (!!lat !== !!lng) throw new FieldError("originLat", "Enter both latitude and longitude (or neither)");
  const origin = lat && lng ? { lat: Number(lat), lng: Number(lng) } : null;
  const slotIds = f.all(fd, "slotIds");
  if (slotIds.length) {
    const ok = await db.deliverySlot.count({ where: { id: { in: slotIds }, kitchenId } });
    if (ok !== new Set(slotIds).size) throw new FieldError("slotIds", "Pick time windows of the serving kitchen");
  }
  try {
    return validateZoneRules({ origin, bands: parseBandLines(f.str(fd, "bands", 4000)), slotIds });
  } catch (e) {
    if (e instanceof CoverageError) throw new FieldError("bands", e.message);
    throw e;
  }
}

export async function saveZone(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules.edit", async (user) => {
    const name = f.str(fd, "name", 100);
    if (!name) throw new FieldError("name", "Name is required");
    const kitchenId = f.str(fd, "kitchenId");
    if (!kitchenId || !(await db.kitchen.findUnique({ where: { id: kitchenId } }))) throw new FieldError("kitchenId", "Pick the kitchen that serves this zone");
    const areas = [...new Set(f.list(fd, "areas"))];
    if (!areas.length) throw new FieldError("areas", "List at least one locality");
    const rules = await readRules(fd, kitchenId);
    const rulesJson = zoneRulesJson(rules);
    const data = {
      distanceRules: rulesJson ?? Prisma.DbNull,
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
    const relinked = { count: await relinkUncoveredAddresses() };
    const feeChanged = !!before && (before.fee !== data.fee || before.freeAbove !== data.freeAbove || before.minOrder !== data.minOrder || JSON.stringify(parseZoneRules(before.distanceRules)) !== JSON.stringify(rules));
    await audit({ actorId: user.id, action: id ? (feeChanged ? "zone.fee_change" : "zone.update") : "zone.create", entity: "DeliveryZone", entityId: z.id, summary: z.name, before, after: { ...data, distanceRules: rulesJson } });
    return done(`Zone saved${relinked.count ? ` · ${relinked.count} waiting customer address(es) now covered` : ""}`, id ? undefined : `/admin/zones/${z.id}`);
  }, ["/admin/zones", "/delivery-areas"]);
}

export async function testArea(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules.edit", async () => {
    const area = f.str(fd, "area", 80);
    const ward = f.intOpt(fd, "ward");
    const municipality = f.opt(fd, "municipality", 80);
    const lat = f.str(fd, "lat", 30);
    const lng = f.str(fd, "lng", 30);
    if (!area && !ward) return fail("Type a locality or ward");
    const label = area || `ward ${ward}`;
    const q = await quoteCoverage({ area, ward, municipality, lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null });
    if (!q.zone) return fail(`✗ "${label}" isn't covered by any active zone`);
    const fee = q.fee.basis === "distance" ? `${rs(q.fee.fee)} (${q.fee.distanceKm} km band)` : `${rs(q.fee.fee)} flat`;
    const windows = q.slots.map((s) => s.label).join(", ") || "none";
    return q.serviceable ? done(`✓ "${label}" → ${q.zone.name} (${q.zone.kitchen.name}), delivery ${fee}; windows: ${windows}`) : fail(`✗ "${label}" → ${q.zone.name}: ${q.reason}`);
  });
}

export async function toggleZone(id: string): Promise<ActionResult> {
  return guarded("rules.edit", async (user) => {
    const z = await db.deliveryZone.findUnique({ where: { id } });
    if (!z) return fail("Not found");
    await db.deliveryZone.update({ where: { id }, data: { isActive: !z.isActive } });
    await audit({ actorId: user.id, action: z.isActive ? "zone.pause" : "zone.activate", entity: "DeliveryZone", entityId: id, summary: z.name });
    return done(z.isActive ? "Zone paused — new orders here are blocked; existing ones still go out" : "Zone active");
  }, ["/admin/zones"]);
}
