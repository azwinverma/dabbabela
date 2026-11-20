import { db } from "@/lib/db";

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .trim();

/** Area marker for a catch-all zone: it serves any address inside the Kathmandu Valley that no named zone lists. */
export const VALLEY_WILDCARD = "*";

/** Municipalities / city names inside the Kathmandu Valley (normalised, first words are enough to match). */
const VALLEY_PLACES = [
  "kathmandu", "ktm", "lalitpur", "patan", "bhaktapur", "kirtipur", "madhyapur thimi", "thimi", "budhanilkantha",
  "tokha", "tarakeshwar", "nagarjun", "chandragiri", "dakshinkali", "kageshwori manohara", "kageshwori", "gokarneshwor",
  "shankharapur", "godawari", "mahalaxmi", "changunarayan", "suryabinayak", "konjyosom", "bagmati",
  "kmc", "lmc", "bmc", "काठमाडौं", "काठमाडौँ", "ललितपुर", "भक्तपुर", "कीर्तिपुर",
];

/** True when a city / municipality string names a place inside the Kathmandu Valley. */
export function inValley(place?: string | null) {
  const p = norm(place ?? "");
  if (!p) return false;
  return VALLEY_PLACES.some((v) => p === v || p.startsWith(`${v} `) || p.includes(` ${v} `) || p.endsWith(` ${v}`));
}

/** Two cities count as the same when equal, or both inside the valley (Sanepa may be typed as Kathmandu or Lalitpur). */
const sameCity = (a: string, b: string) => norm(a) === norm(b) || (inValley(a) && inValley(b));

/**
 * Coverage lookup by locality / ward text. No GPS promises: we match what the customer types
 * against the areas each zone lists. A zone whose areas include "*" catches every other address in
 * the Kathmandu Valley. Returns null when the area isn't served yet.
 */
export async function findZone(input: { area?: string | null; ward?: number | null; municipality?: string | null; city?: string | null }) {
  const zones = await db.deliveryZone.findMany({ where: { isActive: true, kitchen: { isActive: true } }, include: { kitchen: true }, orderBy: { sortOrder: "asc" } });
  const area = norm(input.area ?? "");
  const muni = norm(input.municipality ?? "");
  const wardKey = input.ward && muni ? `${muni.split(" ")[0]}-${input.ward}` : null;
  if (!area && !wardKey) return null;
  // the address's place: city, else municipality; a blank city is the default (Kathmandu)
  const place = input.city?.trim() || input.municipality?.trim() || "Kathmandu";
  const addressInValley = inValley(input.city) || inValley(input.municipality) || (!input.city && !input.municipality);
  // exact area match first, then prefix / contains, then ward code, then the valley catch-all
  for (const pass of [0, 1, 2, 3]) {
    for (const z of zones) {
      const areas = z.areas.map(norm).filter(Boolean);
      const wildcard = z.areas.includes(VALLEY_WILDCARD);
      if (pass === 3) {
        if (wildcard && addressInValley && inValley(z.city)) return z;
        continue;
      }
      if (input.city && !sameCity(z.city, place)) continue;
      if (pass === 0 && area && areas.includes(area)) return z;
      if (pass === 1 && area && areas.some((a) => a.length > 3 && (area.includes(a) || a.includes(area)))) return z;
      if (pass === 2 && wardKey && z.wards.map(norm).includes(norm(wardKey))) return z;
    }
  }
  return null;
}

/**
 * Re-run the lookup for saved, non-archived addresses that have no zone yet (after a zone is added or widened).
 * Returns how many were linked.
 */
export async function relinkUncoveredAddresses(client: { address: typeof db.address } = db) {
  const waiting = await client.address.findMany({ where: { zoneId: null, archivedAt: null }, select: { id: true, area: true, ward: true, municipality: true, city: true } });
  let linked = 0;
  for (const a of waiting) {
    const z = await findZone(a);
    if (!z) continue;
    await client.address.update({ where: { id: a.id }, data: { zoneId: z.id } });
    linked++;
  }
  return linked;
}

