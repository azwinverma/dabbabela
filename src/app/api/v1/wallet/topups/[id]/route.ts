import { apiRoute } from "@/server/api/route";
import { iso, notFound } from "@/server/api/http";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** One of the caller's top-ups — poll after the gateway browser closes (PENDING → PAID once verified and credited). */
export const GET = apiRoute<"user", { id: string }>({ auth: "user" }, async ({ user, params }) => {
  const p = await db.payment.findFirst({ where: { id: params.id, userId: user.id, purpose: "WALLET_TOPUP" }, include: { attempts: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true } } } });
  if (!p) throw notFound("Top-up not found");
  const credited = await db.creditLedger.aggregate({ where: { paymentId: p.id, userId: user.id, reason: { in: ["TOPUP", "TOPUP_REVERSAL"] } }, _sum: { amount: true } });
  const settings = await getSettings();
  const unpaid = p.status === "PENDING" || p.status === "FAILED";
  return {
    id: p.id,
    reference: p.reference,
    method: p.method,
    status: p.status,
    amount: p.amount,
    credited: credited._sum.amount ?? 0,
    proofSubmitted: Boolean(p.proofUrl),
    cancellable: unpaid && !p.proofUrl,
    lastAttempt: p.attempts[0] ? { status: p.attempts[0].status, createdAt: iso(p.attempts[0].createdAt) } : null,
    bankTransfer: p.method === "BANK_TRANSFER" && unpaid ? { bankDetails: settings.bankDetails, qrImage: settings.qrImage || null } : null,
    paidAt: iso(p.paidAt),
    createdAt: iso(p.createdAt),
  };
});
