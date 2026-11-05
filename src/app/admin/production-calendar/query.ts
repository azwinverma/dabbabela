import "server-only";
import type { OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, type PermissionSubject } from "@/lib/permissions";
import { addDays, dateOnly, isoDate, isValidISODate, todayKTM, weekStartOf } from "@/lib/dates";
import { COOK_STATUSES } from "@/server/transitions";
import { scopeIds, type KitchenScoped } from "@/components/admin/ops/scope";

/** Orders that commit the kitchen to cook: paid/secured and not cancelled or skipped (same set the kitchen forecast uses). */
export const COMMITTED_STATUSES: OrderStatus[] = [...COOK_STATUSES];
export const MAX_WEEKS = 6;

export type CalendarCell = { meals: number; planMeals: number; pending: number };
export type CalendarRow = { key: string; boxId: string | null; name: string; perDay: Record<string, number>; total: number };

/**
 * Aggregate production calendar: committed meals per day × dabba (and per kitchen) for `weeks` weeks from the week of
 * `from`, built from booked orders (plan meals are already orders, created at purchase). Awaiting-payment meals are
 * counted separately and never in the committed totals.
 */
export async function productionCalendar(user: KitchenScoped & Exclude<PermissionSubject, string | null>, opts: { from?: string | null; weeks?: number | null; kitchenId?: string | null } = {}) {
  if (!can(user, "kitchen.view")) throw new Error("You don't have access to the production calendar");
  const weeks = Math.max(1, Math.min(MAX_WEEKS, Math.trunc(opts.weeks ?? 2) || 2));
  const start = weekStartOf(opts.from && isValidISODate(opts.from) ? opts.from : todayKTM());
  const end = addDays(start, weeks * 7 - 1);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));

  const scope = scopeIds(user);
  const kitchens = await db.kitchen.findMany({ where: { isActive: true, ...(scope ? { id: { in: scope } } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, code: true } });
  const chosen = opts.kitchenId ? kitchens.filter((k) => k.id === opts.kitchenId) : kitchens;
  const kitchenIds = chosen.map((k) => k.id);

  const items = kitchenIds.length
    ? await db.orderItem.findMany({
        where: { order: { kitchenId: { in: kitchenIds }, deliveryDate: { gte: dateOnly(start), lte: dateOnly(end) }, status: { in: [...COMMITTED_STATUSES, "PENDING_PAYMENT"] } } },
        select: { quantity: true, boxId: true, customBoxId: true, name: true, order: { select: { kitchenId: true, deliveryDate: true, subscriptionId: true, status: true } } },
      })
    : [];

  const rows = new Map<string, CalendarRow>();
  const cells = new Map<string, CalendarCell>(); // `${kitchenId}|${date}`
  const perDay: Record<string, CalendarCell> = Object.fromEntries(days.map((d) => [d, { meals: 0, planMeals: 0, pending: 0 }]));
  let meals = 0;
  let pending = 0;
  for (const it of items) {
    const date = isoDate(it.order.deliveryDate);
    const cellKey = `${it.order.kitchenId}|${date}`;
    const cell = cells.get(cellKey) ?? { meals: 0, planMeals: 0, pending: 0 };
    if (it.order.status === "PENDING_PAYMENT") {
      cell.pending += it.quantity;
      perDay[date].pending += it.quantity;
      pending += it.quantity;
      cells.set(cellKey, cell);
      continue;
    }
    cell.meals += it.quantity;
    perDay[date].meals += it.quantity;
    if (it.order.subscriptionId) {
      cell.planMeals += it.quantity;
      perDay[date].planMeals += it.quantity;
    }
    cells.set(cellKey, cell);
    meals += it.quantity;
    const key = it.boxId ?? "custom";
    const row = rows.get(key) ?? { key, boxId: it.boxId, name: it.boxId ? it.name : "Build-a-Dabba (custom)", perDay: {}, total: 0 };
    row.perDay[date] = (row.perDay[date] ?? 0) + it.quantity;
    row.total += it.quantity;
    rows.set(key, row);
  }
  return {
    start,
    end,
    weeks,
    days,
    kitchens,
    chosen,
    rows: [...rows.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    cell: (kitchenId: string, date: string) => cells.get(`${kitchenId}|${date}`) ?? { meals: 0, planMeals: 0, pending: 0 },
    perDay,
    totals: { meals, pending, planMeals: Object.values(perDay).reduce((a, c) => a + c.planMeals, 0) },
  };
}
