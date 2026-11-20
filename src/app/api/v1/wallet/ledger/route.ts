import { apiRoute } from "@/server/api/route";
import { ok, paginate, readPage } from "@/server/api/http";
import { ledgerDto } from "@/server/api/customer-dto";
import { walletBalance } from "@/server/ledger";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Wallet history (append-only ledger), newest first; `amount` > 0 credit, < 0 spend. `meta.balance` = current balance. */
export const GET = apiRoute({ auth: "user" }, async ({ req, user }) => {
  const page = await paginate(readPage(req), (args) =>
    db.creditLedger.findMany({ where: { userId: user.id }, select: { id: true, amount: true, reason: true, note: true, orderId: true, paymentId: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...args }),
  );
  return ok(page.items.map(ledgerDto), { meta: { nextCursor: page.nextCursor, balance: await walletBalance(user.id) } });
});
