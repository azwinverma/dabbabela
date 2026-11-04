import { db } from "@/lib/db";
import { dateOnly, isoDate, ktmNow } from "@/lib/dates";
import type { SiteSettings } from "@/lib/settings";

/** Which of these orders can the customer still change (before cut-off, day not locked)? */
export async function changeable(orders: { id: string; kitchenId: string; deliveryDate: Date }[], settings: SiteSettings, cutoff?: string | null) {
  const now = ktmNow();
  const keys = [...new Set(orders.map((o) => `${o.kitchenId}|${isoDate(o.deliveryDate)}`))];
  const locks = keys.length
    ? await db.dayLock.findMany({ where: { OR: keys.map((k) => ({ kitchenId: k.split("|")[0], date: dateOnly(k.split("|")[1]) })) } })
    : [];
  const locked = new Set(locks.map((l) => `${l.kitchenId}|${isoDate(l.date)}`));
  const out = new Map<string, boolean>();
  for (const o of orders) {
    const d = isoDate(o.deliveryDate);
    const open = d > now.date || (d === now.date && now.time < (cutoff || settings.orderCutoff));
    out.set(o.id, open && !locked.has(`${o.kitchenId}|${d}`));
  }
  return out;
}
