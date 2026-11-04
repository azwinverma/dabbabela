import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dateOnly, daysBetween, formatDay, isoDate, todayKTM } from "@/lib/dates";
import { audit } from "@/lib/audit";
import { rs } from "@/lib/money";
import { REVENUE_STATUSES } from "./transitions";

type Tx = Prisma.TransactionClient;

export class InvoiceError extends Error {}

async function nextNumber(tx: Tx, prefix: "INV" | "CN", year: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-number:${prefix}:${year}`}))`;
  const last = await tx.invoice.findFirst({ where: { number: { startsWith: `${prefix}-${year}-` } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? parseInt(last.number.split("-")[2], 10) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}

/** VAT contained in the employer's share of an order (proportional to the share of the order total). */
export function shareTax(o: { tax: number; total: number; companyShare: number }) {
  if (!o.tax || !o.total) return 0;
  return Math.round((o.tax * o.companyShare) / o.total);
}

/**
 * Bill the employer share of a company's meals for a period. Only orders that are not yet invoiced,
 * already due (delivery date ≤ today) and not cancelled/skipped are included, so running this twice
 * for the same period never double-bills. Creates a DRAFT.
 */
export async function generateInvoice(input: { companyId: string; periodStart: string; periodEnd: string; actorId: string; grouping?: "ORDER" | "DAY" }) {
  if (input.periodEnd < input.periodStart) throw new InvoiceError("Period end is before the start");
  const lastDay = input.periodEnd < todayKTM() ? input.periodEnd : todayKTM();
  const inv = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-company:${input.companyId}`}))`;
      const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId } });
      const orders = await tx.order.findMany({
        where: {
          companyId: company.id,
          invoiceId: null,
          companyShare: { gt: 0 },
          status: { in: REVENUE_STATUSES },
          deliveryDate: { gte: dateOnly(input.periodStart), lte: dateOnly(lastDay) },
        },
        include: { user: { select: { name: true } }, items: { select: { name: true, quantity: true } } },
        orderBy: [{ deliveryDate: "asc" }, { number: "asc" }],
      });
      if (!orders.length) throw new InvoiceError("Nothing to invoice for that period — every meal is already billed or none were company-paid.");
      const total = orders.reduce((a, o) => a + o.companyShare, 0);
      const tax = orders.reduce((a, o) => a + shareTax(o), 0);
      const discount = 0;
      let lines: Prisma.InvoiceLineCreateWithoutInvoiceInput[];
      if (input.grouping === "DAY") {
        const byDay = new Map<string, typeof orders>();
        for (const o of orders) byDay.set(isoDate(o.deliveryDate), [...(byDay.get(isoDate(o.deliveryDate)) ?? []), o]);
        lines = [...byDay.entries()].map(([d, os]) => {
          const meals = os.reduce((a, o) => a + o.items.reduce((b, i) => b + i.quantity, 0), 0);
          const amount = os.reduce((a, o) => a + o.companyShare, 0);
          return { description: `Staff lunches — ${formatDay(d, "long")} (${os.length} orders)`, quantity: meals, unitPrice: meals ? Math.round(amount / meals) : amount, amount };
        });
      } else {
        lines = orders.map((o) => {
          const meals = o.items.reduce((a, i) => a + i.quantity, 0);
          return {
            order: { connect: { id: o.id } },
            description: `${formatDay(isoDate(o.deliveryDate))} · ${o.number} · ${o.user.name} · ${o.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(", ")}`.slice(0, 300),
            quantity: meals,
            unitPrice: meals ? Math.round(o.companyShare / meals) : o.companyShare,
            amount: o.companyShare,
          };
        });
      }
      const created = await tx.invoice.create({
        data: {
          number: await nextNumber(tx, "INV", input.periodStart.slice(0, 4)),
          kind: "INVOICE",
          companyId: company.id,
          periodStart: dateOnly(input.periodStart),
          periodEnd: dateOnly(input.periodEnd),
          status: "DRAFT",
          billingName: company.legalName || company.name,
          billingAddress: company.billingAddress,
          panVat: company.panVat,
          subtotal: total - tax,
          discount,
          tax,
          total,
          createdById: input.actorId,
          lines: { create: lines },
        },
      });
      const linked = await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) }, invoiceId: null }, data: { invoiceId: created.id } });
      if (linked.count !== orders.length) throw new InvoiceError("Some orders were invoiced at the same time — try again");
      return created;
    },
    { timeout: 30_000 },
  );
  await audit({ actorId: input.actorId, action: "invoice.generate", entity: "Invoice", entityId: inv.id, summary: `${inv.number} ${rs(inv.total)}`, after: { period: [input.periodStart, input.periodEnd] } });
  return inv;
}

