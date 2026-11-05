"use server";
import { done, type ActionResult } from "@/lib/action";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";
import { closeSettlement, saveSettlement, SETTLE_METHODS, type SettleMethod } from "@/server/finance/settlement";
import { importStatement, matchLineManually, PROVIDERS, type Provider } from "@/server/finance/statements";
import { ACCOUNT_KEYS, GATEWAY_METHODS, saveFinanceConfig } from "@/server/finance/common";
import { db } from "@/lib/db";

const PATHS = ["/admin/settlements", "/admin/payments", "/admin/profitability"];

export async function saveSettlementAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "settlements.edit",
    async (user) => {
      const method = f.str(fd, "method", 20) as SettleMethod;
      if (!(SETTLE_METHODS as readonly string[]).includes(method)) throw new Error("Unknown method");
      const s = await saveSettlement(user, { date: f.date(fd, "date") ?? "", kitchenId: f.opt(fd, "kitchenId", 40), method, counted: f.money(fd, "counted", "Counted"), note: f.opt(fd, "note", 500) });
      return done(s.variance === 0 ? "Saved — no variance" : `Saved — variance ${(s.variance / 100).toFixed(2)}`);
    },
    PATHS,
  );
}

export async function closeSettlementAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "settlements.approve",
    async (user) => {
      await closeSettlement(user, f.str(fd, "id", 40), f.opt(fd, "note", 500));
      return done("Closed and locked");
    },
    PATHS,
  );
}

export type ImportState = ActionResult & { report?: Awaited<ReturnType<typeof importStatement>> };

export async function importStatementAction(_: ImportState, fd: FormData): Promise<ImportState> {
  let report: ImportState["report"];
  const res = await guarded(
    "settlements.edit",
    async (user) => {
      const provider = f.str(fd, "provider", 10) as Provider;
      if (!(PROVIDERS as readonly string[]).includes(provider)) throw new Error("Pick the gateway");
      const file = fd.get("file");
      if (!(file instanceof File) || !file.size) throw new Error("Choose the CSV file");
      if (file.size > 2 * 1024 * 1024) throw new Error("CSV must be under 2 MB");
      report = await importStatement(user, { provider, csv: await file.text(), unit: f.str(fd, "unit", 10) === "paisa" ? "paisa" : "rupees", filename: file.name.slice(0, 80) });
      return done(`${report.imported} new line(s), ${report.alreadyImported} already imported, ${report.matched} matched, ${report.unmatched.length} unmatched`);
    },
    PATHS,
  );
  return { ...res, report };
}

export async function matchLineAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "settlements.edit",
    async (user) => {
      await matchLineManually(user, f.str(fd, "lineId", 40), f.str(fd, "reference", 80));
      return done("Matched");
    },
    PATHS,
  );
}

export async function saveFinanceSettingsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "settlements.approve",
    async (user) => {
      const feeBps: Record<string, number> = {};
      for (const m of GATEWAY_METHODS) {
        const pct = f.str(fd, `fee_${m}`, 10);
        if (pct === "") continue;
        const n = Number(pct);
        if (!Number.isFinite(n) || n < 0 || n > 20) throw new Error(`Fee for ${m}: enter a percentage between 0 and 20`);
        feeBps[m] = Math.round(n * 100);
      }
      const cats = await db.expenseCategory.findMany({ select: { key: true } });
      const keys = [...Object.keys(ACCOUNT_KEYS), ...cats.map((c) => `expense.${c.key}`)];
      const chartOfAccounts = Object.fromEntries(keys.map((k) => [k, f.str(fd, `acct_${k}`, 80)]).filter(([, v]) => v));
      await saveFinanceConfig(user, { feeBps, chartOfAccounts });
      return done("Finance settings saved");
    },
    PATHS,
  );
}
