"use server";

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dateOnly } from "@/lib/dates";
import { done, fail, type ActionResult } from "@/lib/action";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveKitchen(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules", async (user) => {
    const name = f.str(fd, "name", 100);
    const code = f.str(fd, "code", 20).toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!name) throw new FieldError("name", "Name is required");
    if (!code) throw new FieldError("code", "Short code is required, e.g. KTM-1");
    const data = { name, code, city: f.str(fd, "city", 60) || "Kathmandu", address: f.opt(fd, "address", 300), phone: f.opt(fd, "phone", 30), dailyCapacity: f.int(fd, "dailyCapacity", 300, 0, 100000), isActive: f.bool(fd, "isActive") };
    const before = id ? await db.kitchen.findUnique({ where: { id } }) : null;
    if (id && before?.isActive && !data.isActive) {
      const live = await db.order.count({ where: { kitchenId: id, status: { in: ["SCHEDULED", "PENDING_PAYMENT", "CONFIRMED"] } } });
      if (live) return fail(`${live} upcoming orders belong to this kitchen. Move or handle them before closing it.`);
    }
    const k = id ? await db.kitchen.update({ where: { id }, data }) : await db.kitchen.create({ data });
    await audit({ actorId: user.id, action: id ? "kitchen.update" : "kitchen.create", entity: "Kitchen", entityId: k.id, summary: k.name, before, after: data });
    return done(id ? "Kitchen saved" : "Kitchen added", id ? undefined : `/admin/kitchens/${k.id}`);
  }, ["/admin/kitchens"]);
}

export async function saveSlot(kitchenId: string, id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules", async (user) => {
    const startTime = f.str(fd, "startTime");
    const endTime = f.str(fd, "endTime");
    if (!TIME.test(startTime) || !TIME.test(endTime)) return fail("Times must be HH:MM (24h)");
    if (endTime <= startTime) return fail("The window must end after it starts");
    const data = { label: f.str(fd, "label", 40) || `${startTime} – ${endTime}`, startTime, endTime, capacity: f.int(fd, "capacity", 80, 0, 10000), isActive: f.bool(fd, "isActive"), sortOrder: f.int(fd, "sortOrder", 0) };
    const before = id ? await db.deliverySlot.findUnique({ where: { id } }) : null;
    const s = id ? await db.deliverySlot.update({ where: { id }, data }) : await db.deliverySlot.create({ data: { ...data, kitchenId } });
    await audit({ actorId: user.id, action: id ? "slot.update" : "slot.create", entity: "DeliverySlot", entityId: s.id, summary: s.label, before, after: data });
    return done("Delivery window saved");
  }, [`/admin/kitchens/${kitchenId}`]);
}

export async function saveCapacity(kitchenId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("rules", async (user) => {
    const date = f.date(fd, "date");
    if (!date) return fail("Pick a date");
    const maxMeals = f.int(fd, "maxMeals", -1, -1, 100000);
    if (maxMeals < 0) return fail("Enter the meal limit for that day");
    const row = await db.kitchenCapacity.upsert({
      where: { kitchenId_date: { kitchenId, date: dateOnly(date) } },
      create: { kitchenId, date: dateOnly(date), maxMeals, note: f.opt(fd, "note", 200) },
      update: { maxMeals, note: f.opt(fd, "note", 200) },
    });
    await audit({ actorId: user.id, action: "capacity.set", entity: "Kitchen", entityId: kitchenId, summary: `${date}: ${maxMeals} meals`, after: row, reason: row.note });
    return done("Capacity set for that day (existing orders are kept)");
  }, [`/admin/kitchens/${kitchenId}`]);
}

export async function deleteCapacity(id: string): Promise<ActionResult> {
  return guarded("rules", async (user) => {
    const r = await db.kitchenCapacity.delete({ where: { id } });
    await audit({ actorId: user.id, action: "capacity.clear", entity: "Kitchen", entityId: r.kitchenId, before: r });
    return done();
  }, ["/admin/kitchens"]);
}
