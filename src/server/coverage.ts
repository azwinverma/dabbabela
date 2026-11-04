import { db } from "@/lib/db";

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .trim();

/**
 * Coverage lookup by locality / ward text. No GPS promises: we match what the customer types
 * against the areas each zone lists. Returns null when the area isn't served yet.
 */
export async function findZone(input: { area?: string | null; ward?: number | null; municipality?: string | null; city?: string | null }) {
  const zones = await db.deliveryZone.findMany({ where: { isActive: true, kitchen: { isActive: true } }, include: { kitchen: true }, orderBy: { sortOrder: "asc" } });
  const area = norm(input.area ?? "");
  const muni = norm(input.municipality ?? "");
  const wardKey = input.ward && muni ? `${muni.split(" ")[0]}-${input.ward}` : null;
  if (!area && !wardKey) return null;
  // exact area match first, then prefix / contains, then ward code
  for (const pass of [0, 1, 2]) {
    for (const z of zones) {
      if (input.city && norm(z.city) !== norm(input.city)) continue;
      const areas = z.areas.map(norm);
      if (pass === 0 && area && areas.includes(area)) return z;
      if (pass === 1 && area && areas.some((a) => a.length > 3 && (area.includes(a) || a.includes(area)))) return z;
      if (pass === 2 && wardKey && z.wards.map(norm).includes(norm(wardKey))) return z;
    }
  }
  return null;
}

/** Public search results for the coverage page. */
export async function searchCoverage(q: string) {
  const term = norm(q);
  if (term.length < 2) return [];
  const zones = await db.deliveryZone.findMany({ where: { isActive: true }, include: { kitchen: { select: { name: true } }, }, orderBy: { sortOrder: "asc" } });
  return zones
    .map((z) => ({ zone: z, matches: z.areas.filter((a) => norm(a).includes(term) || term.includes(norm(a))) }))
    .filter((r) => r.matches.length || norm(r.zone.name).includes(term));
}