export async function issueInvoice(id: string, actorId: string) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id }, include: { company: true } });
  if (inv.status !== "DRAFT") throw new InvoiceError("Only drafts can be issued");
  const today = todayKTM();
  const updated = await db.invoice.update({
    where: { id },
    data: { status: "ISSUED", issuedAt: new Date(), dueDate: dateOnly(addDays(today, inv.company?.invoiceTermsDays ?? 15)) },
  });
  await audit({ actorId, action: "invoice.issue", entity: "Invoice", entityId: id, summary: inv.number });
  return updated;
}

function outstanding(inv: { total: number; paidAmount: number }) {
  return inv.total - inv.paidAmount;
}

export async function recordInvoicePayment(id: string, actorId: string, amount: number, reference: string) {
  if (amount <= 0) throw new InvoiceError("Enter the amount received");
  if (!reference.trim()) throw new InvoiceError("Enter the bank / cheque reference");
  const inv = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${id}`}))`;
    const i = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (i.kind !== "INVOICE" || !["ISSUED", "PARTIALLY_PAID"].includes(i.status)) throw new InvoiceError("Issue the invoice before recording payment");
    if (amount > outstanding(i)) throw new InvoiceError(`Only ${rs(outstanding(i))} is outstanding`);
    const paid = i.paidAmount + amount;
    return tx.invoice.update({
      where: { id },
      data: { paidAmount: paid, status: paid >= i.total ? "PAID" : "PARTIALLY_PAID", note: [i.note, `${todayKTM()} received ${rs(amount)} (${reference.trim()})`].filter(Boolean).join("\n") },
    });
  });
  await audit({ actorId, action: "invoice.payment", entity: "Invoice", entityId: id, summary: `${rs(amount)} · ${reference}` });
  return inv;
}

/** Void an unpaid invoice: its orders become billable again. */
export async function voidInvoice(id: string, actorId: string, reason: string) {
  if (!reason.trim()) throw new InvoiceError("Give a reason");
  const inv = await db.$transaction(async (tx) => {
    const i = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (i.status === "VOID") throw new InvoiceError("Already void");
    if (i.paidAmount > 0) throw new InvoiceError("Money has been received on this invoice — issue a credit note instead");
    await tx.order.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    return tx.invoice.update({ where: { id }, data: { status: "VOID", note: [i.note, `VOID: ${reason}`].filter(Boolean).join("\n") } });
  });
  await audit({ actorId, action: "invoice.void", entity: "Invoice", entityId: id, summary: inv.number, reason });
  return inv;
}

/**
 * Credit note against an issued invoice (e.g. meals that arrived cold). It reduces what the company
 * owes on the original invoice; the original lines are never edited.
 */
