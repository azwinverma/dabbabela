import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson, tooMany } from "@/server/api/http";
import { apiRiderActor } from "@/server/api/ops-dto";
import { hit } from "@/server/api/rate-limit";
import { deliverStop } from "@/server/dispatch";
import { storeUpload } from "@/lib/upload";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const fields = z.object({
  otp: z.string().trim().max(12).optional(),
  /** Cash collected at the door, integer paisa (required for unpaid CASH orders; must equal the amount due). */
  cash: z.coerce.number().int().min(0).max(10_000_000).optional(),
  note: z.string().trim().max(300).optional(),
});

/**
 * Mark a stop delivered — same rules as the web rider app (`deliverStop`): riders only on their own current routes;
 * with `deliveryOtp` on the customer's code is required (wrong codes are logged and refused); with `deliveryPhoto` on
 * a photo is required; unpaid cash orders need `cash` = the amount due. Staff acting from the app need dispatch.edit +
 * the kitchen in scope and skip OTP/photo.
 *
 * Body: JSON `{ otp?, cash?, note? }`, or multipart/form-data with the same fields plus a `photo` file (JPG/PNG/WEBP/AVIF,
 * ≤ 5 MB). Idempotency-Key required (cash collection is money).
 */
export const POST = apiRoute<{ permission: "rider.edit" }, { orderId: string }>({ auth: { permission: "rider.edit" }, idempotent: "rider-deliver", limit: "write" }, async ({ req, user, params }) => {
  const who = await apiRiderActor(user, { orderId: params.orderId });
  let input: z.infer<typeof fields>;
  let photoUrl: string | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const fd = await req.formData();
    const str = (k: string) => (typeof fd.get(k) === "string" && String(fd.get(k)).trim() !== "" ? String(fd.get(k)) : undefined);
    input = fields.parse({ otp: str("otp"), cash: str("cash"), note: str("note") });
    const file = fd.get("photo");
    if (file instanceof File && file.size > 0) {
      if (!(await hit("upload", `u:${user.id}`))) throw tooMany();
      photoUrl = (await storeUpload(file, { folder: "proof" })).url;
    }
  } else {
    input = await readJson(req, fields);
  }
  await deliverStop(params.orderId, who, { otp: input.otp ?? "", photoUrl, note: input.note || undefined, cashCollected: input.cash ?? null });
  const o = await db.order.findUniqueOrThrow({ where: { id: params.orderId }, select: { id: true, number: true, status: true, paymentStatus: true } });
  return { orderId: o.id, number: o.number, status: o.status, paymentStatus: o.paymentStatus, photoUrl };
});
