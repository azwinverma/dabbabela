import { apiRoute } from "@/server/api/route";
import { appFlags } from "@/server/api/dto";
import { getSettings } from "@/lib/settings";
import { availableMethods } from "@/server/payments/methods";
import { todayKTM } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** Public app bootstrap: brand, contact, ordering rules, payment methods currently offered, app feature flags. */
export const GET = apiRoute({ auth: "public", limit: "read" }, async () => {
  const s = await getSettings();
  return {
    brand: { name: s.brandName, nameNe: s.brandNameNe, legalName: s.legalName, tagline: s.tagline, taglineNe: s.taglineNe, panVat: s.panVat },
    contact: { phone: s.phone, whatsapp: s.whatsapp, email: s.email, address: s.address, hours: s.hours },
    social: { facebook: s.facebook, instagram: s.instagram, tiktok: s.tiktok },
    ordering: {
      today: todayKTM(),
      timeZone: "Asia/Kathmandu",
      orderCutoff: s.orderCutoff,
      advanceDays: s.advanceDays,
      deliveryDays: s.deliveryDays,
      minOrderAmount: s.minOrderAmount,
      freeDeliveryAbove: s.freeDeliveryAbove,
      skipPolicy: s.skipPolicy,
      cancelBeforeCutoff: s.cancelBeforeCutoff,
      builderMinPrice: s.builderMinPrice,
      builderMaxQty: s.builderMaxQty,
    },
    paymentMethods: await availableMethods(s, { hasCompany: false, customerShare: 1 }), // checkout re-checks per cart (company billing, wallet balance)
    maintenance: { on: s.maintenanceMode, message: s.maintenanceMode ? s.maintenanceMessage : null },
    currency: { code: "NPR", minorUnit: "paisa", factor: 100 },
    flags: appFlags(s),
  };
});
