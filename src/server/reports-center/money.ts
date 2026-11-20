import "server-only";
import { db } from "@/lib/db";
import { ktmNow } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { NONE } from "@/server/analytics/filters";
import { METRICS } from "@/server/analytics/metrics";
import * as rev from "@/server/analytics/revenue";
import { companyOrderReport, companyOutstanding, departmentSummary } from "@/server/corporate";
import { AGEING_BUCKETS, payablesAgeing } from "@/server/finance/payables";
import { LIVE_STATUSES, REVENUE_STATUSES } from "@/server/transitions";
import { pageOf, totalsOf, windowOf } from "./common";
import type { Col, Ctx, ReportDef, Row } from "./types";

const LIVE = new Set<string>(REVENUE_STATUSES);

function scopedCompanyWhere(ctx: Ctx) {
  const and: { id: string | { in: string[] } }[] = [];
  if (ctx.companyIds) and.push({ id: { in: ctx.companyIds } });
  if (ctx.f.companyId && ctx.f.companyId !== NONE) and.push({ id: ctx.f.companyId });
  return and.length ? { AND: and } : {};
}

// ───────────── corporate billing ─────────────

const COMPANY_COLS: Col[] = [
  { key: "company", label: "Company" },
  { key: "orders", label: "Orders", kind: "int" },
  { key: "meals", label: "Meals", kind: "int" },
  { key: "share", label: "Company share", kind: "money" },
  { key: "adjustments", label: "Company adjustments", kind: "money" },
  { key: "employee", label: "Employee share", kind: "money" },
  { key: "discount", label: "Discount", kind: "money" },
  { key: "invoiced", label: "Company share invoiced", kind: "money" },
  { key: "notInvoiced", label: "Not invoiced yet", kind: "money" },
];
const DEPT_COLS: Col[] = [
  { key: "department", label: "Department" },
  { key: "orders", label: "Orders", kind: "int" },
  { key: "meals", label: "Meals", kind: "int" },
  { key: "share", label: "Company share (incl. adjustments)", kind: "money" },
  { key: "employee", label: "Employee share", kind: "money" },
  { key: "discount", label: "Discount", kind: "money" },
];
const ORDER_COLS: Col[] = [
  { key: "date", label: "Date", kind: "date" },
  { key: "number", label: "Order" },
  { key: "name", label: "Employee" },
  { key: "email", label: "Email", kind: "email" },
  { key: "department", label: "Department" },
  { key: "costCenter", label: "Cost centre" },
  { key: "employeeCode", label: "Employee #" },
  { key: "items", label: "Lunch" },
  { key: "meals", label: "Meals", kind: "int" },
  { key: "status", label: "Status" },
  { key: "companyShare", label: "Company share", kind: "money" },
  { key: "companyAdjustments", label: "Company adjustments", kind: "money" },
  { key: "employeeShare", label: "Employee share", kind: "money" },
  { key: "invoiced", label: "Invoiced" },
];

