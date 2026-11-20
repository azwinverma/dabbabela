import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readQuery, ymd } from "@/server/api/http";
import { pickApiKitchen } from "@/server/api/auth";
import { allergenWarning, forecast, kitchenOrders } from "@/server/kitchen";
import { isValidISODate, todayKTM } from "@/lib/dates";

export const dynamic = "force-dynamic";

const q = z.object({
  kitchenId: z.string().max(64).optional(),
  date: z.string().refine(isValidISODate, "Use YYYY-MM-DD").optional(),
  bufferPct: z.coerce.number().int().min(0).max(30).optional(),
});

/**
 * Production list for one kitchen-day (same data as /admin/kitchen): demand by box / dish / diet / allergen and the
 * orders the kitchen cooks, with their status and allergen notes. `kitchenId` defaults to the first kitchen in scope.
 */
export const GET = apiRoute({ auth: { permission: "kitchen.view" } }, async ({ req, user }) => {
  const p = readQuery(req, q);
  const kitchen = await pickApiKitchen(user, p.kitchenId);
  const date = p.date ?? todayKTM();
  const [fc, orders] = await Promise.all([forecast(kitchen.id, date, p.bufferPct ?? 5), kitchenOrders(kitchen.id, date)]);
  return {
    kitchen,
    date,
    summary: { orders: fc.orders, meals: fc.meals, pendingPayment: fc.pendingPayment, allergenFlagged: fc.allergenFlagged, bufferPct: fc.bufferPct },
    boxes: fc.boxes,
    dishes: fc.dishes.map((d) => ({ menuItemId: d.menuItemId, name: d.name, station: d.station, portions: d.portions, buffer: d.buffer, total: d.total })),
    diets: fc.diets,
    allergens: fc.allergens,
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      deliveryDate: ymd(o.deliveryDate),
      slotLabel: o.slotLabel,
      area: o.area,
      placeName: o.placeName,
      customerName: o.user?.name ?? o.contactName,
      allergenNote: o.allergenNote,
      allergenWarning: allergenWarning(o),
      ticketPrinted: Boolean(o.ticket?.printedAt),
      lastPackingCheck: o.packing[0] ? { ok: o.packing[0].itemsOk && o.packing[0].labelOk && o.packing[0].allergenOk && o.packing[0].sealedOk, note: o.packing[0].note } : null,
      items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, diet: i.diet, customizations: i.customizations.map((c) => c.label) })),
    })),
  };
});
