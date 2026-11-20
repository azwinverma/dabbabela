import { apiRoute } from "@/server/api/route";
import { notFound } from "@/server/api/http";
import { cancelTopup } from "@/server/wallet-topup";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Withdraw an unpaid top-up (not once a bank proof was sent). Money that still arrives later is credited. */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", limit: "write" }, async ({ user, params }) => {
  const own = await db.payment.findFirst({ where: { id: params.id, userId: user.id, purpose: "WALLET_TOPUP" }, select: { id: true } });
  if (!own) throw notFound("Top-up not found");
  await cancelTopup(user.id, params.id);
  return { status: "CANCELLED", message: "Top-up cancelled" };
});
