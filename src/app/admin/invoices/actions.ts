"use server";
import { requirePermission } from "@/lib/auth";
import { isValidISODate } from "@/lib/dates";
import { parseRupees } from "@/lib/money";
import { fail, done, type ActionResult } from "@/lib/action";
import { createCreditNote, generateInvoice, issueInvoice, recordInvoicePayment, voidInvoice } from "@/server/invoices";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export async function generateInvoiceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("invoices");
  const companyId = String(fd.get("companyId") ?? "");
  const periodStart = String(fd.get("periodStart") ?? "");
  const periodEnd = String(fd.get("periodEnd") ?? "");
  if (!companyId) return fail("Pick a company");
  if (!isValidISODate(periodStart) || !isValidISODate(periodEnd)) return fail("Pick the billing period");
  try {
    const inv = await generateInvoice({ companyId, periodStart, periodEnd, actorId: user.id, grouping: fd.get("grouping") === "DAY" ? "DAY" : "ORDER" });
    return done(`Draft ${inv.number} created`, `/admin/invoices/${inv.id}`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function issueInvoiceAction(id: string) {
  const user = await requirePermission("invoices");
  try {
    await issueInvoice(id, user.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function recordPaymentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("invoices");
  const amount = parseRupees(String(fd.get("amount") ?? ""));
  if (amount == null) return fail("Enter the amount received");
  try {
    await recordInvoicePayment(String(fd.get("id")), user.id, amount, String(fd.get("reference") ?? ""));
    return done("Payment recorded");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function voidInvoiceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("invoices");
  try {
    await voidInvoice(String(fd.get("id")), user.id, String(fd.get("reason") ?? ""));
    return done("Invoice voided — its meals can be billed again");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function creditNoteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("invoices");
  const amount = parseRupees(String(fd.get("amount") ?? ""));
  if (amount == null) return fail("Enter the amount to credit");
  try {
    const cn = await createCreditNote(String(fd.get("id")), user.id, amount, String(fd.get("reason") ?? ""));
    return done(`Credit note ${cn.number} issued`, `/admin/invoices/${cn.id}`);
  } catch (e) {
    return fail(msg(e));
  }
}