export const corporateBilling: ReportDef = {
  key: "corporate-billing",
  title: "Corporate billing",
  group: "Money owed",
  description: "Employer and employee shares per company, department or order, and how much is invoiced.",
  definition:
    "corporate.companyOrderReport / departmentSummary for delivery dates in the range — the same rows as the company report and the /team portal. Cancelled and skipped orders are excluded from totals. Company-share adjustments from staff edits (billed once on the next invoice) are their own column per company / order and are included in the department company share (departmentSummary). Not invoiced = live company share on orders not on an invoice yet.",
  view: ["corporate.view"],
  exportPerms: [],
  filters: ["range", "company"],
  choices: [{ name: "view", label: "Rows", options: [{ value: "companies", label: "Per company" }, { value: "departments", label: "Per department" }, { value: "orders", label: "Per order" }] }],
  columns: COMPANY_COLS,
  async run(ctx, paging) {
    const { f, choice } = ctx;
    const one = f.companyId && f.companyId !== NONE ? f.companyId : null;
    if (choice.view !== "companies") {
      if (!one || (ctx.companyIds && !ctx.companyIds.includes(one))) return { rows: [], count: 0, columns: choice.view === "orders" ? ORDER_COLS : DEPT_COLS, notes: ["Pick a company to see its departments or orders."] };
      const report = await companyOrderReport(one, f.from, f.to);
      if (choice.view === "orders") {
        const rows: Row[] = report.map((r) => ({ ...r, invoiced: r.invoiced ? "Yes" : "No" }));
        const live = report.filter((r) => LIVE.has(r.status));
        return {
          rows: pageOf(rows, paging),
          count: rows.length,
          columns: ORDER_COLS,
          totals: { date: "Total (live orders)", meals: live.reduce((a, r) => a + r.meals, 0), companyShare: live.reduce((a, r) => a + r.companyShare, 0), companyAdjustments: live.reduce((a, r) => a + r.companyAdjustments, 0), employeeShare: live.reduce((a, r) => a + r.employeeShare, 0) },
        };
      }
      const depts = departmentSummary(report).map((d) => ({ department: d.department || "No department", orders: d.orders, meals: d.meals, share: d.company, employee: d.employee, discount: d.discount }));
      return { rows: pageOf(depts, paging), count: depts.length, columns: DEPT_COLS, totals: totalsOf(depts, ["orders", "meals", "share", "employee", "discount"], { department: "Total" }) };
    }
    const companies = await db.company.findMany({ where: scopedCompanyWhere(ctx), orderBy: { name: "asc" }, select: { id: true, name: true } });
    const reports = await Promise.all(companies.map((c) => companyOrderReport(c.id, f.from, f.to)));
    const all: Row[] = [];
    companies.forEach((c, i) => {
      const live = reports[i].filter((r) => LIVE.has(r.status));
      if (!reports[i].length) return;
      const share = live.reduce((a, r) => a + r.companyShare, 0);
      const invoiced = live.filter((r) => r.invoiced).reduce((a, r) => a + r.companyShare, 0);
      all.push({
        company: c.name,
        orders: live.length,
        meals: live.reduce((a, r) => a + r.meals, 0),
        share,
        adjustments: live.reduce((a, r) => a + r.companyAdjustments, 0),
        employee: live.reduce((a, r) => a + r.employeeShare, 0),
        discount: live.reduce((a, r) => a + r.discount, 0),
        invoiced,
        notInvoiced: share - invoiced,
      });
    });
    return { rows: pageOf(all, paging), count: all.length, totals: totalsOf(all, ["orders", "meals", "share", "adjustments", "employee", "discount", "invoiced", "notInvoiced"], { company: "Total" }) };
  },
};

// ───────────── outstanding payments ─────────────

const CUSTOMER_COLS: Col[] = [
  { key: "created", label: "Created" },
  { key: "reference", label: "Payment" },
  { key: "method", label: "Method" },
  { key: "customer", label: "Customer" },
  { key: "email", label: "Email", kind: "email" },
  { key: "phone", label: "Phone", kind: "phone" },
  { key: "orders", label: "Orders" },
  { key: "amount", label: "Amount due", kind: "money" },
  { key: "note", label: "Note" },
];
const OWED_COLS: Col[] = [
  { key: "company", label: "Company" },
  { key: "invoices", label: "Unpaid invoices", kind: "money" },
  { key: "uninvoiced", label: "Meals not invoiced", kind: "money" },
  { key: "adjustments", label: "Unbilled adjustments", kind: "money" },
  { key: "total", label: "Owes now", kind: "money" },
];
const SUPPLIER_COLS: Col[] = [{ key: "supplier", label: "Supplier" }, ...AGEING_BUCKETS.map((b) => ({ key: b.key, label: b.label, kind: "money" as const })), { key: "total", label: "Total", kind: "money" }];

