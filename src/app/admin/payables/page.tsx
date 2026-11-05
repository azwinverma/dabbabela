import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatDay, isoDate, isValidISODate, todayKTM } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, Tabs, Pagination } from "@/components/admin/ui";
import { Kpi } from "@/components/admin/finance/kit";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { AGEING_BUCKETS, INVOICE_STATUSES, payablesAgeing } from "@/server/finance/payables";
import { FinBadge, field, label } from "../expenses/_shared";
import { createSupplierInvoiceAction } from "./actions";

export const metadata = { title: "Supplier payables" };
const PER = 50;

export default async function PayablesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("purchasing.view");
  const sp = await searchParams;
  const tab = sp.tab === "ageing" ? "ageing" : "invoices";
  return (
    <div>
      <PageHeader title="Supplier payables" description="Supplier invoices, what has been paid against them and how old the balance is. Payments are never edited — a wrong one is reversed." />
      <Tabs
        current={tab}
        tabs={[
          { key: "invoices", label: "Invoices", href: "/admin/payables" },
          { key: "ageing", label: "Ageing", href: "/admin/payables?tab=ageing" },
        ]}
      />
      {tab === "ageing" ? <Ageing asOf={sp.asOf && isValidISODate(sp.asOf) ? sp.asOf : todayKTM()} /> : <Invoices sp={sp} canCreate={can(user, "purchasing.create")} />}
    </div>
  );
}

async function Invoices({ sp, canCreate }: { sp: Record<string, string | undefined>; canCreate: boolean }) {
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.SupplierInvoiceWhereInput = {
    ...(sp.status && (INVOICE_STATUSES as readonly string[]).includes(sp.status) ? { status: sp.status } : { status: { not: "VOID" } }),
    ...(sp.supplier ? { supplierId: sp.supplier } : {}),
    ...(sp.q ? { number: { contains: sp.q.slice(0, 60), mode: "insensitive" } } : {}),
  };
  const [rows, total, suppliers, pos] = await Promise.all([
    db.supplierInvoice.findMany({ where, include: { supplier: { select: { name: true } }, po: { select: { number: true } } }, orderBy: [{ date: "desc" }], skip: (page - 1) * PER, take: PER }),
    db.supplierInvoice.count({ where }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    canCreate ? db.purchaseOrder.findMany({ where: { status: { in: ["SENT", "PARTIAL", "RECEIVED"] } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, number: true, supplier: { select: { name: true } } } }) : [],
  ]);
  const today = todayKTM();
  return (
    <>
      {canCreate && (
        <details className="mb-5 rounded-xl border border-ink-line/80 bg-white p-4 shadow-card">
          <summary className="cursor-pointer font-display text-sm font-bold">+ Record a supplier invoice</summary>
          <ActionForm action={createSupplierInvoiceAction} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={label}>
              Supplier
              <select name="supplierId" required className={field} defaultValue="">
                <option value="">Pick…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Purchase order (for the 3-way match)
              <select name="poId" className={field} defaultValue="">
                <option value="">None</option>
                {pos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number} · {p.supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Supplier&apos;s invoice no.
              <input name="number" required maxLength={60} className={field} />
            </label>
            <label className={label}>
              Invoice date
              <input type="date" name="date" required defaultValue={today} max={today} className={field} />
            </label>
            <label className={label}>
              Due date
              <input type="date" name="dueDate" className={field} />
            </label>
            <label className={label}>
              Amount before tax (Rs)
              <input name="subtotal" required inputMode="decimal" className={field} />
            </label>
            <label className={label}>
              VAT (Rs)
              <input name="tax" inputMode="decimal" className={field} placeholder="0" />
            </label>
            <label className={label}>
              Invoice scan (image / PDF)
              <input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,image/avif,application/pdf" className="mt-1 block w-full text-sm" />
            </label>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton variant="dark">Save invoice</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <select name="supplier" defaultValue={sp.supplier ?? ""} className="field w-48" aria-label="Supplier">
          <option value="">Any supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className="field w-40" aria-label="Status">
          <option value="">Open, partial, paid</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={sp.q} placeholder="Invoice no." className="field w-40" />
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Filter</button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Invoice</Th>
            <Th>Supplier</Th>
            <Th>PO</Th>
            <Th>Date</Th>
            <Th>Due</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">Paid</Th>
            <Th className="text-right">Outstanding</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((i) => {
              const due = i.dueDate ? isoDate(i.dueDate) : null;
              const late = due && due < today && i.status !== "PAID" && i.status !== "VOID";
              return (
                <tr key={i.id} className="hover:bg-paper/40">
                  <Td>
                    <Link href={`/admin/payables/${i.id}`} className="font-semibold text-sindoor hover:underline">
                      {i.number}
                    </Link>
                  </Td>
                  <Td>{i.supplier.name}</Td>
                  <Td className="font-mono text-xs">{i.po?.number ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{formatDay(isoDate(i.date))}</Td>
                  <Td className={`whitespace-nowrap ${late ? "font-semibold text-sindoor" : ""}`}>{due ? formatDay(due) : "—"}</Td>
                  <Td className="text-right tabular-nums">{rs(i.total)}</Td>
                  <Td className="text-right tabular-nums text-ink-mute">{rs(i.paidAmount)}</Td>
                  <Td className="text-right font-semibold tabular-nums">{i.status === "VOID" ? "—" : rs(i.total - i.paidAmount)}</Td>
                  <Td>
                    <FinBadge status={i.status} />
                  </Td>
                </tr>
              );
            })
          ) : (
            <EmptyRow colSpan={9}>No supplier invoices yet.</EmptyRow>
          )}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / PER)} params={sp} basePath="/admin/payables" />
    </>
  );
}

async function Ageing({ asOf }: { asOf: string }) {
  const a = await payablesAgeing(asOf);
  return (
    <>
      <form className="mb-4 flex items-end gap-2">
        <input type="hidden" name="tab" value="ageing" />
        <label className={label}>
          As of
          <input type="date" name="asOf" defaultValue={asOf} className="field mt-1 w-40" />
        </label>
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Apply</button>
      </form>
      <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Total owed" value={rs(a.total)} formula="Σ (invoice total − paid) over open and partly paid supplier invoices dated on or before the date." />
        {AGEING_BUCKETS.map((b) => (
          <Kpi key={b.key} label={b.label} value={rs(a.totals[b.key])} tone={b.key === "d90plus" && a.totals[b.key] ? "bad" : b.key !== "current" && a.totals[b.key] ? "warn" : "default"} formula="Age = days past the due date (or the invoice date when no due date was given)." />
        ))}
      </div>
      <Panel title="By supplier" bodyClass="p-0">
        <Table className="rounded-none border-0 shadow-none">
          <thead>
            <tr>
              <Th>Supplier</Th>
              {AGEING_BUCKETS.map((b) => (
                <Th key={b.key} className="text-right">
                  {b.label}
                </Th>
              ))}
              <Th className="text-right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {a.suppliers.length ? (
              a.suppliers.map((s) => (
                <tr key={s.supplierId}>
                  <Td>
                    <Link className="text-sindoor hover:underline" href={`/admin/payables?supplier=${s.supplierId}`}>
                      {s.name}
                    </Link>
                  </Td>
                  {AGEING_BUCKETS.map((b) => (
                    <Td key={b.key} className="text-right tabular-nums">
                      {s.buckets[b.key] ? rs(s.buckets[b.key]) : "—"}
                    </Td>
                  ))}
                  <Td className="text-right font-semibold tabular-nums">{rs(s.total)}</Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={AGEING_BUCKETS.length + 2}>Nothing owed to suppliers.</EmptyRow>
            )}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
