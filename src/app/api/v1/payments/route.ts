import { apiRoute } from "@/server/api/route";
import { iso, ok, paginate, readPage } from "@/server/api/http";
import { paymentHistory } from "@/server/customer-dashboard";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The caller's payments, newest first (cursor pagination). `meta.totals` = the same totals as Account → Payments
 * (paid, refunded, pending, wallet in/out, balance) computed over all rows.
 */
export const GET = apiRoute({ auth: "user" }, async ({ req, user }) => {
  const page = await paginate(readPage(req), (args) =>
    db.payment.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        reference: true,
        method: true,
        status: true,
        purpose: true,
        amount: true,
        refundedAmount: true,
        paidAt: true,
        createdAt: true,
        subscription: { select: { id: true, plan: { select: { name: true } } } },
        orders: { select: { id: true, number: true }, orderBy: { deliveryDate: "asc" }, take: 1 },
        _count: { select: { orders: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...args,
    }),
  );
  const { totals } = await paymentHistory(user.id, { take: 1 });
  return ok(
    page.items.map((p) => ({
      id: p.id,
      reference: p.reference,
      method: p.method,
      status: p.status,
      purpose: p.purpose,
      amount: p.amount,
      refundedAmount: p.refundedAmount,
      paidAt: iso(p.paidAt),
      createdAt: iso(p.createdAt),
      subscription: p.subscription ? { id: p.subscription.id, planName: p.subscription.plan.name } : null,
      firstOrder: p.orders[0] ?? null,
      orderCount: p._count.orders,
    })),
    { meta: { nextCursor: page.nextCursor, totals } },
  );
});
