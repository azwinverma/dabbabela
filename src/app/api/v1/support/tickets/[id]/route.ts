import { apiRoute } from "@/server/api/route";
import { iso, notFound } from "@/server/api/http";
import { isStaffRole } from "@/lib/permissions";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** One of the caller's tickets with its conversation (staff-internal notes are never included). Others' → 404. */
export const GET = apiRoute<"user", { id: string }>({ auth: "user" }, async ({ user, params }) => {
  const t = await db.supportTicket.findFirst({
    where: { id: params.id, userId: user.id },
    include: { messages: { where: { internal: false }, orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true, role: true } } } }, order: { select: { id: true, number: true } } },
  });
  if (!t) throw notFound("Ticket not found");
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    category: t.category,
    status: t.status,
    order: t.order,
    canReply: t.status !== "CLOSED",
    messages: t.messages.map((m) => {
      const mine = m.author?.id === user.id;
      return { id: m.id, body: m.body, fromMe: mine, author: mine ? "You" : m.author && isStaffRole(m.author.role) ? `${m.author.name.split(/\s+/)[0]} (Dabba Bela)` : "Dabba Bela", createdAt: iso(m.createdAt) };
    }),
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
  };
});
