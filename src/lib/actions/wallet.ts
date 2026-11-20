"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { done, fail, type ActionResult } from "@/lib/action";
import { log } from "@/lib/logger";
import { parseRupees } from "@/lib/money";
import { str } from "@/lib/utils";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { cancelTopup, startTopup, TopupError } from "@/server/wallet-topup";

/** Customer starts a wallet top-up; the payment page for it takes over (gateway redirect or bank proof). */
export async function startTopupAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return fail("Log in to add credit");
  if (!(await rateLimit("shop:payStart", user.id, LIMITS.payStart.max, LIMITS.payStart.windowMs))) return fail("Too many attempts — wait a minute and try again");
  const preset = str(fd.get("preset"));
  const amount = parseRupees(preset && preset !== "custom" ? preset : str(fd.get("amount")));
  if (amount == null || amount <= 0) return fail("Enter how much credit to add", { amount: "Enter an amount in rupees" });
  const method = str(fd.get("method"));
  if (!method) return fail("Choose how you'll pay", { method: "Required" });
  try {
    const { payment } = await startTopup(user, { amount, method, idempotencyKey: str(fd.get("idempotencyKey")) });
    revalidatePath("/account/wallet");
    return done("Top-up started", `/account/wallet/topup/${payment.id}`);
  } catch (e) {
    if (e instanceof TopupError) return fail(e.message);
    log.error("wallet.topup_start_failed", { error: e });
    return fail("We couldn't start the top-up — please try again");
  }
}

/** Customer withdraws an unpaid top-up. */
export async function cancelTopupAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return fail("Log in first");
  try {
    await cancelTopup(user.id, str(fd.get("paymentId")));
    revalidatePath("/account/wallet");
    return done("Top-up cancelled", "/account/wallet");
  } catch (e) {
    if (e instanceof TopupError) return fail(e.message);
    log.error("wallet.topup_cancel_failed", { error: e });
    return fail("Couldn't cancel — please try again");
  }
}
