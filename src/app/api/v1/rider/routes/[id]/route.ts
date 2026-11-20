import { apiRoute } from "@/server/api/route";
import { notFound, ymd } from "@/server/api/http";
import { cashDue } from "@/server/api/ops-dto";
import { FAILED_REASONS, riderRoute } from "@/server/dispatch";
import { getSettings } from "@/lib/settings";
import { formatNepalPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/**
 * One route with its stops in sequence (same data as the web rider route page). Riders: own routes only; staff:
 * their kitchens'. Anything else → 404. The customer's hand-off code is never included — the rider asks for it.
 */
export const GET = apiRoute<{ permission: "rider.view" }, { id: string }>({ auth: { permission: "rider.view" } }, async ({ user, params }) => {
  const r = await riderRoute(user, params.id);
  if (!r) throw notFound("Route not found");
  const s = await getSettings();
  const isRider = user.role === "DELIVERY_AGENT";
  return {
    id: r.id,
    name: r.name,
    date: ymd(r.date),
    status: r.status,
    slotLabel: r.slot?.label ?? null,
    cashCollected: r.cashCollected,
    readOnly: r.readOnly,
    openStops: r.assignments.filter((a) => a.order.status === "OUT_FOR_DELIVERY").length,
    /** What the deliver form must ask for (staff acting from the rider app need neither). */
    requires: { otp: s.flags.deliveryOtp && isRider, photo: s.flags.deliveryPhoto && isRider },
    failureReasons: [...FAILED_REASONS, "Other"],
    stops: r.assignments.map((a, i) => {
      const o = a.order;
      return {
        sequence: i + 1,
        orderId: o.id,
        number: o.number,
        code: o.code,
        status: o.status,
        canAct: o.status === "OUT_FOR_DELIVERY" && !r.readOnly,
        placeName: o.placeName,
        addressLine: o.addressLine,
        area: o.area,
        ward: o.ward,
        landmark: o.landmark,
        instructions: o.instructions,
        contactName: o.contactName,
        contactPhone: o.contactPhone,
        contactPhoneDisplay: formatNepalPhone(o.contactPhone) || o.contactPhone,
        allergenNote: o.allergenNote,
        items: o.items.map((it) => ({ name: it.name, quantity: it.quantity })),
        paymentMethod: o.payment?.method ?? null,
        paymentStatus: o.paymentStatus,
        cashDue: cashDue(o),
      };
    }),
  };
});
