"use server";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, done, type ActionResult } from "@/lib/action";

export async function setActiveAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("customers.pii");
  const id = String(fd.get("id"));
  const active = fd.get("active") === "true";
  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) return fail("Give a reason — it goes in the audit log");
  const u = await db.user.findUnique({ where: { id } });
  if (!u || u.role !== "CUSTOMER") return fail("Customer not found");
  await db.$transaction([db.user.update({ where: { id }, data: { isActive: active } }), ...(active ? [] : [db.session.deleteMany({ where: { userId: id } })])]);
  await audit({ actorId: actor.id, action: active ? "customer.reactivate" : "customer.deactivate", entity: "User", entityId: id, before: { isActive: u.isActive }, after: { isActive: active }, reason });
  return done(active ? "Reactivated" : "Deactivated and signed out everywhere");
}

export async function saveNoteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("customers");
  const id = String(fd.get("id"));
  const note = String(fd.get("note") ?? "").slice(0, 2000);
  const u = await db.user.findUnique({ where: { id }, select: { internalNote: true } });
  if (!u) return fail("Not found");
  await db.user.update({ where: { id }, data: { internalNote: note || null } });
  await audit({ actorId: actor.id, action: "customer.note", entity: "User", entityId: id, before: { note: u.internalNote }, after: { note } });
  return done("Note saved");
}

export async function openPrivacyRequestAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("privacy");
  const type = fd.get("type") === "DELETE" ? "DELETE" : "EXPORT";
  const userId = String(fd.get("id"));
  const open = await db.dataRequest.findFirst({ where: { userId, type, status: "OPEN" } });
  if (open) return fail("There's already an open request of this type");
  await db.dataRequest.create({ data: { userId, type, note: String(fd.get("note") ?? "") || `Logged by staff` } });
  await audit({ actorId: actor.id, action: "privacy.request", entity: "User", entityId: userId, summary: type });
  return done("Request logged — handle it from Privacy requests", "/admin/privacy");
}
