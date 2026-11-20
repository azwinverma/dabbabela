import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { apiRiderActor } from "@/server/api/ops-dto";
import { failStop } from "@/server/dispatch";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** One of the route's `failureReasons` ("Other" needs `detail`). Free text is accepted too, like the web. */
  reason: z.string().trim().min(1, "Say what went wrong").max(200),
  detail: z.string().trim().max(300).optional(),
});

/** Mark a stop failed with a reason (`failStop`); dispatch then retries or cancels it. Riders: own routes only. */
export const POST = apiRoute<{ permission: "rider.edit" }, { orderId: string }>({ auth: { permission: "rider.edit" }, limit: "write" }, async ({ req, user, params }) => {
  const body = await readJson(req, schema);
  const who = await apiRiderActor(user, { orderId: params.orderId });
  await failStop(params.orderId, who, body.reason, body.detail ?? "");
  const o = await db.order.findUniqueOrThrow({ where: { id: params.orderId }, select: { id: true, number: true, status: true } });
  return { orderId: o.id, number: o.number, status: o.status };
});
