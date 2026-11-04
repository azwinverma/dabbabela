"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { done, fail, type ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { createTicket, replyTicket, setTicketStatus, TICKET_STATUSES } from "@/server/support";
import { guard } from "@/components/admin/ops/scope";

export async function replyAction(ticketId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("support");
    const internal = fd.get("internal") === "on";
    await replyTicket(ticketId, { id: user.id, isStaff: true }, String(fd.get("body") ?? ""), internal);
    revalidatePath(`/admin/support/${ticketId}`);
    return done(internal ? "Note added" : "Reply sent to the customer");
  });
}

export async function ticketStatusAction(ticketId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("support");
    const status = String(fd.get("status")) as (typeof TICKET_STATUSES)[number];
    if (!TICKET_STATUSES.includes(status)) return fail("Pick a status");
    const assignee = String(fd.get("assignedToId") ?? "");
    const priority = String(fd.get("priority") ?? "");
    await setTicketStatus(ticketId, status, assignee || null);
    if (["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority)) await db.supportTicket.update({ where: { id: ticketId }, data: { priority } });
    await audit({ actorId: user.id, action: "ticket.update", entity: "SupportTicket", entityId: ticketId, after: { status, assignee, priority } });
    revalidatePath(`/admin/support/${ticketId}`);
    return done("Ticket updated");
  });
}

export async function messageFlagAction(id: string, flag: "read" | "archive" | "unarchive"): Promise<ActionResult> {
  return guard(async () => {
    await requirePermission("support");
    await db.contactMessage.update({ where: { id }, data: flag === "read" ? { isRead: true } : { isArchived: flag === "archive", isRead: true } });
    revalidatePath("/admin/messages");
    return done();
  });
}

export async function messageToTicketAction(id: string): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("support");
    const m = await db.contactMessage.findUniqueOrThrow({ where: { id } });
    if (m.ticketId) redirect(`/admin/support/${m.ticketId}`);
    const linked = await db.user.findUnique({ where: { email: m.email.toLowerCase() }, select: { id: true } });
    const t = await createTicket({ userId: linked?.id ?? null, name: m.name, email: m.email, phone: m.phone, subject: m.subject || "Website message", body: m.message, source: "contact_form" });
    await db.contactMessage.update({ where: { id }, data: { ticketId: t.id, isRead: true } });
    await audit({ actorId: user.id, action: "message.to_ticket", entity: "ContactMessage", entityId: id, summary: t.number });
    redirect(`/admin/support/${t.id}`);
  });
}
