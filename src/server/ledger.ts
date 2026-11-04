import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { lockUser } from "./capacity";

type Tx = Prisma.TransactionClient;

/** Wallet balance = SUM of the append-only ledger. */
export async function walletBalance(userId: string, client: Tx | typeof db = db) {
  const r = await client.creditLedger.aggregate({ _sum: { amount: true }, where: { userId } });
  return r._sum.amount ?? 0;
}

export type LedgerEntry = {
  userId: string;
  amount: number;
  reason: "SKIP_CREDIT" | "REFUND" | "ADJUSTMENT" | "SPEND" | "REVERSAL" | "GOODWILL" | "CANCEL_CREDIT" | "DISRUPTION_CREDIT";
  orderId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  actorId?: string | null;
  note?: string | null;
};

export async function addCredit(tx: Tx, e: LedgerEntry) {
  if (e.amount <= 0) throw new Error("Credit must be positive");
  return tx.creditLedger.create({ data: e });
}

/** Spend wallet credit. Locks the user's ledger so two checkouts can't overspend. */
export async function spendCredit(tx: Tx, e: Omit<LedgerEntry, "reason"> & { reason?: LedgerEntry["reason"] }) {
  if (e.amount <= 0) throw new Error("Spend must be positive");
  await lockUser(tx, e.userId);
  const bal = await walletBalance(e.userId, tx);
  if (bal < e.amount) throw new Error("Not enough credit in your wallet");
  return tx.creditLedger.create({ data: { ...e, reason: e.reason ?? "SPEND", amount: -e.amount } });
}

/** Staff adjustment (either sign) — always with a note; never edits existing rows. */
export async function adjustCredit(e: LedgerEntry & { note: string }) {
  return db.$transaction(async (tx) => {
    await lockUser(tx, e.userId);
    if (e.amount < 0) {
      const bal = await walletBalance(e.userId, tx);
      if (bal + e.amount < 0) throw new Error("That would make the wallet negative");
    }
    return tx.creditLedger.create({ data: { ...e, reason: "ADJUSTMENT" } });
  });
}
