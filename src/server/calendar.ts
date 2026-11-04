import type { Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import type { SiteSettings } from "@/lib/settings";
import { addDays, dateOnly, isoDate, isValidISODate, ktmNow, weekdayOf } from "@/lib/dates";

export type Closures = Map<string, string>;

/** Holidays/closures for a kitchen (kitchen-specific + global) in [from, to]. */
export async function getClosures(from: string, to: string, kitchenId?: string | null): Promise<Closures> {
  const rows = await db.holiday.findMany({
    where: {
      date: { gte: dateOnly(from), lte: dateOnly(to) },
      OR: [{ kitchenId: null }, ...(kitchenId ? [{ kitchenId }] : [])],
    },
  });
  return new Map(rows.map((h) => [isoDate(h.date), h.name]));
}

/** Why a date can't take new orders/changes, or null. `cutoff` overrides the global cut-off (company setting). */
export function dateProblem(
  date: string,
  settings: Pick<SiteSettings, "orderCutoff" | "advanceDays" | "deliveryDays">,
  closures: Closures,
  opts: { cutoff?: string | null; now?: { date: string; time: string }; ignoreHorizon?: boolean } = {},
) {
  if (!isValidISODate(date)) return "Invalid date";
  const now = opts.now ?? ktmNow();
  const cutoff = opts.cutoff || settings.orderCutoff;
  if (date < now.date) return "That day has passed";
  if (date === now.date && now.time >= cutoff) return `Same-day orders close at ${cutoff}`;
  if (!opts.ignoreHorizon && date > addDays(now.date, settings.advanceDays)) return `We take orders up to ${settings.advanceDays} days ahead`;
  if (!settings.deliveryDays.includes(weekdayOf(date))) return "We don't deliver on this day";
  const c = closures.get(date);
  if (c) return `Kitchen closed — ${c}`;
  return null;
}

/** Is the change window for this date still open (before cut-off and not locked)? */
export async function changeWindowOpen(date: string, kitchenId: string, settings: SiteSettings, cutoff?: string | null) {
  const now = ktmNow();
  if (date < now.date) return false;
  if (date === now.date && now.time >= (cutoff || settings.orderCutoff)) return false;
  const lock = await db.dayLock.findUnique({ where: { kitchenId_date: { kitchenId, date: dateOnly(date) } } });
  return !lock;
}

/** Days a kitchen has already locked (no new orders). Without a kitchen, days locked by every active kitchen. */
export async function getLockedDates(from: string, to: string, kitchenId?: string | null) {
  const locks = await db.dayLock.findMany({ where: { date: { gte: dateOnly(from), lte: dateOnly(to) }, ...(kitchenId ? { kitchenId } : {}) }, select: { date: true, kitchenId: true } });
  if (kitchenId) return new Set(locks.map((l) => isoDate(l.date)));
  const kitchens = await db.kitchen.count({ where: { isActive: true } });
  const byDate = new Map<string, number>();
  for (const l of locks) byDate.set(isoDate(l.date), (byDate.get(isoDate(l.date)) ?? 0) + 1);
  return new Set([...byDate].filter(([, n]) => n >= Math.max(1, kitchens)).map(([d]) => d));
}

/** The next N dates customers can order for (closures and locked days excluded). */
export async function orderableDates(settings: SiteSettings, count = 14, kitchenId?: string | null) {
  const now = ktmNow();
  const horizon = addDays(now.date, settings.advanceDays);
  const [closures, locked] = await Promise.all([getClosures(now.date, horizon, kitchenId), getLockedDates(now.date, horizon, kitchenId)]);
  const out: string[] = [];
  for (let d = now.date; d <= horizon && out.length < count; d = addDays(d, 1)) {
    if (!dateProblem(d, settings, closures, { now }) && !locked.has(d)) out.push(d);
  }
  return out;
}

/**
 * Service dates for a plan: from `start`, `weeks` weeks, on the chosen weekdays, skipping closures.
 * A "monthly" plan is therefore defined in real service days, never "30 deliveries".
 */
export function planDatesFrom(start: string, weeks: number, days: Weekday[], deliveryDays: Weekday[], closures: Closures) {
  const end = addDays(start, weeks * 7 - 1);
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (days.includes(wd) && deliveryDays.includes(wd) && !closures.has(d)) out.push(d);
  }
  return out;
}

export async function planDates(start: string, weeks: number, days: Weekday[], settings: SiteSettings, kitchenId?: string | null) {
  const closures = await getClosures(start, addDays(start, weeks * 7 + 7), kitchenId);
  return planDatesFrom(start, weeks, days, settings.deliveryDays, closures);
}

/** Next `count` service dates strictly after `after` on the given weekdays. */
export async function nextServiceDates(after: string, count: number, days: Weekday[], settings: SiteSettings, kitchenId?: string | null, exclude: Set<string> = new Set()) {
  const closures = await getClosures(after, addDays(after, 180), kitchenId);
  const out: string[] = [];
  for (let d = addDays(after, 1); out.length < count && d <= addDays(after, 180); d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (days.includes(wd) && settings.deliveryDays.includes(wd) && !closures.has(d) && !exclude.has(d)) out.push(d);
  }
  return out;
}
