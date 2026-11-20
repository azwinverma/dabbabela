import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { created, iso, readJson } from "@/server/api/http";
import { assertOwnOrder } from "@/server/api/customer-dto";
import { createTicket, TICKET_CATEGORIES } from "@/server/support";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The caller's support conversations, latest activity first. */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => {
  const rows = await db.supportTicket.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 100, include: { order: { select: { id: true, number: true } }, _count: { select: { messages: { where: { internal: false } } } } } });
  return rows.map((t) => ({ id: t.id, number: t.number, subject: t.subject, category: t.category, status: t.status, order: t.order, messageCount: t._count.messages, createdAt: iso(t.createdAt), updatedAt: iso(t.updatedAt) }));
});

const schema = z.object({
  subject: z.string().trim().min(3, "Add a short subject").max(160),
  body: z.string().trim().min(5, "Tell us what happened").max(4000),
  category: z.enum(TICKET_CATEGORIES).optional(),
  orderId: z.string().max(64).nullable().optional(),
});

/** Open a support ticket (optionally about one of the caller's orders). */
export const POST = apiRoute({ auth: "user", limit: "write" }, async ({ req, user }) => {
  const b = await readJson(req, schema);
  if (b.orderId) await assertOwnOrder(user.id, b.orderId);
  const t = await createTicket({ userId: user.id, name: user.name, email: user.email, phone: user.phoneNumber, orderId: b.orderId || null, subject: b.subject, body: b.body, category: b.category ?? "GENERAL", source: "account" });
  return created({ id: t.id, number: t.number, status: t.status, message: `Ticket ${t.number} opened — we usually reply within working hours` });
});
