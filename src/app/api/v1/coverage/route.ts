import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { badRequest, readQuery } from "@/server/api/http";
import { inValley, quoteCoverage, searchCoverage, valleyZone } from "@/server/coverage";

export const dynamic = "force-dynamic";

const q = z.object({
  /** Free-text locality search (like the /delivery-areas page). */
  q: z.string().trim().max(80).optional(),
  /** Or an address check: area (+ ward, municipality, city, optional pin) → zone, fee, time windows. */
  area: z.string().trim().max(80).optional(),
  ward: z.coerce.number().int().min(1).max(40).optional(),
  municipality: z.string().trim().max(80).optional(),
  city: z.string().trim().max(60).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/**
 * Coverage lookup. `?q=` → named zone matches (and, when nothing is listed by name but the place is in the Kathmandu
 * Valley, the valley-wide zone — same honest answer as the website). `?area=…` → the exact address answer used at
 * checkout: serviceable, zone, delivery fee for a day (paisa), delivery windows.
 */
export const GET = apiRoute({ auth: "public", limit: "read" }, async ({ req }) => {
  const p = readQuery(req, q);
  if (p.area) {
    const r = await quoteCoverage({ area: p.area, ward: p.ward ?? null, municipality: p.municipality ?? null, city: p.city ?? "Kathmandu", lat: p.lat ?? null, lng: p.lng ?? null });
    return {
      mode: "address",
      serviceable: r.serviceable,
      reason: r.reason,
      zone: r.zone ? { id: r.zone.id, name: r.zone.name, kitchenId: r.zone.kitchenId } : null,
      fee: r.fee ? { amount: r.fee.fee, basis: r.fee.basis, distanceKm: r.fee.distanceKm, beyond: r.fee.beyond } : null,
      slots: r.slots.map((s) => ({ id: s.id, label: s.label, startTime: s.startTime, endTime: s.endTime })),
    };
  }
  if (!p.q || p.q.length < 2) throw badRequest("Send ?q= (at least 2 letters) or ?area=", { q: "At least 2 letters" });
  const results = await searchCoverage(p.q);
  // Not listed by name: the valley catch-all may still cover it — said honestly, without claiming the place.
  const valley = !results.length ? await valleyZone() : null;
  return {
    mode: "search",
    query: p.q,
    matches: results.map((r) => ({ zoneId: r.zone.id, zone: r.zone.name, kitchen: r.zone.kitchen.name, areas: r.matches, fee: r.zone.fee })),
    /** Present when nothing matched by name but a Kathmandu Valley catch-all zone exists: covered only if the place is inside the valley. */
    valleyWide: valley ? { zoneId: valley.id, zone: valley.name, fee: valley.fee, etaNote: valley.etaNote, looksInValley: inValley(p.q), note: `"${p.q}" isn't on our list by name. If it's inside the Kathmandu Valley, you're covered — add it as your address. Outside the valley we don't deliver yet.` } : null,
    listedByName: results.length > 0,
  };
});
