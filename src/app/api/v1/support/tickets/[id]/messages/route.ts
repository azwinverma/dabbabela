import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { ApiError, notFound, readJson } from "@/server/api/http";
import { replyTicket } from "@/server/support";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({ body: z.string().trim().min(1, "Write a message").max(4000) });

/** Reply on one of the caller's tickets (reopens it for the support team). Closed tickets can't be replied to. */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", limit: "write" }, async ({ req, user, params }) => {
  const { body } = await readJson(req, schema);
  const t = await db.supportTicket.findFirst({ where: { id: params.id, userId: user.id }, select: { id: true, status: true } });
  if (!t) throw notFound("Ticket not found");
  if (t.status === "CLOSED") throw new ApiError(422, "REQUEST_REJECTED", "This conversation is closed. Start a new one if you need us.");
  await replyTicket(t.id, { id: user.id, isStaff: false }, body);
  return { message: "Sent" };
});
