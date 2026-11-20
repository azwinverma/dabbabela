import { apiRoute } from "@/server/api/route";
import { notFound, readJson } from "@/server/api/http";
import { addressDto, addressInput, throwIfFailed } from "@/server/api/customer-dto";
import { archiveAddress, saveAddress } from "@/server/addresses";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type P = { id: string };

/**
 * Update one of the caller's addresses. Omitted fields keep their stored value (send `lat: null, lng: null` to remove
 * the pin); the result is re-validated with the full address rules and the zone re-linked. Another customer's address → 404.
 */
export const PATCH = apiRoute<"user", P>({ auth: "user", limit: "write" }, async ({ req, user, params }) => {
  const own = user.addresses.find((a) => a.id === params.id);
  if (!own) throw notFound("Address not found");
  const { isDefault, ...b } = await readJson(req, addressInput);
  // Partial update: fill omitted fields from the stored address, then run the full shared validation.
  const raw = {
    label: b.label ?? own.label,
    type: b.type ?? own.type,
    recipientName: b.recipientName ?? own.recipientName,
    phone: b.phone ?? own.phone,
    placeName: b.placeName === undefined ? own.placeName : b.placeName,
    line1: b.line1 ?? own.line1,
    area: b.area ?? own.area,
    ward: b.ward === undefined ? own.ward : b.ward,
    municipality: b.municipality === undefined ? own.municipality : b.municipality,
    city: b.city ?? own.city,
    landmark: b.landmark === undefined ? own.landmark : b.landmark,
    instructions: b.instructions === undefined ? own.instructions : b.instructions,
    lat: b.lat === undefined ? own.lat : b.lat,
    lng: b.lng === undefined ? own.lng : b.lng,
  };
  const r = await saveAddress(user, raw, { id: own.id, isDefault });
  throwIfFailed(r);
  const a = await db.address.findUniqueOrThrow({ where: { id: own.id }, include: { zone: true } });
  return { message: r.message, covered: r.covered, address: addressDto(a) };
});

/** Remove (archive) an address. Refused while a meal plan still delivers there. Past orders keep their snapshot. */
export const DELETE = apiRoute<"user", P>({ auth: "user", limit: "write" }, async ({ user, params }) => {
  const r = await archiveAddress(user, params.id);
  throwIfFailed(r);
  return { message: r.message };
});
