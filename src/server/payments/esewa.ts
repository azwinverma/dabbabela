import "server-only";
import crypto from "node:crypto";

/** eSewa ePay v2. Sandbox values are eSewa's published test credentials. */
export const esewaConfig = () => ({
  productCode: process.env.ESEWA_PRODUCT_CODE || "EPAYTEST",
  secret: process.env.ESEWA_SECRET_KEY || "8gBm/:&EnhH.1/q",
  formUrl: process.env.ESEWA_FORM_URL || "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
  statusUrl: process.env.ESEWA_STATUS_URL || "https://rc.esewa.com.np/api/epay/transaction/status/",
});

export function esewaSign(message: string, secret = esewaConfig().secret) {
  return crypto.createHmac("sha256", secret).update(message).digest("base64");
}

/** paisa → "226.50" / "200" */
export function esewaAmount(paisa: number) {
  return paisa % 100 === 0 ? String(paisa / 100) : (paisa / 100).toFixed(2);
}

export function esewaFormFields(opts: { transactionUuid: string; amount: number; successUrl: string; failureUrl: string }) {
  const c = esewaConfig();
  const total = esewaAmount(opts.amount);
  const fields: Record<string, string> = {
    amount: total,
    tax_amount: "0",
    total_amount: total,
    transaction_uuid: opts.transactionUuid,
    product_code: c.productCode,
    product_service_charge: "0",
    product_delivery_charge: "0",
    success_url: opts.successUrl,
    failure_url: opts.failureUrl,
    signed_field_names: "total_amount,transaction_uuid,product_code",
  };
  fields.signature = esewaSign(`total_amount=${total},transaction_uuid=${opts.transactionUuid},product_code=${c.productCode}`);
  return { action: c.formUrl, fields };
}

export type EsewaCallback = {
  transaction_code: string;
  status: string;
  total_amount: string | number;
  transaction_uuid: string;
  product_code: string;
  signed_field_names: string;
  signature: string;
};

export function decodeEsewa(dataB64: string): EsewaCallback | null {
  try {
    const p = JSON.parse(Buffer.from(dataB64, "base64").toString("utf8"));
    return p && typeof p === "object" && typeof p.transaction_uuid === "string" ? p : null;
  } catch {
    return null;
  }
}

/** Constant-time check of the HMAC eSewa puts on its callback. */
export function esewaSignatureValid(p: EsewaCallback, secret = esewaConfig().secret) {
  if (typeof p.signed_field_names !== "string") return false;
  const msg = p.signed_field_names
    .split(",")
    .map((f) => `${f}=${(p as unknown as Record<string, unknown>)[f]}`)
    .join(",");
  const a = Buffer.from(esewaSign(msg, secret));
  const b = Buffer.from(String(p.signature ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function toPaisa(amount: string | number) {
  const n = Number(String(amount).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/** Server-to-server status check. Returns the eSewa status string, or null when unreachable. */
export async function esewaStatus(transactionUuid: string, amount: number): Promise<{ status: string | null; raw: unknown }> {
  const c = esewaConfig();
  const url = `${c.statusUrl}?product_code=${encodeURIComponent(c.productCode)}&total_amount=${esewaAmount(amount)}&transaction_uuid=${encodeURIComponent(transactionUuid)}`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const raw = await res.json().catch(() => null);
    return { status: (raw as { status?: string } | null)?.status ?? null, raw };
  } catch (e) {
    return { status: null, raw: { error: e instanceof Error ? e.message : String(e) } };
  }
}
