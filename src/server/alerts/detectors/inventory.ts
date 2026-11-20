import "server-only";
import { inventoryAlerts } from "@/server/inventory";
import { sev, type Detector, type Finding } from "../types";

const HREF: Record<string, string> = {
  LOW_STOCK: "/admin/inventory/health",
  EXPIRING_STOCK: "/admin/inventory/lots",
  EXPIRED_STOCK: "/admin/inventory/lots",
  UNEXPECTED_CONSUMPTION: "/admin/inventory/variance",
  STOCK_DISCREPANCY: "/admin/inventory/health",
  STOCK_SHORTAGE: "/admin/inventory/health",
  LATE_SUPPLIER_DELIVERY: "/admin/inventory/purchases",
};

/**
 * Low stock, expiring/expired lots, unexpected consumption, ledger-vs-lot discrepancies and late supplier
 * deliveries — WP-08's `inventoryAlerts()` read functions, all kitchens. Their dedupe keys are kept, except the
 * consumption key drops its date range so a running overuse stays one alert instead of a new one each day.
 */
export const inventory: Detector = {
  name: "inventory",
  label: "Low stock, expiring ingredients and stock problems",
  mode: "condition",
  async run() {
    const rows = await inventoryAlerts(null);
    return rows.map(
      (a): Finding => ({
        type: a.type,
        severity: sev(a.severity),
        entity: a.entity,
        entityId: a.entityId,
        kitchenId: a.kitchenId,
        key: a.type === "UNEXPECTED_CONSUMPTION" ? `consumption:${a.kitchenId}:${a.entityId}` : a.dedupeKey,
        message: a.message,
        href: HREF[a.type] ?? "/admin/inventory",
        data: a.data,
      }),
    );
  },
};
