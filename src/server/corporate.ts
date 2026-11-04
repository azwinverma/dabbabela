import type { Company } from "@prisma/client";
import { db } from "@/lib/db";
import { dateOnly, monthRange } from "@/lib/dates";
import type { CompanySpec } from "./pricing";
import { LIVE_STATUSES } from "./transitions";

/** Company pricing spec for a member, with this month's remaining allowance. */
export async function companySpecFor(userId: string, company: Company, dates: string[]): Promise<CompanySpec> {
  let allowanceRemaining: number | null = null;
  const member = await db.companyMember.findUnique({ where: { userId } });
  const allowance = member?.allowanceOverride ?? company.monthlyAllowance;
  if (allowance != null && company.billingMode !== "EMPLOYEE_PAID") {
    const { start, end } = monthRange((dates[0] ?? "").slice(0, 7));
    const used = await db.order.aggregate({
      _sum: { companyShare: true },
      where: { userId, companyId: company.id, status: { in: LIVE_STATUSES }, deliveryDate: { gte: dateOnly(start), lte: dateOnly(end) } },
    });
    allowanceRemaining = Math.max(0, allowance - (used._sum.companyShare ?? 0));
  }
  return {
    discountPct: company.discountPct,
    freeDelivery: company.freeDelivery,
    billingMode: company.billingMode,
    subsidyPct: company.billingMode === "COMPANY_PAID" ? 100 : company.subsidyPct,
    subsidyCap: company.subsidyCap,
    allowanceRemaining,
  };
}

/** Employer money owed: company share of live orders not yet invoiced + unpaid invoice balances. */
export async function companyOutstanding(companyId: string) {
  const [uninvoiced, invoices] = await Promise.all([
    db.order.aggregate({ _sum: { companyShare: true }, where: { companyId, invoiceId: null, status: { in: LIVE_STATUSES } } }),
    db.invoice.findMany({ where: { companyId, kind: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { total: true, paidAmount: true } }),
  ]);
  return (uninvoiced._sum.companyShare ?? 0) + invoices.reduce((a, i) => a + i.total - i.paidAmount, 0);
}
