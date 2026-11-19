"use server";

import type { Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";
import { clearCapacityOverride, setCapacityOverride, setDailyCapacity, type KitchenStatus } from "@/server/capacity";
import { assignKitchenManager, assignStaffToKitchen, removeStaffFromKitchen, requireKitchenInScope, saveKitchenHours, setKitchenStatus } from "@/server/kitchen";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export async function saveKitchen(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules.edit", async (user) => {
    if (id) requireKitchenInScope(user, id);
    else if (user.kitchenIds) return fail("Only staff with access to every kitchen can add a kitchen");
    const name = f.str(fd, "name", 100);
    const code = f.str(fd, "code", 20).toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!name) throw new FieldError("name", "Name is required");
    if (!code) throw new FieldError("code", "Short code is required, e.g. KTM-1");
    const dailyCapacity = f.int(fd, "dailyCapacity", 300, 0, 100000);
    const data = { name, code, city: f.str(fd, "city", 60) || "Kathmandu", address: f.opt(fd, "address", 300), phone: f.opt(fd, "phone", 30), isActive: f.bool(fd, "isActive") };
    const before = id ? await db.kitchen.findUnique({ where: { id }, select: { name: true, code: true, city: true, address: true, phone: true, isActive: true } }) : null;
    if (id && before?.isActive && !data.isActive) {
      const live = await db.order.count({ where: { kitchenId: id, status: { in: ["SCHEDULED", "PENDING_PAYMENT", "CONFIRMED"] } } });
      if (live) return fail(`${live} upcoming orders belong to this kitchen. Move or handle them before archiving it.`);
    }
    const k = id ? await db.kitchen.update({ where: { id }, data }) : await db.kitchen.create({ data: { ...data, dailyCapacity } });
    if (id) await setDailyCapacity(user, id, dailyCapacity);
    await audit({ actorId: user.id, action: id ? "kitchen.update" : "kitchen.create", entity: "Kitchen", entityId: k.id, summary: k.name, before, after: id ? data : { ...data, dailyCapacity } });
    return done(id ? "Kitchen saved" : "Kitchen added", id ? undefined : `/admin/kitchens/${k.id}`);
  }, ["/admin/kitchens"]);
}

/** Open / pause / shut down. The service checks rules.edit (or kitchen.approve for a pause) and audits. */
export async function setStatusAction(kitchenId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules.view", async (user) => {
    const status = f.str(fd, "status") as KitchenStatus;
    const r = await setKitchenStatus(user, kitchenId, status, f.opt(fd, "reason", 300));
    if (!r.changed) return done("No change");
    const kept = r.upcoming ? ` ${r.upcoming} upcoming order(s) are kept — move or cancel them from Orders if needed.` : "";
    return done(status === "OPEN" ? "Kitchen reopened — taking orders again." : status === "PAUSED" ? `New orders paused.${kept}` : `Kitchen shut down — no new orders.${kept}`);
  }, ["/admin/kitchens", `/admin/kitchens/${kitchenId}`, "/admin/kitchen"]);
}

export async function saveHoursAction(kitchenId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules.edit", async (user) => {
    const openTime = f.str(fd, "openTime");
    const closeTime = f.str(fd, "closeTime");
    const workingDays = f.all(fd, "workingDays").filter((d): d is Weekday => (DAYS as string[]).includes(d));
    const changed = await saveKitchenHours(user, kitchenId, { openTime, closeTime, workingDays });
    return done(changed ? "Hours saved" : "No change");
  }, [`/admin/kitchens/${kitchenId}`]);
}

export async function assignManagerAction(kitchenId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules.edit", async (user) => {
    const changed = await assignKitchenManager(user, kitchenId, f.opt(fd, "managerId", 60));
    return done(changed ? "Manager updated" : "No change");
  }, [`/admin/kitchens/${kitchenId}`, "/admin/kitchens"]);
}

export async function assignStaffAction(kitchenId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("staff.edit", async (user) => {
    const userId = f.str(fd, "userId", 60);
    if (!userId) return fail("Pick a staff member");
    const changed = await assignStaffToKitchen(user, kitchenId, userId);
    return done(changed ? "Added to this kitchen" : "Already assigned");
  }, [`/admin/kitchens/${kitchenId}`]);
}

export async function removeStaffAction(kitchenId: string, userId: string): Promise<ActionResult> {
  return guarded("staff.edit", async (user) => {
    await removeStaffFromKitchen(user, kitchenId, userId);
    return done("Removed from this kitchen");
  }, [`/admin/kitchens/${kitchenId}`]);
}

export async function saveSlot(kitchenId: string, id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules.edit", async (user) => {
    requireKitchenInScope(user, kitchenId);
    const startTime = f.str(fd, "startTime");
    const endTime = f.str(fd, "endTime");
    if (!TIME.test(startTime) || !TIME.test(endTime)) return fail("Times must be HH:MM (24h)");
    if (endTime <= startTime) return fail("The window must end after it starts");
    const data = { label: f.str(fd, "label", 40) || `${startTime} – ${endTime}`, startTime, endTime, capacity: f.int(fd, "capacity", 80, 0, 10000), isActive: f.bool(fd, "isActive"), sortOrder: f.int(fd, "sortOrder", 0) };
    const before = id ? await db.deliverySlot.findUnique({ where: { id } }) : null;
    if (id && before?.kitchenId !== kitchenId) return fail("That window belongs to another kitchen");
    const s = id ? await db.deliverySlot.update({ where: { id }, data }) : await db.deliverySlot.create({ data: { ...data, kitchenId } });
    await audit({ actorId: user.id, action: id ? "slot.update" : "slot.create", entity: "DeliverySlot", entityId: s.id, summary: s.label, before, after: data });
    return done("Delivery window saved");
  }, [`/admin/kitchens/${kitchenId}`]);
}

export async function saveCapacity(kitchenId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules.edit", async (user) => {
    const date = f.date(fd, "date");
    if (!date) return fail("Pick a date");
    const maxMeals = f.int(fd, "maxMeals", -1, -1, 100000);
    if (maxMeals < 0) return fail("Enter the meal limit for that day");
    const r = await setCapacityOverride(user, { kitchenId, date, maxMeals, note: f.opt(fd, "note", 200) });
    return done(r.over ? `Capacity set. ${r.booked} meals are already booked (${r.over} over) — they are kept.` : "Capacity set for that day (existing orders are kept)");
  }, [`/admin/kitchens/${kitchenId}`]);
}

export async function deleteCapacity(id: string): Promise<ActionResult> {
  return guarded("rules.edit", async (user) => {
    await clearCapacityOverride(user, id);
    return done();
  }, ["/admin/kitchens"]);
}
