"use server";
import { done, type ActionResult } from "@/lib/action";
import { storeUpload } from "@/lib/upload";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";
import { assertKitchen } from "@/components/admin/ops/scope";
import type { CurrentUser } from "@/lib/auth";
import { approveExpense, attachReceipt, correctExpense, createExpense, markExpensePaid, reverseExpense, updateDraftExpense, voidExpense, type ExpenseInput } from "@/server/finance/expenses";

const PATHS = ["/admin/expenses", "/admin/profitability"];

async function receipt(fd: FormData) {
  const file = fd.get("receipt");
  return file instanceof File && file.size > 0 ? (await storeUpload(file, { allowPdf: true, folder: "receipts" })).url : null;
}

async function readInput(fd: FormData, user: CurrentUser): Promise<ExpenseInput> {
  const kitchenId = f.opt(fd, "kitchenId", 40);
  if (kitchenId) assertKitchen(user, kitchenId);
  else if (user.kitchenIds) throw new Error("Pick one of your kitchens");
  return {
    date: f.date(fd, "date") ?? "",
    categoryId: f.str(fd, "categoryId", 40),
    kitchenId,
    supplierId: f.opt(fd, "supplierId", 40),
    description: f.str(fd, "description", 300),
    amount: f.money(fd, "amount", "Amount"),
    tax: f.moneyOpt(fd, "tax", "Tax") ?? 0,
    method: f.opt(fd, "method", 20),
    reference: f.opt(fd, "reference", 120),
    attachmentUrl: (await receipt(fd)) ?? f.opt(fd, "attachmentUrl", 500),
  };
}

export async function createExpenseAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "expenses.create",
    async (user) => {
      const e = await createExpense(user, await readInput(fd, user));
      return done(`${e.number} saved as a draft — someone else approves it`);
    },
    PATHS,
  );
}

export async function updateExpenseAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "expenses.create",
    async (user) => {
      await updateDraftExpense(user, f.str(fd, "id", 40), await readInput(fd, user));
      return done("Draft updated");
    },
    PATHS,
  );
}

export async function approveExpenseAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "expenses.approve",
    async (user) => {
      const e = await approveExpense(user, f.str(fd, "id", 40));
      return done(`${e.number} approved`);
    },
    PATHS,
  );
}

export async function payExpenseAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "expenses.approve",
    async (user) => {
      await markExpensePaid(user, f.str(fd, "id", 40), { method: f.str(fd, "method", 20), reference: f.opt(fd, "reference", 120) });
      return done("Marked paid");
    },
    PATHS,
  );
}

export async function voidExpenseAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "expenses.create",
    async (user) => {
      await voidExpense(user, f.str(fd, "id", 40), f.str(fd, "reason", 300));
      return done("Voided (kept on record)");
    },
    PATHS,
  );
}

export async function reverseExpenseAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "expenses.approve",
    async (user) => {
      const r = await reverseExpense(user, f.str(fd, "id", 40), f.str(fd, "reason", 300), f.date(fd, "date") ?? undefined);
      return done(`Reversed by ${r.number}`);
    },
    PATHS,
  );
}

export async function correctExpenseAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "expenses.approve",
    async (user) => {
      const r = await correctExpense(user, f.str(fd, "id", 40), await readInput(fd, user), f.str(fd, "reason", 300));
      return done(`Reversed by ${r.reversal.number}; corrected draft ${r.replacement.number} needs approval`, `/admin/expenses/${r.replacement.id}`);
    },
    PATHS,
  );
}

export async function attachReceiptAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "expenses.create",
    async (user) => {
      const url = await receipt(fd);
      if (!url) throw new Error("Choose a receipt image or PDF");
      await attachReceipt(user, f.str(fd, "id", 40), url);
      return done("Receipt attached");
    },
    PATHS,
  );
}
