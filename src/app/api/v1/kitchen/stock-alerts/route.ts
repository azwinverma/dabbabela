import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readQuery } from "@/server/api/http";
import { pickApiKitchen } from "@/server/api/auth";
import { expiringLotAlerts, lowStockAlerts } from "@/server/inventory";

export const dynamic = "force-dynamic";

const q = z.object({ kitchenId: z.string().max(64).optional(), expiringDays: z.coerce.number().int().min(1).max(14).optional() });

/**
 * Read-only stock alerts for one kitchen in scope: low stock (at/below reorder point) and lots expiring soon / expired —
 * the same functions as /admin/inventory/health. Fixing stock stays on the web (inventory.edit).
 */
export const GET = apiRoute({ auth: { permission: ["kitchen.view", "inventory.view"] } }, async ({ req, user }) => {
  const p = readQuery(req, q);
  const kitchen = await pickApiKitchen(user, p.kitchenId);
  const [low, expiring] = await Promise.all([lowStockAlerts([kitchen.id]), expiringLotAlerts([kitchen.id], p.expiringDays ?? 3)]);
  return {
    kitchen,
    alerts: [...low, ...expiring].map((a) => ({ type: a.type, severity: a.severity, entity: a.entity, entityId: a.entityId, message: a.message, data: a.data })),
  };
});
