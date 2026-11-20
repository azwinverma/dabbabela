import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { assertOwnPayment, PAYMENT_METHODS } from "@/server/api/customer-dto";
import { switchPaymentMethod } from "@/server/payments";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({ method: z.enum(PAYMENT_METHODS) });

/**
 * Switch an unpaid payment to another method (money-moving: `Idempotency-Key` required — WALLET settles it from
 * credit immediately). `settled: true` = nothing left to pay (paid from wallet, or cash on delivery).
 */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", idempotent: "payment-method", limit: "payStart" }, async ({ req, user, params }) => {
  const { method } = await readJson(req, schema);
  await assertOwnPayment(user.id, params.id);
  await switchPaymentMethod(params.id, user.id, method);
  const p = await db.payment.findUniqueOrThrow({ where: { id: params.id }, select: { status: true, method: true } });
  const settled = p.status === "PAID" || p.method === "CASH";
  return { status: p.status, method: p.method, settled, next: settled ? "DONE" : "PAY" };
});
