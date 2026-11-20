import { describe, expect, it } from "vitest";
import { isTopupMethod, ktmDayRange, topupEnabled, topupLimitProblem } from "@/server/wallet-topup";
import { ledgerReasonLabel } from "@/lib/ledger-labels";

const L = { min: 10000, max: 1000000, daily: 2000000, cap: 2500000, balance: 0, usedToday: 0, pendingToday: 0 };

describe("wallet top-up limits (pure)", () => {
  it("accepts an amount inside every limit", () => {
    expect(topupLimitProblem(100000, L)).toBeNull();
    expect(topupLimitProblem(10000, L)).toBeNull();
    expect(topupLimitProblem(1000000, L)).toBeNull();
  });

  it("refuses non-integers, zero and negatives", () => {
    expect(topupLimitProblem(0, L)).toMatch(/Enter an amount/);
    expect(topupLimitProblem(-100, L)).toMatch(/Enter an amount/);
    expect(topupLimitProblem(100.5, L)).toMatch(/Enter an amount/);
  });

  it("enforces min and max per top-up", () => {
    expect(topupLimitProblem(9999, L)).toMatch(/smallest top-up is Rs 100/);
    expect(topupLimitProblem(1000001, L)).toMatch(/largest single top-up/);
  });

  it("enforces the daily total (paid + pending today)", () => {
    expect(topupLimitProblem(600000, { ...L, usedToday: 1500000 })).toMatch(/up to Rs 5,000 more today/);
    expect(topupLimitProblem(500000, { ...L, usedToday: 1500000 })).toBeNull();
    expect(topupLimitProblem(10000, { ...L, usedToday: 1995000 })).toMatch(/reached today's top-up limit/);
  });

  it("enforces the balance cap including still-pending top-ups", () => {
    expect(topupLimitProblem(600000, { ...L, balance: 2000000 })).toMatch(/can't go above Rs 25,000 — you can add up to Rs 5,000/);
    expect(topupLimitProblem(500000, { ...L, balance: 1500000, pendingToday: 600000 })).toMatch(/up to Rs 4,000/);
    expect(topupLimitProblem(10000, { ...L, balance: 2495000 })).toMatch(/at the Rs 25,000 limit/);
    expect(topupLimitProblem(500000, { ...L, balance: 2000000 })).toBeNull();
  });

  it("only eSewa, Khalti and bank transfer can buy credit", () => {
    expect(["ESEWA", "KHALTI", "BANK_TRANSFER"].every(isTopupMethod)).toBe(true);
    expect(["WALLET", "CASH", "COMPANY_INVOICE"].some(isTopupMethod)).toBe(false);
  });

  it("needs both the top-up flag and the wallet flag", () => {
    expect(topupEnabled({ flags: { walletTopup: true, wallet: true } } as never)).toBe(true);
    expect(topupEnabled({ flags: { walletTopup: false, wallet: true } } as never)).toBe(false);
    expect(topupEnabled({ flags: { walletTopup: true, wallet: false } } as never)).toBe(false);
  });

  it("uses the Kathmandu day (UTC+5:45) for the daily limit", () => {
    const r = ktmDayRange("2026-11-20");
    expect(r.gte.toISOString()).toBe("2026-11-19T18:15:00.000Z");
    expect(r.lt.toISOString()).toBe("2026-11-20T18:15:00.000Z");
  });

  it("labels top-up ledger rows", () => {
    expect(ledgerReasonLabel("TOPUP")).toBe("Top-up");
    expect(ledgerReasonLabel("TOPUP_REVERSAL")).toBe("Top-up refunded");
    expect(ledgerReasonLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});
