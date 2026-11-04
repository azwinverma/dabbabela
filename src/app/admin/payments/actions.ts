"use server";
import { requirePermission } from "@/lib/auth";
import { fail, done, type ActionResult } from "@/lib/action";
import { verifyManualPayment, rejectManualPayment } from "@/server/payments";
import { db } from "@/lib/db";

export async function verifyPaymentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("payments.verify");
  const id = String(fd.get("id") ?? "");
  const ref = String(fd.get("reference") ?? "").trim();
  if (!ref) return fail("Enter the bank transaction reference you matched");
  const p = await db.payment.findUnique({ where: { id } });
  if (!p || p.method !== "BANK_TRANSFER") return fail("Only bank transfers are verified by hand");
  try {
    const r = await verifyManualPayment(id, user.id, ref);
    return done(r.already ? "Already marked paid" : "Payment verified — orders released to the kitchen");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't verify");
  }
}

export async function rejectPaymentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("payments.verify");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) return fail("Say why (e.g. no matching credit in the bank statement)");
  const p = await db.payment.findUnique({ where: { id: String(fd.get("id") ?? "") } });
  if (!p || p.status !== "PENDING") return fail("This payment isn't pending");
  await rejectManualPayment(p.id, user.id, reason);
  return done("Marked as not received — the customer can retry");
}