export async function createCreditNote(invoiceId: string, actorId: string, amount: number, reason: string) {
  if (amount <= 0) throw new InvoiceError("Enter an amount");
  if (!reason.trim()) throw new InvoiceError("Give a reason");
  const cn = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${invoiceId}`}))`;
    const i = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (i.kind !== "INVOICE" || !["ISSUED", "PARTIALLY_PAID", "PAID"].includes(i.status)) throw new InvoiceError("Credit notes need an issued invoice");
    const credited = await tx.invoice.aggregate({ where: { relatedId: i.id, kind: "CREDIT_NOTE", status: { not: "VOID" } }, _sum: { total: true } });
    const room = i.total - (credited._sum.total ?? 0);
    if (amount > room) throw new InvoiceError(`At most ${rs(room)} can still be credited`);
    const tax = i.total ? Math.round((i.tax * amount) / i.total) : 0;
    const note = await tx.invoice.create({
      data: {
        number: await nextNumber(tx, "CN", todayKTM().slice(0, 4)),
        kind: "CREDIT_NOTE",
        companyId: i.companyId,
        userId: i.userId,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        status: "ISSUED",
        billingName: i.billingName,
        billingAddress: i.billingAddress,
        panVat: i.panVat,
        subtotal: amount - tax,
        tax,
        total: amount,
        issuedAt: new Date(),
        relatedId: i.id,
        note: reason,
        createdById: actorId,
        lines: { create: [{ description: `Credit against ${i.number}: ${reason}`.slice(0, 300), quantity: 1, unitPrice: amount, amount }] },
      },
    });
    // Settle the original by the credited amount (what is still unpaid first).
    const settle = Math.min(amount, outstanding(i));
    if (settle > 0) {
      const paid = i.paidAmount + settle;
      await tx.invoice.update({ where: { id: i.id }, data: { paidAmount: paid, status: paid >= i.total ? "PAID" : "PARTIALLY_PAID", note: [i.note, `${note.number} credited ${rs(amount)}`].join("\n") } });
    }
    return note;
  });
  await audit({ actorId, action: "invoice.credit_note", entity: "Invoice", entityId: cn.id, summary: `${cn.number} ${rs(amount)} on ${invoiceId}`, reason });
  return cn;
}

export type Ageing = { current: number; d30: number; d60: number; d90: number; over90: number; total: number };

/** Outstanding by days past due (0–30 includes not yet due). */
export async function ageing(companyId?: string): Promise<{ buckets: Ageing; rows: { id: string; number: string; company: string; due: string | null; days: number; outstanding: number }[] }> {
  const invs = await db.invoice.findMany({
    where: { kind: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_PAID"] }, ...(companyId ? { companyId } : {}) },
    include: { company: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
  });
  const today = todayKTM();
  const buckets: Ageing = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 };
  const rows = invs.map((i) => {
    const due = i.dueDate ? isoDate(i.dueDate) : null;
    const days = due ? Math.max(0, daysBetween(due, today)) : 0;
    const amt = i.total - i.paidAmount;
    if (!due || today <= due) buckets.current += amt;
    else if (days <= 30) buckets.d30 += amt;
    else if (days <= 60) buckets.d60 += amt;
    else if (days <= 90) buckets.d90 += amt;
    else buckets.over90 += amt;
    buckets.total += amt;
    return { id: i.id, number: i.number, company: i.company?.name ?? i.billingName, due, days, outstanding: amt };
  });
  return { buckets, rows };
}

/** Companies with billable employer share that isn't on an invoice yet. */
export async function uninvoicedByCompany() {
  const rows = await db.order.groupBy({
    by: ["companyId"],
    where: { companyId: { not: null }, invoiceId: null, companyShare: { gt: 0 }, status: { in: REVENUE_STATUSES }, deliveryDate: { lte: dateOnly(todayKTM()) } },
    _sum: { companyShare: true },
    _count: true,
    _min: { deliveryDate: true },
    _max: { deliveryDate: true },
  });
  const companies = await db.company.findMany({ where: { id: { in: rows.map((r) => r.companyId!) } }, select: { id: true, name: true } });
  return rows.map((r) => ({
    companyId: r.companyId!,
    name: companies.find((c) => c.id === r.companyId)?.name ?? "—",
    amount: r._sum.companyShare ?? 0,
    orders: r._count,
    from: r._min.deliveryDate ? isoDate(r._min.deliveryDate) : null,
    to: r._max.deliveryDate ? isoDate(r._max.deliveryDate) : null,
  }));
}
