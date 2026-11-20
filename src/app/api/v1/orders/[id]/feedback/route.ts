import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { ApiError, readJson } from "@/server/api/http";
import { assertOwnOrder } from "@/server/api/customer-dto";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const r5 = z.number().int().min(1).max(5);
const schema = z.object({
  rating: r5,
  taste: r5.nullable().optional(),
  portion: r5.nullable().optional(),
  onTime: z.boolean().nullable().optional(),
  comment: z.string().max(1000).nullable().optional(),
  /** May be quoted on the website with first name only. */
  publishConsent: z.boolean().optional(),
});

/** Rate a delivered dabba (one rating per order; sending again updates it). Same rules as the website form. */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", limit: "write" }, async ({ req, user, params }) => {
  const b = await readJson(req, schema);
  const o = await assertOwnOrder(user.id, params.id);
  if (o.status !== "DELIVERED") throw new ApiError(422, "REQUEST_REJECTED", "You can rate a dabba after it's delivered");
  const data = { rating: b.rating, taste: b.taste ?? null, portion: b.portion ?? null, onTime: b.onTime ?? null, comment: b.comment?.trim().slice(0, 1000) || null, publishConsent: Boolean(b.publishConsent) };
  await db.feedback.upsert({ where: { orderId: o.id }, create: { orderId: o.id, userId: user.id, ...data }, update: data });
  return { message: "Thank you — the kitchen reads every one" };
});