export const outstandingPayments: ReportDef = {
  key: "outstanding-payments",
  title: "Outstanding payments",
  group: "Money owed",
  description: "Money owed right now — by customers (pending payments), companies (invoices + unbilled share) or to suppliers.",
  definition:
    "Snapshot now. Customers: payments still Pending (online not completed, cash not collected, transfer not verified) — Analytics → Awaiting payment; extra charges from staff order edits are pending payments too. Companies: corporate.companyOutstanding — unpaid invoice balances + company share of live meals not invoiced + company-share adjustments not billed yet. Suppliers: finance.payablesAgeing by due date.",
  view: ["analytics.view"],
  exportPerms: ["analytics.export"],
  filters: ["kitchen", "company"],
  snapshot: true,
  choices: [{ name: "side", label: "Owed by", options: [{ value: "customers", label: "Customers" }, { value: "companies", label: "Companies" }, { value: "suppliers", label: "Owed to suppliers" }] }],
  columns: CUSTOMER_COLS,
  async run(ctx, paging) {
    const { f, choice } = ctx;
    if (choice.side === "suppliers") {
      if (!can(ctx.user, "purchasing.view")) return { rows: [], count: 0, columns: SUPPLIER_COLS, notes: ["Supplier balances need the Supplier invoices & payables permission."] };
      const a = await payablesAgeing(ctx.today);
      const all = a.suppliers.filter((s) => s.total !== 0).map((s) => ({ supplier: s.name, ...s.buckets, total: s.total }));
      return { rows: pageOf(all, paging), count: all.length, columns: SUPPLIER_COLS, totals: { supplier: "Total", ...a.totals, total: a.total } };
    }
    if (choice.side === "companies") {
      const companies = await db.company.findMany({ where: scopedCompanyWhere(ctx), orderBy: { name: "asc" }, select: { id: true, name: true } });
      const rows = await Promise.all(
        companies.map(async (c) => {
          const [total, inv, uninv] = await Promise.all([
            companyOutstanding(c.id),
            db.invoice.findMany({ where: { companyId: c.id, kind: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { total: true, paidAmount: true } }),
            db.order.aggregate({ _sum: { companyShare: true }, where: { companyId: c.id, invoiceId: null, status: { in: LIVE_STATUSES } } }),
          ]);
          const invoices = inv.reduce((a, i) => a + i.total - i.paidAmount, 0);
          const uninvoiced = uninv._sum.companyShare ?? 0;
          return { company: c.name, invoices, uninvoiced, adjustments: total - invoices - uninvoiced, total };
        }),
      );
      const all = rows.filter((r) => r.total !== 0 || r.invoices !== 0).sort((a, b) => b.total - a.total);
      return { rows: pageOf(all, paging), count: all.length, columns: OWED_COLS, totals: totalsOf(all, ["invoices", "uninvoiced", "adjustments", "total"], { company: "Total" }) };
    }
    const where = rev.pendingPaymentsWhere(f);
    const [count, recv, list] = await Promise.all([
      db.payment.count({ where }),
      rev.receivables(f),
      db.payment.findMany({
        where,
        orderBy: { createdAt: "asc" },
        ...windowOf(paging),
        select: { createdAt: true, reference: true, method: true, amount: true, note: true, user: { select: { name: true, email: true, phoneNumber: true } }, orders: { select: { number: true }, take: 5 } },
      }),
    ]);
    return {
      rows: list.map((p) => ({ created: `${ktmNow(p.createdAt).date} ${ktmNow(p.createdAt).time}`, reference: p.reference, method: p.method, customer: p.user.name, email: p.user.email, phone: p.user.phoneNumber, orders: p.orders.map((o) => o.number).join(", "), amount: p.amount, note: p.note ?? "" })),
      count,
      totals: { created: "Total", amount: recv.pending },
      summary: [
        { label: METRICS.receivablesPending.label, value: recv.pending, kind: "money", note: METRICS.receivablesPending.definition },
        ...(recv.invoicesOutstanding != null ? [{ label: METRICS.receivablesInvoices.label, value: recv.invoicesOutstanding, kind: "money" as const, note: METRICS.receivablesInvoices.definition }] : []),
        ...(recv.companyUnbilled != null ? [{ label: METRICS.receivablesCompanyUnbilled.label, value: recv.companyUnbilled, kind: "money" as const, note: METRICS.receivablesCompanyUnbilled.definition }] : []),
      ],
    };
  },
};
