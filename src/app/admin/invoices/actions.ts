"use server";
import { requirePermission } from "@/lib/auth";
import { isValidISODate } from "@/lib/dates";
import { parseRupees } from "@/lib/money";
import { fail, done, type ActionResult } from "@/lib/action";
import { createCreditNote, recordInvoicePayment, voidInvoice } from "@/server/invoices";
import { generateCompanyInvoice, inCompanyScope, issueCompanyInvoice } from "@/server/corporate";
import { db } from "@/lib/db";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Company-scoped staff may only touch invoices of companies in their scope (same rule as generate / issue). */
async function invoiceInScope(user: { role: string; scopes?: { companyId: string | null }[] }, id: string) {
  const inv = await db.invoice.findUnique({ where: { id }, select: { companyId: true } });
  if (!inv) throw new Error("Invoice not found");
  if (inv.companyId && !inCompanyScope(user, inv.companyId)) throw new Error("That company isn't in your scope");
}

export async function generateInvoiceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("invoices.edit");
  const companyId = String(fd.get("companyId") ?? "");
  const periodStart = String(fd.get("periodStart") ?? "");
  const periodEnd = String(fd.get("periodEnd") ?? "");
  if (!companyId) return fail("Pick a company");
  if (!isValidISODate(periodStart) || !isValidISODate(periodEnd)) return fail("Pick the billing period");
  try {
    // Contract-aware (WP-12): company-share adjustments billed once, due date from the contract's credit terms; company scope checked.
    const inv = await generateCompanyInvoice(user, { companyId, periodStart, periodEnd, grouping: fd.get("grouping") === "DAY" ? "DAY" : "ORDER" });
    return done(`Draft ${inv.number} created`, `/admin/invoices/${inv.id}`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function issueInvoiceAction(id: string) {
  const user = await requirePermission("invoices.edit");
  try {
    await issueCompanyInvoice(user, id);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function recordPaymentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("invoices.edit");
  const amount = parseRupees(String(fd.get("amount") ?? ""));
  if (amount == null) return fail("Enter the amount received");
  try {
    await invoiceInScope(user, String(fd.get("id")));
    await recordInvoicePayment(String(fd.get("id")), user.id, amount, String(fd.get("reference") ?? ""));
    return done("Payment recorded");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function voidInvoiceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("invoices.edit");
  try {
    await invoiceInScope(user, String(fd.get("id")));
    await voidInvoice(String(fd.get("id")), user.id, String(fd.get("reason") ?? ""));
    return done("Invoice voided — its meals can be billed again");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function creditNoteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("invoices.edit");
  const amount = parseRupees(String(fd.get("amount") ?? ""));
  if (amount == null) return fail("Enter the amount to credit");
  try {
    await invoiceInScope(user, String(fd.get("id")));
    const cn = await createCreditNote(String(fd.get("id")), user.id, amount, String(fd.get("reason") ?? ""));
    return done(`Credit note ${cn.number} issued`, `/admin/invoices/${cn.id}`);
  } catch (e) {
    return fail(msg(e));
  }
}
