"use server";
import type { MemberRole } from "@prisma/client";
import { requireCompanyAdmin } from "@/lib/auth";
import { siteUrl } from "@/lib/site-url";
import { isValidISODate } from "@/lib/dates";
import { fail, done, type ActionResult } from "@/lib/action";
import { parseRupees } from "@/lib/money";
import { cleanWeekdays } from "@/server/corporate";
import { InvoicePaymentError, startInvoicePayment } from "@/server/invoice-payments";
import { PaymentError, startPayment, type StartResult } from "@/server/payments";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/logger";
import { commitImport, createInvite, parseRosterCsv, placeTeamOrder, revokeInvite, setTeamBudget, setTeamDeliveryInstructions, updateMember, type ImportRow, type TeamOrderResult } from "@/server/team";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function updateMemberAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user, company } = await requireCompanyAdmin();
  try {
    const status = s(fd, "status");
    const allowance = s(fd, "allowanceOverride");
    if (allowance && parseRupees(allowance) == null) return fail("Allowance must be rupees, e.g. 3000");
    await updateMember(company.id, s(fd, "memberId"), user.id, {
      ...(status === "ACTIVE" || status === "REMOVED" ? { status } : {}),
      role: (s(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER") as MemberRole,
      department: s(fd, "department") || null,
      costCenter: s(fd, "costCenter") || null,
      employeeCode: s(fd, "employeeCode") || null,
      officeLocationId: s(fd, "officeLocationId") || null,
      ...(fd.has("eligibilityForm")
        ? { mealEligible: fd.get("mealEligible") === "on", eligibleDays: cleanWeekdays(fd.getAll("eligibleDays").map(String)), allowanceOverride: allowance ? parseRupees(allowance) : null }
        : {}),
    });
    return done(status === "REMOVED" ? "Removed from the team" : status === "ACTIVE" ? "Approved" : "Saved");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function inviteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user, company } = await requireCompanyAdmin();
  try {
    await createInvite(company.id, { id: user.id, name: user.name }, { email: s(fd, "email"), name: s(fd, "name"), department: s(fd, "department"), role: s(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER" }, await siteUrl());
    return done(`Invite emailed to ${s(fd, "email")} (valid 14 days)`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function revokeInviteAction(id: string) {
  const { company } = await requireCompanyAdmin();
  try {
    await revokeInvite(company.id, id);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export type ImportState = ActionResult & { rows?: ImportRow[]; results?: { email: string; ok: boolean; message: string }[]; csv?: string };

/** Step 1 previews (nothing saved); step 2 (commit=1) sends invites for valid rows only. */
export async function importAction(_: ImportState, fd: FormData): Promise<ImportState> {
  const { user, company } = await requireCompanyAdmin();
  let text = s(fd, "csv");
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 200_000) return { ok: false, message: "Keep the file under 200 KB (about 500 people)" };
    text = await file.text();
  }
  if (!text) return { ok: false, message: "Paste the list or choose a CSV file" };
  const rows = parseRosterCsv(text);
  if (!rows.length) return { ok: false, message: "No rows found" };
  if (fd.get("commit") !== "1") {
    const bad = rows.filter((r) => r.error).length;
    return { ok: false, rows, csv: text, message: bad ? `${bad} row(s) have problems and will be skipped. Fix them or continue.` : `${rows.length} people ready to invite.` };
  }
  const results = await commitImport(company.id, { id: user.id, name: user.name }, rows, await siteUrl());
  return { ok: true, results, message: `${results.filter((r) => r.ok).length} of ${rows.length} invited` };
}

export type TeamOrderState = ActionResult & { results?: TeamOrderResult[] };

export async function teamOrderAction(_: TeamOrderState, fd: FormData): Promise<TeamOrderState> {
  const { user, company } = await requireCompanyAdmin();
  const date = s(fd, "date");
  if (!isValidISODate(date)) return { ok: false, message: "Pick a date" };
  const memberIds = fd.getAll("memberId").map(String).filter(Boolean);
  try {
    const results = await placeTeamOrder(company.id, { id: user.id }, { memberIds, date, boxId: s(fd, "boxId"), slotId: s(fd, "slotId") || null, overBudget: fd.get("employeePays") === "on" ? "employee-pays" : "refuse" });
    const ok = results.filter((r) => r.ok).length;
    return { ok: ok > 0, results, message: `${ok} of ${results.length} dabbas ordered` };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function saveBudgetAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user, company } = await requireCompanyAdmin();
  try {
    const raw = s(fd, "amount");
    const amount = raw ? parseRupees(raw) : null;
    if (raw && amount == null) return fail("Budget must be rupees, e.g. 25000");
    await setTeamBudget(company.id, user.id, { department: s(fd, "department"), month: s(fd, "month"), amount });
    return done(amount == null ? "Budget removed" : "Budget saved");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function saveDeliveryInstructionsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user, company } = await requireCompanyAdmin();
  try {
    await setTeamDeliveryInstructions(company.id, user.id, s(fd, "deliveryInstructions") || null);
    return done("Delivery instructions saved — they go on every delivery to your offices");
  } catch (e) {
    return fail(msg(e));
  }
}

/**
 * Pay an issued invoice's outstanding balance online (eSewa / Khalti). Company admin only; the invoice must belong to
 * the admin's company (checked again in startInvoicePayment and in startPayment). Returns the gateway start.
 */
export async function startInvoicePaymentAction(invoiceId: string, method: string): Promise<{ ok: boolean; error?: string; start?: StartResult; paymentId?: string }> {
  const { user, company } = await requireCompanyAdmin();
  if (!(await rateLimit("shop:payStart", user.id, LIMITS.payStart.max, LIMITS.payStart.windowMs))) return { ok: false, error: "Too many attempts — wait a minute and try again" };
  try {
    const { payment } = await startInvoicePayment(user, { invoiceId: String(invoiceId).slice(0, 64), method: String(method), companyId: company.id });
    return { ok: true, paymentId: payment.id, start: await startPayment(payment.id, user.id, await siteUrl()) };
  } catch (e) {
    if (e instanceof InvoicePaymentError || e instanceof PaymentError) return { ok: false, error: e.message };
    log.error("team.invoice_pay_failed", { invoiceId, error: e });
    return { ok: false, error: "We couldn't reach the payment provider — try again in a minute" };
  }
}
