import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleKhaltiReturn } from "@/server/payments";
import { log } from "@/lib/logger";
import { LIMITS, rateLimitIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Khalti's return_url. We ignore the status in the query and confirm via the lookup API. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin), 303);
  // Each return triggers a server-to-server status lookup: cap it per IP so the endpoint can't be used to hammer the gateway.
  if (!(await rateLimitIp("pay-return", LIMITS.payReturn.max, LIMITS.payReturn.windowMs))) return to(`/pay/${id}?status=pending`);
  const payment = await db.payment.findUnique({ where: { id }, select: { status: true } });
  if (!payment) return to("/account/orders");
  if (payment.status === "PAID") return to(`/thank-you/${id}`);
  const pidx = url.searchParams.get("pidx");
  const status = url.searchParams.get("status");
  if (!pidx) return to(`/pay/${id}?status=failed&reason=${encodeURIComponent("Khalti didn't send a payment reference.")}`);
  if (status === "User canceled") return to(`/pay/${id}?status=failed&reason=${encodeURIComponent("You cancelled the Khalti payment.")}`);
  try {
    const r = await handleKhaltiReturn(id, pidx);
    if (r.ok) return to(`/thank-you/${id}`);
    if (r.pending) return to(`/pay/${id}?status=pending`);
    return to(`/pay/${id}?status=failed&reason=${encodeURIComponent(r.reason ?? "Payment not confirmed")}`);
  } catch (e) {
    log.error("khalti.return_failed", { paymentId: id, error: e });
    return to(`/pay/${id}?status=pending`);
  }
}
