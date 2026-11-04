import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateOnly, isoDate } from "@/lib/dates";
import { audit } from "@/lib/audit";
import { rs } from "@/lib/money";
import { nextServiceDates } from "./calendar";
import { assertDayCapacity, lockKitchenDay } from "./capacity";
import { cancelOrder, setOrderStatus } from "./orders";
import { skipMeal } from "./subscriptions";
import { notify } from "./notify";

/**
 * Bandh / strike / weather / unplanned closure on a date that already has orders.
 * MOVE: single orders move to the next service day (capacity permitting, else credited);
 *       plan meals are skipped and appended to the end of the plan.
 * CREDIT: every order is cancelled and its paid value credited to the wallet.
 * The date is added to the closure calendar so nothing new can be booked. Everyone is notified.
 */
export async function handleDisruption(input: { date: string; kitchenId: string | null; reason: string; kind: string; outcome: "MOVE" | "CREDIT"; actorId: string }) {
  const settings = await getSettings();
  await db.holiday.upsert({
    where: { date_kitchenId: { date: dateOnly(input.date), kitchenId: input.kitchenId as string } },
    create: { date: dateOnly(input.date), name: input.reason, kind: input.kind, kitchenId: input.kitchenId },
    update: { name: input.reason, kind: input.kind },
  }).catch(async () => {
    // Prisma can't upsert on a compound unique with a null member — fall back.
    const existing = await db.holiday.findFirst({ where: { date: dateOnly(input.date), kitchenId: input.kitchenId } });
    if (!existing) await db.holiday.create({ data: { date: dateOnly(input.date), name: input.reason, kind: input.kind, kitchenId: input.kitchenId } });
  });
  const orders = await db.order.findMany({
    where: { deliveryDate: dateOnly(input.date), ...(input.kitchenId ? { kitchenId: input.kitchenId } : {}), status: { in: ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING"] } },
    include: { subscription: true },
  });
  const report = { moved: 0, credited: 0, creditedAmount: 0, cancelled: 0, failed: [] as string[] };
  const staff = { id: input.actorId, isStaff: true };
  for (const o of orders) {
    try {
      // Locked/preparing orders first go back to SCHEDULED so the normal flows apply.
      if (o.status === "CONFIRMED" || o.status === "PREPARING") {
        await db.order.update({ where: { id: o.id }, data: { status: "SCHEDULED" } });
        await db.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: o.status, toStatus: "SCHEDULED", note: `Unlocked: ${input.reason}`, actorId: input.actorId } });
      }
      if (o.subscriptionId && input.outcome === "MOVE") {
        await skipMeal(o.id, staff, null);
        report.moved++;
        void notify("service.disruption", { userId: o.userId }, { date: input.date, reason: input.reason, outcome: "Your meal moves to the end of your plan." }, { dedupeKey: `disrupt:${o.id}` });
        continue;
      }
      if (!o.subscriptionId && input.outcome === "MOVE") {
        const [next] = await nextServiceDates(input.date, 1, settings.deliveryDays, settings, o.kitchenId);
        if (next) {
          const ok = await db
            .$transaction(async (tx) => {
              await lockKitchenDay(tx, o.kitchenId, next);
              await assertDayCapacity(tx, { kitchenId: o.kitchenId, date: next, meals: 1, slotId: o.slotId });
              await tx.order.update({ where: { id: o.id }, data: { deliveryDate: dateOnly(next), version: { increment: 1 } } });
              await tx.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: "SCHEDULED", toStatus: "SCHEDULED", note: `Moved ${input.date} → ${next}: ${input.reason}`, actorId: input.actorId } });
              return true;
            })
            .catch(() => false);
          if (ok) {
            report.moved++;
            void notify("service.disruption", { userId: o.userId }, { date: input.date, reason: input.reason, outcome: `We'll bring it on ${next} instead. Cancel from your account for full credit.` }, { dedupeKey: `disrupt:${o.id}` });
            continue;
          }
        }
      }
      const r = await cancelOrder(o.id, staff, { reason: `${input.reason} (${input.date})`, settlement: "CREDIT" });
      if (r.amount) {
        report.credited++;
        report.creditedAmount += r.amount;
      } else report.cancelled++;
      void notify("service.disruption", { userId: o.userId }, { date: input.date, reason: input.reason, outcome: r.amount ? `${rs(r.amount)} is back in your credit.` : "Your order is cancelled." }, { dedupeKey: `disrupt:${o.id}` });
    } catch (e) {
      report.failed.push(`${o.number}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await audit({ actorId: input.actorId, action: "service.disruption", entity: "Holiday", entityId: input.date, summary: `${input.reason}: ${orders.length} orders`, after: report });
  return { total: orders.length, ...report };
}

export { setOrderStatus, isoDate };
