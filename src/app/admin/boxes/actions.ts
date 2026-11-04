"use server";

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { slugify } from "@/lib/utils";
import { parseRupees } from "@/lib/money";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";
import { refreshBoxCosts } from "../_kit/costing";

const ACCENTS = ["achar", "turmeric", "saag", "charcoal"];

export async function saveBox(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu", async (user) => {
    const name = f.str(fd, "name", 120);
    if (!name) throw new FieldError("name", "Name is required");
    let rows: { menuItemId: string; quantity: number }[] = [];
    try {
      rows = JSON.parse(f.str(fd, "items", 20000) || "[]");
    } catch {
      return fail("Couldn't read the dabba contents");
    }
    rows = rows.filter((r) => r && typeof r.menuItemId === "string").map((r) => ({ menuItemId: r.menuItemId, quantity: Math.max(1, Math.min(5, Math.floor(Number(r.quantity) || 1))) }));
    if (!rows.length) return fail("Add at least one dish to the dabba");
    if (new Set(rows.map((r) => r.menuItemId)).size !== rows.length) return fail("A dish appears twice — use the quantity instead");
    const slug = slugify(f.str(fd, "slug") || name);
    if (!slug) throw new FieldError("slug", "Enter a URL name");
    const data = {
      name,
      nameNe: f.opt(fd, "nameNe", 120),
      slug,
      tagline: f.opt(fd, "tagline", 160),
      taglineNe: f.opt(fd, "taglineNe", 160),
      description: f.opt(fd, "description", 1500),
      descriptionNe: f.opt(fd, "descriptionNe", 1500),
      healthNote: f.opt(fd, "healthNote", 400),
      healthNoteNe: f.opt(fd, "healthNoteNe", 400),
      kitchenNote: f.opt(fd, "kitchenNote", 600),
      portionNote: f.opt(fd, "portionNote", 200),
      price: f.money(fd, "price", "Price"),
      image: f.opt(fd, "image", 500),
      accent: ACCENTS.includes(f.str(fd, "accent")) ? f.str(fd, "accent") : "achar",
      isSpecial: f.bool(fd, "isSpecial"),
      tags: f.list(fd, "tags").slice(0, 8),
      isActive: f.bool(fd, "isActive"),
      sortOrder: f.int(fd, "sortOrder", 0),
    };
    if (data.price <= 0) throw new FieldError("price", "Price must be above zero");
    const dishes = await db.menuItem.count({ where: { id: { in: rows.map((r) => r.menuItemId) } } });
    if (dishes !== rows.length) return fail("One of the dishes no longer exists");
    const before = id ? await db.lunchBox.findUnique({ where: { id }, include: { items: true } }) : null;
    const box = await db.$transaction(async (tx) => {
      const b = id ? await tx.lunchBox.update({ where: { id }, data }) : await tx.lunchBox.create({ data });
      await tx.boxItem.deleteMany({ where: { boxId: b.id } });
      await tx.boxItem.createMany({ data: rows.map((r, i) => ({ boxId: b.id, menuItemId: r.menuItemId, quantity: r.quantity, sortOrder: i })) });
      // substitutions whose "from" dish left the box no longer make sense
      await tx.boxSubstitution.deleteMany({ where: { boxId: b.id, fromItemId: { notIn: rows.map((r) => r.menuItemId) } } });
      return b;
    });
    await refreshBoxCosts({ boxId: box.id });
    await audit({ actorId: user.id, action: id ? "box.update" : "box.create", entity: "LunchBox", entityId: box.id, summary: box.name, before, after: { ...data, items: rows } });
    return done(id ? "Dabba saved" : "Dabba created", id ? undefined : `/admin/boxes/${box.id}`);
  }, ["/admin/boxes", "/menu"]);
}

export async function addSubstitution(boxId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("menu", async (user) => {
    const fromItemId = f.str(fd, "fromItemId");
    const toItemId = f.str(fd, "toItemId");
    if (!fromItemId || !toItemId) return fail("Pick both dishes");
    if (fromItemId === toItemId) return fail("Pick a different replacement");
    const inBox = await db.boxItem.findFirst({ where: { boxId, menuItemId: fromItemId } });
    if (!inBox) return fail("The dish being replaced must be in this dabba");
    const raw = f.str(fd, "priceDelta");
    const priceDelta = raw ? parseRupees(raw) : 0;
    if (priceDelta === null) return fail("Price change: enter rupees, e.g. -20 or 15");
    const sub = await db.boxSubstitution.upsert({
      where: { boxId_fromItemId_toItemId: { boxId, fromItemId, toItemId } },
      create: { boxId, fromItemId, toItemId, priceDelta },
      update: { priceDelta, isActive: true },
    });
    await audit({ actorId: user.id, action: "box.substitution", entity: "LunchBox", entityId: boxId, after: sub });
    return done("Swap saved");
  }, [`/admin/boxes/${boxId}`]);
}

export async function toggleSubstitution(id: string): Promise<ActionResult> {
  return guarded("menu", async (user) => {
    const s = await db.boxSubstitution.findUnique({ where: { id } });
    if (!s) return fail("Not found");
    await db.boxSubstitution.update({ where: { id }, data: { isActive: !s.isActive } });
    await audit({ actorId: user.id, action: "box.substitution_toggle", entity: "LunchBox", entityId: s.boxId, summary: s.isActive ? "off" : "on" });
    return done();
  }, ["/admin/boxes"]);
}

export async function deleteSubstitution(id: string): Promise<ActionResult> {
  return guarded("menu", async (user) => {
    const s = await db.boxSubstitution.delete({ where: { id } });
    await audit({ actorId: user.id, action: "box.substitution_delete", entity: "LunchBox", entityId: s.boxId, before: s });
    return done("Removed");
  }, ["/admin/boxes"]);
}

export async function toggleBox(id: string): Promise<ActionResult> {
  return guarded("menu", async (user) => {
    const b = await db.lunchBox.findUnique({ where: { id } });
    if (!b) return fail("Not found");
    await db.lunchBox.update({ where: { id }, data: { isActive: !b.isActive } });
    await audit({ actorId: user.id, action: b.isActive ? "box.archive" : "box.activate", entity: "LunchBox", entityId: id, summary: b.name });
    return done(b.isActive ? "Archived — it stays on past orders" : "Active again");
  }, ["/admin/boxes", "/menu"]);
}

export async function deleteBox(id: string): Promise<ActionResult> {
  return guarded("menu", async (user) => {
    const [orders, menus] = await Promise.all([db.orderItem.count({ where: { boxId: id } }), db.menuDayItem.count({ where: { boxId: id } })]);
    if (orders || menus) return fail(`On ${orders} order(s) and ${menus} menu day(s). Archive it instead.`);
    const b = await db.lunchBox.delete({ where: { id } });
    await audit({ actorId: user.id, action: "box.delete", entity: "LunchBox", entityId: id, summary: b.name, before: b });
    return done("Deleted", "/admin/boxes");
  }, ["/admin/boxes"]);
}
