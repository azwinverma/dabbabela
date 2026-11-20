import "server-only";
import { db } from "@/lib/db";
import { addDays, dateOnly } from "@/lib/dates";
import { dayCapacity, mealsBooked } from "@/server/capacity";
import { batchShortages, productionDashboard } from "@/server/kitchen";
import { minutesOf, sev, slug, type Detector, type Finding } from "../types";

/** Minutes before the first delivery slot by which every batch should be DONE. */
export const PREP_LEAD_MINUTES = 60;

/** Orders beyond kitchen capacity: booked meals above the day's limit (override or daily capacity), today and the next 3 days. */
export const overCapacity: Detector = {
  name: "over-capacity",
  label: "Orders beyond kitchen capacity",
  mode: "condition",
  async run({ today, kitchens }) {
    const out: Finding[] = [];
    for (const k of kitchens) {
      for (let i = 0; i <= 3; i++) {
        const date = addDays(today, i);
        const [limit, booked] = await Promise.all([dayCapacity(k.id, date), mealsBooked(k.id, date)]);
        if (booked <= limit) continue;
        out.push({
          type: "OVER_CAPACITY",
          severity: "CRITICAL",
          entity: "Kitchen",
          entityId: k.id,
          kitchenId: k.id,
          key: `${k.id}:${date}`,
          message: `${k.name}: ${booked} meals booked on ${date}, limit ${limit}`,
          href: `/admin/kitchens/${k.id}`,
          data: { date, booked, limit },
        });
      }
    }
    return out;
  },
};

/**
 * Production: today's production issues from the kitchen dashboard (critical and warning; over-capacity is its
 * own detector), shortages recorded by finished batches, and delayed production — batches not DONE
 * `PREP_LEAD_MINUTES` before the kitchen's first delivery slot.
 */
export const production: Detector = {
  name: "production",
  label: "Production issues and delays",
  mode: "condition",
  async run({ today, time, kitchens }) {
    const out: Finding[] = [];
    for (const k of kitchens) {
      const href = `/admin/kitchen?kitchen=${k.id}&date=${today}`;
      const dash = await productionDashboard(k.id, today).catch(() => null);
      for (const issue of dash?.issues ?? []) {
        if (issue.severity === "info" || issue.message.startsWith("Over capacity")) continue;
        out.push({ type: "PRODUCTION_ISSUE", severity: sev(issue.severity), entity: "Kitchen", entityId: k.id, kitchenId: k.id, key: `${k.id}:${today}:${slug(issue.message)}`, message: `${k.name}: ${issue.message}`, href: issue.href ?? href, data: { date: today } });
      }
      const recorded = dash?.shortages.recorded ?? (await batchShortages(k.id, today));
      for (const s of recorded)
        out.push({ type: "BATCH_SHORTAGE", severity: "WARNING", entity: "ProductionBatch", entityId: s.batchId, kitchenId: k.id, key: `shortage:${s.batchId}:${s.ingredientId}`, message: `${k.name}: ${s.dish} used ${s.shortage} ${String(s.unit).toLowerCase()} of ${s.name} that wasn't in stock`, href, data: { date: today, ...s, at: undefined } });

      const firstSlot = await db.deliverySlot.findFirst({ where: { kitchenId: k.id, isActive: true }, orderBy: { startTime: "asc" }, select: { startTime: true } });
      if (!firstSlot) continue;
      const due = minutesOf(firstSlot.startTime) - PREP_LEAD_MINUTES;
      if (minutesOf(time) < due) continue;
      const late = await db.productionBatch.findMany({ where: { kitchenId: k.id, date: dateOnly(today), status: { in: ["PLANNED", "COOKING"] } }, select: { id: true, status: true, menuItem: { select: { name: true } } } });
      for (const b of late) {
        const by = `${String(Math.floor(due / 60)).padStart(2, "0")}:${String(due % 60).padStart(2, "0")}`;
        out.push({ type: "PRODUCTION_DELAYED", severity: "CRITICAL", entity: "ProductionBatch", entityId: b.id, kitchenId: k.id, key: `delayed:${b.id}`, message: `${k.name}: ${b.menuItem.name} is still ${b.status.toLowerCase()} — should be done by ${by}`, href, data: { date: today, status: b.status, dueBy: by } });
      }
    }
    return out;
  },
};
