import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleEsewaReturn } from "@/server/payments";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * eSewa redirects the browser here. Nothing in the query is trusted: handleEsewaReturn verifies the
 * HMAC, matches the attempt + amount and asks eSewa's status API before anything is marked paid.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin), 303);
  const payment = await db.payment.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!payment) return to("/account/orders");
  if (payment.status === "PAID") return to(`/thank-you/${id}`);
  if (url.searchParams.get("failed")) return to(`/pay/${id}?status=failed&reason=${encodeURIComponent("You left eSewa before paying, or the payment was declined.")}`);
  const data = url.searchParams.get("data");
  if (!data) return to(`/pay/${id}?status=failed&reason=${encodeURIComponent("eSewa didn't send a payment result.")}`);
  try {
    const r = await handleEsewaReturn(id, data);
    if (r.ok) return to(`/thank-you/${id}`);
    if (r.pending) return to(`/pay/${id}?status=pending`);
    return to(`/pay/${id}?status=failed&reason=${encodeURIComponent(r.reason ?? "Payment not confirmed")}`);
  } catch (e) {
    log.error("esewa.return_failed", { paymentId: id, error: e });
    return to(`/pay/${id}?status=pending`);
  }
}
