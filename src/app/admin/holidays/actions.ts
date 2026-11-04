"use server";

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dateOnly } from "@/lib/dates";
import { done, fail, type ActionResult } from "@/lib/action";
import { rs } from "@/lib/money";
import { handleDisruption } from "@/server/disruption";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";

const KINDS = ["HOLIDAY", "BANDH", "WEATHER", "CLOSURE"];
const LIVE = ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING"] as const;

export async function addHoliday(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules", async (user) => {
    const date = f.date(fd, "date");
    const name = f.str(fd, "name", 100);
    const kind = KINDS.includes(f.str(fd, "kind")) ? f.str(fd, "kind") : "HOLIDAY";
    const kitchenId = f.opt(fd, "kitchenId");
    if (!date || !name) return fail("Date and name are required");
    const affected = await db.order.count({ where: { deliveryDate: dateOnly(date), status: { in: [...LIVE] }, ...(kitchenId ? { kitchenId } : {}) } });
    if (affected) return fail(`${affected} order(s) are already booked for ${date}. Use “Handle a disruption” below so customers are moved or credited.`);
    const exists = await db.holiday.findFirst({ where: { date: dateOnly(date), kitchenId } });
    if (exists) return fail("That date is already closed");
    const h = await db.holiday.create({ data: { date: dateOnly(date), name, kind, kitchenId } });
    await audit({ actorId: user.id, action: "closure.create", entity: "Holiday", entityId: h.id, summary: `${date} ${name}`, after: h });
    return done("Closure added — nobody can book that day");
  }, ["/admin/holidays", "/menu"]);
}

export async function deleteHoliday(id: string): Promise<ActionResult> {
  return guarded("rules", async (user) => {
    const h = await db.holiday.delete({ where: { id } });
    await audit({ actorId: user.id, action: "closure.delete", entity: "Holiday", entityId: id, before: h });
    return done("Day re-opened for orders");
  }, ["/admin/holidays", "/menu"]);
}

export async function runDisruption(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules", async (user) => {
    const date = f.date(fd, "date");
    const reason = f.str(fd, "reason", 120);
    const kind = KINDS.includes(f.str(fd, "kind")) ? f.str(fd, "kind") : "BANDH";
    const outcome = f.str(fd, "outcome") === "CREDIT" ? "CREDIT" : "MOVE";
    const kitchenId = f.opt(fd, "kitchenId");
    if (!date || !reason) return fail("Pick the date and say why (customers see the reason)");
    if (f.str(fd, "confirm") !== "yes") return fail("Tick the confirmation box");
    const r = await handleDisruption({ date, kitchenId, reason, kind, outcome, actorId: user.id });
    return done(
      `Done for ${date}: ${r.total} order(s) — ${r.moved} moved, ${r.credited} credited (${rs(r.creditedAmount)}), ${r.cancelled} cancelled unpaid${r.failed.length ? `, ${r.failed.length} need attention: ${r.failed.slice(0, 3).join("; ")}` : ""}. Customers have been notified.`,
    );
  }, ["/admin/holidays", "/admin/orders"]);
}
