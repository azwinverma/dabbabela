import type { PaymentMethod } from "@prisma/client";
import type { SiteSettings } from "@/lib/settings";

const isProd = () => process.env.NODE_ENV === "production" && process.env.PAYMENTS_SANDBOX !== "true";

/** eSewa is usable with merchant keys, or with the public sandbox keys outside production. */
export function esewaConfigured() {
  if (process.env.ESEWA_PRODUCT_CODE && process.env.ESEWA_SECRET_KEY) return true;
  return !isProd();
}
export function khaltiConfigured() {
  return Boolean(process.env.KHALTI_SECRET_KEY);
}
export function isGatewayMethod(m: PaymentMethod) {
  return m === "ESEWA" || m === "KHALTI";
}

/**
 * Methods a customer can pick right now: enabled in settings AND actually configured.
 * Unconfigured gateways stay hidden (feature-flag rule in the brief).
 */
export async function availableMethods(settings: SiteSettings, _ctx: { hasCompany: boolean; customerShare: number; forPlan?: boolean }): Promise<PaymentMethod[]> {
  const out: PaymentMethod[] = [];
  const on = settings.paymentMethods;
  if (on.ESEWA && esewaConfigured()) out.push("ESEWA");
  if (on.KHALTI && khaltiConfigured()) out.push("KHALTI");
  if (on.BANK_TRANSFER && (settings.bankDetails || settings.qrImage)) out.push("BANK_TRANSFER");
  if (on.CASH) out.push("CASH");
  if (on.WALLET && settings.flags.wallet) out.push("WALLET");
  return out;
}

export function methodNeedsAction(m: PaymentMethod) {
  return m === "ESEWA" || m === "KHALTI" || m === "BANK_TRANSFER";
}
