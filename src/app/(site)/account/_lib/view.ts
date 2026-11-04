import type { CurrentUser } from "@/lib/auth";
import type { AddressView } from "@/components/site/DeliveryFields";

export function toAddressViews(user: CurrentUser): AddressView[] {
  return user.addresses.map((a) => ({
    id: a.id,
    label: a.label,
    type: a.type,
    recipientName: a.recipientName,
    phone: a.phone,
    placeName: a.placeName,
    line1: a.line1,
    area: a.area,
    ward: a.ward,
    municipality: a.municipality,
    city: a.city,
    landmark: a.landmark,
    instructions: a.instructions,
    lat: a.lat,
    lng: a.lng,
    isDefault: a.isDefault,
    zoneId: a.zone?.isActive ? a.zoneId : null,
    zoneName: a.zone?.isActive ? a.zone.name : null,
    kitchenId: a.zone?.isActive ? a.zone.kitchenId : null,
  }));
}
