import "server-only";
import type { PaymentMethod, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";
import { bpsOf } from "@/lib/money";
import { audit } from "@/lib/audit";

/**
 * Shared finance plumbing (WP-09): who may act, accounting-period guards and the finance configuration
 * (gateway fee rates + chart-of-accounts mapping) kept in one `Setting` row.
 *
 * Every finance write re-checks permissions here (pages and actions check too) and is audited.
 * Money is integer paisa. Approved financial records are never edited in place: corrections are reversing entries.
 */

export type Tx = Prisma.TransactionClient;
export type Actor = { id: string; role: string; customGrants?: readonly string[] | null };

export class FinanceError extends Error {}
export class FinanceDenied extends FinanceError {}

export function assertCan(actor: Actor, ...perms: Permission[]) {
  for (const p of perms) if (!can(actor, p)) throw new FinanceDenied(`You don't have permission (${p})`);
}

export const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const monthOf = (isoDate: string) => isoDate.slice(0, 7);
export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** True when the month (YYYY-MM) of this date has been closed. */
export async function isPeriodClosed(isoDate: string, client: Tx | typeof db = db) {
  const p = await client.accountingPeriod.findUnique({ where: { month: monthOf(isoDate) } });
  return Boolean(p?.closedAt);
}

/** Refuse a write that would change the numbers of a closed month. */
export async function assertPeriodOpen(isoDate: string, client: Tx | typeof db = db) {
  if (await isPeriodClosed(isoDate, client)) throw new FinanceError(`${monthOf(isoDate)} is closed — post a correction dated in an open month instead`);
}

// ───────────── configuration ─────────────

export const FINANCE_SETTING = "finance.config";
export const GATEWAY_METHODS = ["ESEWA", "KHALTI", "BANK_TRANSFER", "CASH"] as const satisfies readonly PaymentMethod[];

/**
 * Journal account keys. The accountant's chart of accounts is an external blocker, so the export uses these internal
 * keys and `chartOfAccounts` maps each key to the accountant's code (edited by finance on /admin/settlements?tab=settings).
 */
export const ACCOUNT_KEYS = {
  "cash.CASH": "Cash in hand",
  "cash.ESEWA": "eSewa wallet / clearing",
  "cash.KHALTI": "Khalti wallet / clearing",
  "cash.BANK_TRANSFER": "Bank account",
  "cash.BANK": "Bank account (expenses paid by bank)",
  "cash.OTHER": "Other payment accounts",
  "revenue.sales": "Sales receipts",
  "revenue.refunds": "Sales refunds",
  "tax.input": "Input VAT",
  "payable.expenses": "Expense payables",
  "payable.suppliers": "Supplier payables (trade creditors)",
  "inventory.purchases": "Inventory purchases",
} as const;

/** Fixed keys plus one `expense.<CATEGORY KEY>` per expense category. */
export const isAccountKey = (k: string) => k in ACCOUNT_KEYS || /^expense\.[A-Z0-9_]{1,40}$/.test(k);

export type FinanceConfig = {
  /** Gateway fee in basis points per method (150 = 1.5%). 0 = not configured. */
  feeBps: Record<string, number>;
  /** Internal account key → accountant's account code/name. Unmapped keys export as the internal key. */
  chartOfAccounts: Record<string, string>;
};

export const DEFAULT_FINANCE_CONFIG: FinanceConfig = { feeBps: {}, chartOfAccounts: {} };

export async function getFinanceConfig(client: Tx | typeof db = db): Promise<FinanceConfig> {
  const row = await client.setting.findUnique({ where: { key: FINANCE_SETTING } });
  const v = (row?.value ?? {}) as Partial<FinanceConfig>;
  const clean = (o: unknown, isNum: boolean) =>
    Object.fromEntries(
      Object.entries(o && typeof o === "object" ? (o as Record<string, unknown>) : {}).filter(([, x]) => (isNum ? typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 2000 : typeof x === "string" && x.trim())),
    );
  return { feeBps: clean(v.feeBps, true) as Record<string, number>, chartOfAccounts: clean(v.chartOfAccounts, false) as Record<string, string> };
}

export async function saveFinanceConfig(actor: Actor, patch: Partial<FinanceConfig>) {
  assertCan(actor, "settlements.approve");
  const before = await getFinanceConfig();
  for (const [k, bps] of Object.entries(patch.feeBps ?? {})) if (!Number.isInteger(bps) || bps < 0 || bps > 2000) throw new FinanceError(`Fee for ${k} must be between 0% and 20%`);
  const next: FinanceConfig = {
    feeBps: { ...before.feeBps, ...(patch.feeBps ?? {}) },
    chartOfAccounts: patch.chartOfAccounts ? Object.fromEntries(Object.entries(patch.chartOfAccounts).filter(([k, v]) => isAccountKey(k) && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 80)])) : before.chartOfAccounts,
  };
  await db.setting.upsert({ where: { key: FINANCE_SETTING }, create: { key: FINANCE_SETTING, value: next }, update: { value: next } });
  await audit({ actorId: actor.id, action: "finance.config", entity: "Setting", entityId: FINANCE_SETTING, before, after: next });
  return next;
}

/** Estimated gateway fee for a payment (paisa), from the configured rate for its method. */
export async function estimateGatewayFee(method: PaymentMethod, amount: number, client: Tx | typeof db = db) {
  const cfg = await getFinanceConfig(client);
  const bps = cfg.feeBps[method] ?? 0;
  return bps > 0 && amount > 0 ? bpsOf(amount, bps) : 0;
}

/** Next document number like EXP-202611-0007 (retry on the unique index if two staff save at once). */
export async function nextNumber(prefix: string, isoDate: string, count: (startsWith: string) => Promise<number>) {
  const stem = `${prefix}-${isoDate.slice(0, 7).replace("-", "")}-`;
  const n = (await count(stem)) + 1;
  return `${stem}${String(n).padStart(4, "0")}`;
}

export const isUnique = (e: unknown) => e instanceof Error && e.message.includes("Unique constraint");
