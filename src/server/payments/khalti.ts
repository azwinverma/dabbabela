import "server-only";

const cfg = () => ({
  secret: process.env.KHALTI_SECRET_KEY || "",
  base: (process.env.KHALTI_BASE_URL || "https://dev.khalti.com/api/v2").replace(/\/$/, ""),
});

/** Khalti ePayment initiate. Amount in paisa (Khalti's native unit). */
export async function khaltiInitiate(opts: {
  purchaseOrderId: string;
  amount: number;
  name: string;
  returnUrl: string;
  websiteUrl: string;
  customer: { name: string; email: string; phone?: string | null };
}) {
  const c = cfg();
  if (!c.secret) throw new Error("Khalti is not configured");
  const res = await fetch(`${c.base}/epayment/initiate/`, {
    method: "POST",
    headers: { Authorization: `Key ${c.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      return_url: opts.returnUrl,
      website_url: opts.websiteUrl,
      amount: opts.amount,
      purchase_order_id: opts.purchaseOrderId,
      purchase_order_name: opts.name.slice(0, 100),
      customer_info: { name: opts.customer.name, email: opts.customer.email, phone: opts.customer.phone?.replace(/\D/g, "").slice(-10) || undefined },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { pidx?: string; payment_url?: string; detail?: string };
  if (!res.ok || !json.pidx || !json.payment_url) throw new Error(json.detail || "Khalti could not start the payment");
  return { pidx: json.pidx, paymentUrl: json.payment_url, raw: json };
}

export type KhaltiLookup = { ok: boolean; status?: string; total_amount?: number; transaction_id?: string; pidx?: string; refunded?: boolean };

export async function khaltiLookup(pidx: string): Promise<KhaltiLookup> {
  const c = cfg();
  try {
    const res = await fetch(`${c.base}/epayment/lookup/`, {
      method: "POST",
      headers: { Authorization: `Key ${c.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ pidx }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as Omit<KhaltiLookup, "ok">;
    return { ok: res.ok, ...json };
  } catch {
    return { ok: false };
  }
}
