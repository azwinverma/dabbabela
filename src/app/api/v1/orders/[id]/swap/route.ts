import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { assertOwnOrder } from "@/server/api/customer-dto";
import { swapMeal } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

const schema = z.object({
  boxId: z.string().min(1, "Pick a dabba").max(64),
  /** How a paid meal's up-charge is paid: WALLET (default when credit covers it) or ESEWA / KHALTI (pay-the-difference). */
  method: z.enum(["WALLET", "ESEWA", "KHALTI"]).nullable().optional(),
});

/**
 * Swap a plan meal's dabba (money-moving: `Idempotency-Key` required). `settlement`:
 * NONE (same price / already that dabba), WALLET_CHARGE, WALLET_CREDIT, DUE_LATER (cash plans), or PAY_ONLINE —
 * then `paymentId` is a SWAP_DIFFERENCE payment: POST /payments/{paymentId}/start; the swap applies once it's verified.
 */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", idempotent: "order-swap", limit: "write" }, async ({ req, user, params }) => {
  const b = await readJson(req, schema);
  await assertOwnOrder(user.id, params.id);
  const r = await swapMeal(params.id, b.boxId, { id: user.id, isStaff: false }, user.id, { method: b.method ?? null });
  const rs = (n: number) => `Rs ${(n / 100).toFixed(0)}`;
  const message =
    r.settlement === "PAY_ONLINE"
      ? `Pay ${rs(r.delta)} to confirm the swap`
      : !r.changed
        ? "That's already your dabba for the day"
        : `Swapped${r.delta > 0 ? (r.settlement === "WALLET_CHARGE" ? ` — ${rs(r.delta)} taken from your credit` : ` — ${rs(r.delta)} more, paid with the rest of your plan`) : r.delta < 0 ? (r.settlement === "WALLET_CREDIT" ? ` — ${rs(-r.delta)} added to your credit` : ` — ${rs(-r.delta)} less to pay`) : ""}`;
  return { changed: r.changed, delta: r.delta, settlement: r.settlement, paymentId: r.paymentId ?? null, next: r.settlement === "PAY_ONLINE" ? "PAY" : "DONE", message };
});
