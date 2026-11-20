import "server-only";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, monthRange } from "@/lib/dates";
import { budgetStatus, minCommitment, unpaidInvoices } from "@/server/corporate";
import type { Detector, Finding } from "../types";

const rs = (p: number) => `Rs ${(p / 100).toFixed(2)}`;

/** Unpaid corporate invoices past their due date (CRITICAL after 30 days). Clears when paid. */
export const corporateInvoices: Detector = {
  name: "corporate-invoices",
  label: "Unpaid corporate invoices",
  mode: "condition",
  async run() {
    const companies = await db.company.findMany({ where: { invoices: { some: { kind: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_PAID"] } } } }, select: { id: true, name: true } });
    const out: Finding[] = [];
    for (const c of companies) {
      for (const i of await unpaidInvoices(c.id)) {
        if (i.overdueDays <= 0) continue;
        out.push({ type: "INVOICE_OVERDUE", severity: i.overdueDays > 30 ? "CRITICAL" : "WARNING", entity: "Invoice", entityId: i.id, key: i.id, message: `${c.name}: invoice ${i.number} is ${i.overdueDays} day${i.overdueDays === 1 ? "" : "s"} overdue (${rs(i.outstanding)} outstanding)`, href: `/admin/invoices/${i.id}`, data: { companyId: c.id, number: i.number, due: i.due, outstanding: i.outstanding, overdueDays: i.overdueDays } });
      }
    }
    return out;
  },
};

/** Active corporate contracts ending within 30 days (CRITICAL within 7), and department budgets over their monthly cap. */
export const corporateAccounts: Detector = {
  name: "corporate-accounts",
  label: "Expiring corporate contracts and budgets",
  mode: "condition",
  async run({ today }) {
    const out: Finding[] = [];
    const ending = await db.corporateContract.findMany({ where: { status: "ACTIVE", endsOn: { gte: dateOnly(today), lte: dateOnly(addDays(today, 30)) } }, include: { company: { select: { id: true, name: true } } } });
    for (const c of ending) {
      const ends = isoDate(c.endsOn!);
      const renewed = await db.corporateContract.count({ where: { companyId: c.companyId, id: { not: c.id }, status: { in: ["DRAFT", "ACTIVE"] }, startsOn: { gt: c.endsOn! } } });
      if (renewed) continue; // a following contract is already lined up
      const days = Math.round((dateOnly(ends).getTime() - dateOnly(today).getTime()) / 86_400_000);
      out.push({ type: "CONTRACT_EXPIRING", severity: days <= 7 ? "CRITICAL" : "WARNING", entity: "CorporateContract", entityId: c.id, key: `contract:${c.id}`, message: `${c.company.name}: contract "${c.title}" v${c.version} ends ${ends} (${days} day${days === 1 ? "" : "s"})`, href: `/admin/companies/${c.company.id}`, data: { companyId: c.company.id, endsOn: ends, days } });
    }
    const ym = today.slice(0, 7);
    const companies = await db.company.findMany({ where: { isActive: true, budgets: { some: { month: ym } } }, select: { id: true, name: true } });
    for (const c of companies) {
      for (const b of await budgetStatus(c.id, ym)) {
        if (!b.over) continue;
        out.push({ type: "BUDGET_OVER", severity: "WARNING", entity: "Company", entityId: c.id, key: `budget:${c.id}:${ym}:${b.department || "-"}`, message: `${c.name}: ${b.department || "No department"} spent ${rs(b.spent)} of a ${rs(b.budget ?? 0)} budget in ${ym}`, href: `/admin/companies/${c.id}`, data: { month: ym, ...b } });
      }
    }
    return out;
  },
};

/** Last month's minimum-commitment shortfall per company (raised once per month). */
export const corporateShortfall: Detector = {
  name: "corporate-shortfall",
  label: "Corporate minimum-commitment shortfall",
  mode: "event",
  async run({ today }) {
    const prev = monthRange(addDays(monthRange(today.slice(0, 7)).start, -1).slice(0, 7));
    const companies = await db.company.findMany({ where: { contracts: { some: { minMealsPerMonth: { not: null }, status: { in: ["ACTIVE", "ENDED"] } } } }, select: { id: true, name: true } });
    const out: Finding[] = [];
    for (const c of companies) {
      const m = await minCommitment(c.id, prev.ym);
      if (!m.shortfall) continue;
      out.push({ type: "COMMITMENT_SHORTFALL", severity: "INFO", entity: "Company", entityId: c.id, key: `${c.id}:${prev.ym}`, message: `${c.name}: ${m.meals} of ${m.minMealsPerMonth} committed meals in ${prev.ym} (short ${m.shortfall})`, href: `/admin/companies/${c.id}`, data: { ...m } });
    }
    return out;
  },
};
