import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { ApiError, created, readJson } from "@/server/api/http";
import { nextStep, paymentBriefDto } from "@/server/api/customer-dto";
import { startTopup, topupEnabled, TOPUP_METHODS } from "@/server/wallet-topup";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const schema = z.object({ amount: z.number().int().positive("Enter an amount in paisa"), method: z.enum(TOPUP_METHODS) });

/**
 * Start a wallet top-up (money-moving: `Idempotency-Key` required; the key also de-duplicates the payment itself).
 * Then pay it like any payment: POST /payments/{payment.id}/start (eSewa / Khalti) or /proof (bank transfer). Credit is
 * added only after server-side verification. 404 FEATURE_DISABLED while `flags.walletTopup` is off.
 */
export const POST = apiRoute({ auth: "user", idempotent: "wallet-topup", limit: "checkout" }, async ({ req, user, idempotencyKey }) => {
  if (!topupEnabled(await getSettings())) throw new ApiError(404, "FEATURE_DISABLED", "Adding credit isn't available right now");
  const b = await readJson(req, schema);
  const { payment, replayed } = await startTopup(user, { amount: b.amount, method: b.method, idempotencyKey: idempotencyKey! });
  return created({ payment: paymentBriefDto(payment), replayed, next: nextStep(payment.status === "PENDING") });
});