/** Public search results for the coverage page. */
export async function searchCoverage(q: string) {
  const term = norm(q);
  if (term.length < 2) return [];
  const zones = await db.deliveryZone.findMany({ where: { isActive: true }, include: { kitchen: { select: { name: true } }, }, orderBy: { sortOrder: "asc" } });
  const named = zones
    .map((z) => ({ zone: z, matches: z.areas.filter((a) => a !== VALLEY_WILDCARD && (norm(a).includes(term) || term.includes(norm(a)))) }))
    .filter((r) => r.matches.length || norm(r.zone.name).includes(term));
  if (named.length) return named;
  // nothing named: the valley catch-all zone (if any) covers it, as long as the place is inside the valley
  const valley = zones.find((z) => z.areas.includes(VALLEY_WILDCARD));
  return valley ? [{ zone: valley, matches: [] as string[] }] : [];
}

// ───────────── WP-13: distance fee bands, zone time windows ─────────────
//
// `DeliveryZone.distanceRules` (Json) holds optional zone rules:
//   { origin: { lat, lng } | null, bands: [{ maxKm, fee }], slotIds: string[] }
// A bare array is read as `bands` (the shape noted in the schema). Distance is a straight-line
// (haversine) estimate from the zone's origin to the address pin, used only when both are known;
// otherwise the flat zone fee applies. Nothing here tracks riders.

export type DistanceBand = { maxKm: number; fee: number };
export type ZoneRules = { origin: { lat: number; lng: number } | null; bands: DistanceBand[]; slotIds: string[] };
export type LatLng = { lat?: number | null; lng?: number | null } | null | undefined;

export class CoverageError extends Error {}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const validPoint = (p: { lat?: unknown; lng?: unknown } | null | undefined): p is { lat: number; lng: number } =>
  !!p && isNum(p.lat) && isNum(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
const isBand = (b: unknown): b is DistanceBand => {
  const x = b as DistanceBand | null;
  return !!x && isNum(x.maxKm) && x.maxKm > 0 && Number.isInteger(x.fee) && x.fee >= 0;
};

/** Read zone rules leniently (bad rows are dropped); use `validateZoneRules` when saving. */
export function parseZoneRules(json: unknown): ZoneRules {
  const out: ZoneRules = { origin: null, bands: [], slotIds: [] };
  if (!json || typeof json !== "object") return out;
  const obj = (Array.isArray(json) ? { bands: json } : json) as Record<string, unknown>;
  const origin = obj.origin as { lat?: unknown; lng?: unknown } | undefined;
  if (validPoint(origin)) out.origin = { lat: origin.lat, lng: origin.lng };
  if (Array.isArray(obj.bands)) out.bands = obj.bands.filter(isBand).map((b) => ({ maxKm: b.maxKm, fee: b.fee })).sort((a, b) => a.maxKm - b.maxKm);
  if (Array.isArray(obj.slotIds)) out.slotIds = obj.slotIds.filter((s): s is string => typeof s === "string" && !!s);
  return out;
}

/** Strict check before saving. Fees are integer paisa; bands must strictly increase in distance. */
export function validateZoneRules(input: { origin?: { lat: number; lng: number } | null; bands?: DistanceBand[]; slotIds?: string[] }): ZoneRules {
  const bands = [...(input.bands ?? [])];
  for (const b of bands) {
    if (!isNum(b.maxKm) || b.maxKm <= 0 || b.maxKm > 100) throw new CoverageError("Each distance band needs a distance between 0 and 100 km");
    if (!Number.isInteger(b.fee) || b.fee < 0) throw new CoverageError("Each distance band needs a fee of Rs 0 or more");
  }
  bands.sort((a, b) => a.maxKm - b.maxKm);
  for (let i = 1; i < bands.length; i++) if (bands[i].maxKm === bands[i - 1].maxKm) throw new CoverageError(`Two bands end at ${bands[i].maxKm} km`);
  const origin = input.origin ?? null;
  if (origin && !validPoint(origin)) throw new CoverageError("The origin needs a valid latitude and longitude");
  if (bands.length && !origin) throw new CoverageError("Distance bands need the zone origin (latitude, longitude) to measure from");
  return { origin, bands: bands.map((b) => ({ maxKm: b.maxKm, fee: b.fee })), slotIds: [...new Set(input.slotIds ?? [])] };
}

/** Staff input: one band per line, "km, Rs" (e.g. "3, 50" → up to 3 km costs Rs 50). Fees become paisa. */
export function parseBandLines(text: string): DistanceBand[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(\d+(?:\.\d+)?)\s*(?:km)?\s*[,;:=\s]\s*(?:rs\.?\s*)?(\d+(?:\.\d{1,2})?)$/i.exec(l);
      if (!m) throw new CoverageError(`Couldn't read "${l}" — write each band as "km, Rs", e.g. "3, 50"`);
      return { maxKm: Number(m[1]), fee: Math.round(Number(m[2]) * 100) };
    });
}

