import { apiRoute } from "@/server/api/route";
import { iso, notFound, ymd } from "@/server/api/http";
import { availableMethods } from "@/server/payments/methods";
import { walletBalance } from "@/server/ledger";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * One of the caller's payments — poll this after the gateway browser closes (status PENDING → PAID / FAILED).
 * Includes what the pay screen needs: methods it may switch to, bank details + QR for bank transfers, whether a proof
 * was already sent. Another customer's payment → 404.
 */
export const GET = apiRoute<"user", { id: string }>({ auth: "user" }, async ({ user, params }) => {
  const p = await db.payment.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      orders: { select: { id: true, number: true, deliveryDate: true, status: true, items: { select: { name: true, quantity: true } } }, orderBy: { deliveryDate: "asc" } },
      subscription: { select: { id: true, reference: true, plan: { select: { name: true } } } },
      attempts: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, method: true, createdAt: true } },
    },
  });
  if (!p) throw notFound("Payment not found");
  const [settings, balance] = await Promise.all([getSettings(), walletBalance(user.id)]);
  const unpaid = p.status === "PENDING" || p.status === "FAILED";
  let methods: string[] = [];
  if (unpaid && p.purpose !== "WALLET_TOPUP") {
    const all = (await availableMethods(settings, { hasCompany: Boolean(p.companyId), customerShare: p.amount })).filter((m) => m !== "WALLET" || balance >= p.amount);
    // A swap difference is paid online only (same rule as the website pay page).
    methods = p.purpose === "SWAP_DIFFERENCE" ? all.filter((m) => m === "ESEWA" || m === "KHALTI") : all;
  }
  const expired = p.status === "CANCELLED" || (p.orders.length > 0 && p.orders.every((o) => o.status === "CANCELLED"));
  return {
    id: p.id,
    reference: p.reference,
    purpose: p.purpose,
    method: p.method,
    status: p.status,
    amount: p.amount,
    refundedAmount: p.refundedAmount,
    paidAt: iso(p.paidAt),
    createdAt: iso(p.createdAt),
    expired,
    proofSubmitted: Boolean(p.proofUrl),
    awaitingVerification: p.method === "BANK_TRANSFER" && Boolean(p.proofUrl) && p.status === "PENDING",
    lastAttempt: p.attempts[0] ? { status: p.attempts[0].status, method: p.attempts[0].method, createdAt: iso(p.attempts[0].createdAt) } : null,
    orders: p.orders.map((o) => ({ id: o.id, number: o.number, deliveryDate: ymd(o.deliveryDate), status: o.status, items: o.items })),
    subscription: p.subscription ? { id: p.subscription.id, reference: p.subscription.reference, planName: p.subscription.plan.name } : null,
    switchableMethods: methods,
    bankTransfer: p.method === "BANK_TRANSFER" && unpaid ? { bankDetails: settings.bankDetails, qrImage: settings.qrImage || null } : null,
  };
});
