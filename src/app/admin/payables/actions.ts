"use server";
import { done, type ActionResult } from "@/lib/action";
import { storeUpload } from "@/lib/upload";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";
import { createSupplierInvoice, recordSupplierPayment, reverseSupplierPayment, voidSupplierInvoice } from "@/server/finance/payables";

const PATHS = ["/admin/payables"];

export async function createSupplierInvoiceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "purchasing.create",
    async (user) => {
      const file = fd.get("attachment");
      const attachmentUrl = file instanceof File && file.size > 0 ? (await storeUpload(file, { allowPdf: true, folder: "supplier-invoices" })).url : null;
      const inv = await createSupplierInvoice(user, {
        supplierId: f.str(fd, "supplierId", 40),
        poId: f.opt(fd, "poId", 40),
        number: f.str(fd, "number", 60),
        date: f.date(fd, "date") ?? "",
        dueDate: f.date(fd, "dueDate"),
        subtotal: f.money(fd, "subtotal", "Amount"),
        tax: f.moneyOpt(fd, "tax", "Tax") ?? 0,
        attachmentUrl,
      });
      return done(`Invoice ${inv.number} recorded`, `/admin/payables/${inv.id}`);
    },
    PATHS,
  );
}

export async function recordSupplierPaymentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "purchasing.approve",
    async (user) => {
      await recordSupplierPayment(user, { invoiceId: f.str(fd, "invoiceId", 40), amount: f.money(fd, "amount", "Amount"), method: f.str(fd, "method", 20), reference: f.str(fd, "reference", 120), paidAt: f.date(fd, "paidAt") ?? undefined });
      return done("Payment recorded");
    },
    PATHS,
  );
}

export async function reverseSupplierPaymentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "purchasing.approve",
    async (user) => {
      await reverseSupplierPayment(user, f.str(fd, "paymentId", 40), f.str(fd, "reason", 300));
      return done("Payment reversed");
    },
    PATHS,
  );
}

export async function voidSupplierInvoiceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "purchasing.approve",
    async (user) => {
      await voidSupplierInvoice(user, f.str(fd, "id", 40), f.str(fd, "reason", 300));
      return done("Invoice voided");
    },
    PATHS,
  );
}
