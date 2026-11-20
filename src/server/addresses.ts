import "server-only";
import { z } from "zod";
import type { AddressType } from "@prisma/client";
import { db } from "@/lib/db";
import { isNepalPhone, normalizeNepalPhone } from "@/lib/phone";
import { findZone } from "./coverage";
import { parsePin, PinError } from "./customer-dashboard";

/**
 * Customer address book rules, shared by the web account actions (src/lib/actions/account.ts) and the mobile API
 * (/api/v1/addresses): validation, optional map pin, delivery-zone linking, the 10-address limit, default handling
 * and the archive rule (orders keep their snapshot; a live plan blocks removal).
 */

const TYPES: AddressType[] = ["HOME", "OFFICE", "SHOP", "COLLEGE", "SITE", "OTHER"];

export const addressSchema = z.object({
  label: z.string().trim().min(1, "Give it a name").max(40),
  type: z.enum(["HOME", "OFFICE", "SHOP", "COLLEGE", "SITE", "OTHER"]),
  recipientName: z.string().trim().min(2, "Who receives it?").max(80),
  phone: z.string().trim().refine(isNepalPhone, "Enter a Nepal phone number"),
  placeName: z.string().trim().max(120).optional(),
  line1: z.string().trim().min(3, "Street, tole or building").max(200),
  area: z.string().trim().min(2, "Locality, e.g. Baneshwor").max(80),
  ward: z.coerce.number().int().min(1).max(40).optional(),
  municipality: z.string().trim().max(80).optional(),
  city: z.string().trim().min(2).max(60).default("Kathmandu"),
  landmark: z.string().trim().max(160).optional(),
  instructions: z.string().trim().max(300).optional(),
});

/** Raw field values as they arrive (form strings or JSON values). Empty strings mean "not given". */
export type AddressRaw = Partial<Record<"label" | "type" | "recipientName" | "phone" | "placeName" | "line1" | "area" | "ward" | "municipality" | "city" | "landmark" | "instructions" | "lat" | "lng", unknown>>;

export type SaveAddressResult = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  addressId?: string;
  covered?: boolean;
  zoneName?: string | null;
  zoneId?: string | null;
};

type Owner = { id: string; addresses: { id: string }[] };

const s = (v: unknown) => (v == null ? "" : typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Create (no `id`) or update one of the owner's addresses. */
export async function saveAddress(owner: Owner, raw: AddressRaw, opts: { id?: string | null; isDefault?: boolean } = {}): Promise<SaveAddressResult> {
  const opt = (k: keyof AddressRaw) => s(raw[k]) || undefined;
  const parsed = addressSchema.safeParse({
    label: s(raw.label) || "Address",
    type: TYPES.includes(s(raw.type) as AddressType) ? s(raw.type) : "OFFICE",
    recipientName: s(raw.recipientName),
    phone: s(raw.phone),
    placeName: opt("placeName"),
    line1: s(raw.line1),
    area: s(raw.area),
    ward: opt("ward"),
    municipality: opt("municipality"),
    city: opt("city") ?? "Kathmandu",
    landmark: opt("landmark"),
    instructions: opt("instructions"),
  });
  // Optional map pin: both or neither, inside Nepal (same rule as Account → Addresses → map pin).
  let pin: { lat: number; lng: number } | null = null;
  let pinError: string | null = null;
  try {
    pin = parsePin(raw.lat, raw.lng);
  } catch (err) {
    if (!(err instanceof PinError)) throw err;
    pinError = err.message;
  }
  if (!parsed.success || pinError) {
    const errors: Record<string, string> = {};
    for (const i of parsed.success ? [] : parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    if (pinError) errors.lat = errors.lng = pinError;
    return { ok: false, message: pinError && parsed.success ? pinError : "Check the highlighted fields", errors };
  }
  const d = parsed.data;
  const zone = await findZone({ area: d.area, ward: d.ward ?? null, municipality: d.municipality ?? null, city: d.city });
  const id = opts.id ?? "";
  const makeDefault = Boolean(opts.isDefault) || owner.addresses.length === 0;
  const data = {
    ...d,
    phone: normalizeNepalPhone(d.phone)!,
    placeName: d.placeName ?? null,
    ward: d.ward ?? null,
    municipality: d.municipality ?? null,
    landmark: d.landmark ?? null,
    instructions: d.instructions ?? null,
    lat: pin?.lat ?? null,
    lng: pin?.lng ?? null,
    zoneId: zone?.id ?? null,
  };
  let addressId = id;
  if (id) {
    const own = owner.addresses.find((a) => a.id === id);
    if (!own) return { ok: false, message: "Address not found" };
    await db.address.update({ where: { id }, data });
  } else {
    if (owner.addresses.length >= 10) return { ok: false, message: "You can keep up to 10 addresses — remove one first" };
    addressId = (await db.address.create({ data: { ...data, userId: owner.id } })).id;
  }
  if (makeDefault) {
    await db.address.updateMany({ where: { userId: owner.id, id: { not: addressId } }, data: { isDefault: false } });
    await db.address.update({ where: { id: addressId }, data: { isDefault: true } });
  }
  return {
    ok: true,
    addressId,
    covered: Boolean(zone),
    zoneName: zone?.name ?? null,
    zoneId: zone?.id ?? null,
    message: zone ? `Saved — we deliver here (${zone.name})` : `Saved. We don't deliver to ${d.area} yet — we'll let you know when we do.`,
  };
}

/** Archive one of the owner's addresses (refused while a live plan delivers there). */
export async function archiveAddress(owner: Owner, id: string): Promise<{ ok: boolean; message: string }> {
  if (!owner.addresses.find((a) => a.id === id)) return { ok: false, message: "Address not found" };
  const live = await db.subscription.count({ where: { addressId: id, status: { in: ["ACTIVE", "PAUSED", "PENDING_PAYMENT"] } } });
  if (live) return { ok: false, message: "A meal plan still delivers here — move the plan to another address first" };
  await db.address.update({ where: { id }, data: { archivedAt: new Date(), isDefault: false } });
  return { ok: true, message: "Address removed" };
}

export async function setDefaultAddress(owner: Owner, id: string): Promise<{ ok: boolean; message: string }> {
  if (!owner.addresses.find((a) => a.id === id)) return { ok: false, message: "Address not found" };
  await db.address.updateMany({ where: { userId: owner.id }, data: { isDefault: false } });
  await db.address.update({ where: { id }, data: { isDefault: true } });
  return { ok: true, message: "Default address updated" };
}