/** Bands → the text the form shows. */
export function bandLines(bands: DistanceBand[]) {
  return bands.map((b) => `${b.maxKm}, ${b.fee % 100 ? (b.fee / 100).toFixed(2) : b.fee / 100}`).join("\n");
}

/** Rules → value for `DeliveryZone.distanceRules` (null when empty). */
export function zoneRulesJson(r: ZoneRules) {
  return r.bands.length || r.slotIds.length || r.origin ? { origin: r.origin, bands: r.bands, slotIds: r.slotIds } : null;
}

/** Straight-line distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type ZoneFeeQuote = { fee: number; distanceKm: number | null; band: DistanceBand | null; beyond: boolean; basis: "flat" | "distance" };

/**
 * Delivery fee per day for a zone and an optional address pin. This is the hook checkout pricing can
 * call to fill its ZoneSpec.fee. Flat `zone.fee` unless the zone has bands + origin and the pin is known.
 * Past the last band: `beyond` = true (outside the delivery radius) and the last band's fee is quoted.
 */
export function zoneFee(zone: { fee: number; distanceRules?: unknown }, pin?: LatLng): ZoneFeeQuote {
  const rules = parseZoneRules(zone.distanceRules);
  const point = validPoint(pin) ? { lat: pin.lat, lng: pin.lng } : null;
  if (!rules.bands.length || !rules.origin || !point) return { fee: zone.fee, distanceKm: null, band: null, beyond: false, basis: "flat" };
  const km = Math.round(haversineKm(rules.origin, point) * 100) / 100;
  const band = rules.bands.find((b) => km <= b.maxKm) ?? null;
  const last = rules.bands[rules.bands.length - 1];
  return { fee: (band ?? last).fee, distanceKm: km, band, beyond: !band, basis: "distance" };
}

/** Slots (time windows) a zone is served in: the zone's `slotIds` if set, else every slot of its kitchen. */
export function zoneSlots<S extends { id: string; kitchenId: string }>(zone: { kitchenId: string; distanceRules?: unknown }, slots: S[]) {
  const ids = parseZoneRules(zone.distanceRules).slotIds;
  return slots.filter((s) => s.kitchenId === zone.kitchenId && (!ids.length || ids.includes(s.id)));
}

/**
 * Full coverage answer for an address: zone (locality/ward match → serving kitchen), the fee for a
 * day (flat or distance band), its time windows, and whether it's serviceable.
 */
export async function quoteCoverage(input: Parameters<typeof findZone>[0] & { lat?: number | null; lng?: number | null }) {
  const zone = await findZone(input);
  if (!zone) return { serviceable: false as const, reason: "Area not covered by any active zone", zone: null, fee: null, slots: [] };
  const fee = zoneFee(zone, { lat: input.lat, lng: input.lng });
  const slots = zoneSlots(zone, await db.deliverySlot.findMany({ where: { kitchenId: zone.kitchenId, isActive: true }, orderBy: { sortOrder: "asc" } }));
  if (fee.beyond) return { serviceable: false as const, reason: `About ${fee.distanceKm} km away, beyond this zone's delivery radius`, zone, fee, slots };
  if (!slots.length) return { serviceable: false as const, reason: "No active delivery window for this zone", zone, fee, slots };
  return { serviceable: true as const, reason: null, zone, fee, slots };
}
