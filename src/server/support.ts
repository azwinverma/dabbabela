import { db } from "@/lib/db";
import { randomCode } from "@/lib/utils";
import { notify } from "./notify";

export const TICKET_CATEGORIES = ["ORDER", "PAYMENT", "DELIVERY", "FOOD", "ACCOUNT", "CORPORATE", "GENERAL"] as const;
export const TICKET_STATUSES = ["OPEN", "PENDING", "RESOLVED", "CLOSED"] as const;

export async function createTicket(input: {
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  orderId?: string | null;
  subject: string;
  body: string;
  category?: string;
  source?: "account" | "contact_form" | "staff";
  priority?: string;
}) {
  if (input.orderId && input.userId) {
    const own = await db.order.findFirst({ where: { id: input.orderId, userId: input.userId }, select: { id: true } });
    if (!own) throw new Error("Order not found");
  }
  const category = (TICKET_CATEGORIES as readonly string[]).includes(input.category ?? "") ? input.category! : "GENERAL";
  const priority = input.category === "FOOD" || input.category === "DELIVERY" ? "HIGH" : (input.priority ?? "NORMAL");
  return db.supportTicket.create({
    data: {
      number: `T-${randomCode(6)}`,
      userId: input.userId ?? null,
      name: input.name?.slice(0, 120) ?? null,
      email: input.email?.slice(0, 160) ?? null,
      phone: input.phone?.slice(0, 20) ?? null,
      orderId: input.orderId ?? null,
      subject: input.subject.slice(0, 160),
      category,
      priority,
      source: input.source ?? "account",
      messages: { create: { authorId: input.userId ?? null, body: input.body.slice(0, 4000) } },
    },
  });
}

/** Add a message. Staff replies notify the customer; internal notes don't. Customers can only post on their own tickets. */
export async function replyTicket(ticketId: string, author: { id: string; isStaff: boolean }, body: string, internal = false) {
  const t = await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
  if (!author.isStaff && t.userId !== author.id) throw new Error("Ticket not found");
  if (!body.trim()) throw new Error("Write a message");
  await db.supportMessage.create({ data: { ticketId, authorId: author.id, body: body.slice(0, 4000), internal: author.isStaff && internal } });
  const status = author.isStaff ? (internal ? t.status : "PENDING") : "OPEN";
  await db.supportTicket.update({ where: { id: ticketId }, data: { status, updatedAt: new Date() } });
  if (author.isStaff && !internal && t.userId)
    void notify("ticket.reply", { userId: t.userId }, { subject: t.subject, preview: body.slice(0, 140) }, { link: `/account/support/${t.id}` });
}

export async function setTicketStatus(ticketId: string, status: (typeof TICKET_STATUSES)[number], assignedToId?: string | null) {
  return db.supportTicket.update({
    where: { id: ticketId },
    data: { status, resolvedAt: status === "RESOLVED" || status === "CLOSED" ? new Date() : null, ...(assignedToId !== undefined ? { assignedToId } : {}) },
  });
}
