import type { PaymentMethod } from "@prisma/client";
import type { SiteSettings } from "@/lib/settings";

/** Live payments: production without PAYMENTS_SANDBOX=true. Then gateway endpoints never default to sandbox hosts. */
export const paymentsLive = () => process.env.NODE_ENV === "production" && process.env.PAYMENTS_SANDBOX !== "true";
const isProd = paymentsLive;

/** eSewa's / Khalti's test hosts. A live deployment pointing at one of these is misconfigured (security review L5). */
const SANDBOX_HOST = /(^|\.)(rc-epay\.esewa\.com\.np|rc\.esewa\.com\.np|uat\.esewa\.com\.np|dev\.khalti\.com|a\.khalti\.com)$/i;
const hostOf = (u: string | undefined) => {
  try {
    return u ? new URL(u).hostname : "";
  } catch {
    return "";
  }
};

/**
 * Why a gateway can't take live money with the current env, or null. In live mode every endpoint must be set
 * explicitly (no sandbox default) and must not be a sandbox host. Fail closed: the method is hidden and
 * /api/health reports it (integrations.esewa/khalti false + paymentsConfig.problems).
 */
export function gatewayConfigProblem(method: "ESEWA" | "KHALTI"): string | null {
  if (!isProd()) return null;
  const urls = method === "ESEWA" ? { ESEWA_FORM_URL: process.env.ESEWA_FORM_URL, ESEWA_STATUS_URL: process.env.ESEWA_STATUS_URL } : { KHALTI_BASE_URL: process.env.KHALTI_BASE_URL };
  for (const [k, v] of Object.entries(urls)) {
    if (!v) return `${k} is not set (live mode never defaults to the sandbox)`;
    if (SANDBOX_HOST.test(hostOf(v))) return `${k} points at a sandbox host while PAYMENTS_SANDBOX is not "true"`;
  }
  return null;
}

/** eSewa is usable with merchant keys (and, live, explicit non-sandbox endpoints), or with the public sandbox keys outside production. */
export function esewaConfigured() {
  if (process.env.ESEWA_PRODUCT_CODE && process.env.ESEWA_SECRET_KEY) return !gatewayConfigProblem("ESEWA");
  return !isProd();
}
export function khaltiConfigured() {
  return Boolean(process.env.KHALTI_SECRET_KEY) && !gatewayConfigProblem("KHALTI");
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
