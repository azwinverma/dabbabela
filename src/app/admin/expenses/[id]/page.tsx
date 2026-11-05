import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatDay, formatStamp, isoDate, todayKTM } from "@/lib/dates";
import { PageHeader, Panel, KV, Callout } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { inScope, kitchensFor, scopeIds } from "@/components/admin/ops/scope";
import { EXPENSE_METHODS, isReversal } from "@/server/finance/expenses";
import { isPeriodClosed } from "@/server/finance/common";
import { ExpenseFields, FinBadge, field, label } from "../_shared";
import { approveExpenseAction, attachReceiptAction, correctExpenseAction, payExpenseAction, reverseExpenseAction, updateExpenseAction, voidExpenseAction } from "../actions";

export const metadata = { title: "Expense" };

export default async function ExpenseDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("expenses.view");
  const { id } = await params;
  const e = await db.expense.findUnique({ where: { id }, include: { category: true, kitchen: { select: { name: true } }, supplier: { select: { name: true } } } });
  if (!e || (e.kitchenId && !inScope(user, e.kitchenId))) notFound();
  const [categories, kitchens, suppliers, history, reversal, original, closed] = await Promise.all([
    db.expenseCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    kitchensFor(user),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.auditLog.findMany({ where: { entity: "Expense", entityId: id }, orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true } } } }),
    db.expense.findFirst({ where: { reference: `REV:${e.number}` }, select: { id: true, number: true } }),
    isReversal(e) ? db.expense.findUnique({ where: { number: e.reference!.slice(4) }, select: { id: true, number: true } }) : null,
    isPeriodClosed(isoDate(e.date)),
  ]);
  const names = new Map((await db.user.findMany({ where: { id: { in: [e.createdById, e.approvedById].filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const canCreate = can(user, "expenses.create");
  const canApprove = can(user, "expenses.approve");
  const selfOk = e.createdById !== user.id || ["OWNER", "SUPER_ADMIN"].includes(user.role);
  const d = { date: isoDate(e.date), categoryId: e.categoryId, kitchenId: e.kitchenId, supplierId: e.supplierId, description: e.description, amount: Math.abs(e.amount), tax: Math.abs(e.tax), method: e.method, reference: isReversal(e) ? null : e.reference };

  return (
    <div>
      <PageHeader title={`Expense ${e.number}`} back={{ href: "/admin/expenses", label: "Expenses" }} actions={<FinBadge status={e.status} />} />
      {closed && <Callout tone="info" title={`${isoDate(e.date).slice(0, 7)} is closed`} className="mb-4">Nothing dated in a closed month can change. Corrections are posted as reversing entries in an open month.</Callout>}
      {reversal && (
        <Callout tone="warn" className="mb-4">
          Reversed by{" "}
          <Link className="font-semibold underline" href={`/admin/expenses/${reversal.id}`}>
            {reversal.number}
          </Link>
          .
        </Callout>
      )}
      {original && (
        <Callout tone="info" className="mb-4">
          This is a reversing entry for{" "}
          <Link className="font-semibold underline" href={`/admin/expenses/${original.id}`}>
            {original.number}
          </Link>
          .
        </Callout>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Details">
          <KV
            items={[
              ["Date", formatDay(isoDate(e.date), "long")],
              ["Category", `${e.category.name} (${e.category.kind})`],
              ["Kitchen", e.kitchen?.name ?? "Company-wide"],
              ["Supplier", e.supplier?.name ?? "—"],
              ["Description", e.description],
              ["Amount", rs(e.amount)],
              ["Tax", rs(e.tax)],
              ["Total", rs(e.amount + e.tax)],
              ["Method", e.method ?? "—"],
              ["Reference", e.reference ?? "—"],
              ["Entered by", e.createdById ? (names.get(e.createdById) ?? "Staff") : "—"],
              ["Approved by", e.approvedById ? (names.get(e.approvedById) ?? "Staff") : "—"],
            ]}
          />
          {e.attachmentUrl && (
            <a href={e.attachmentUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-sindoor underline">
              View receipt
            </a>
          )}
          {canCreate && e.status !== "VOID" && (
            <ActionForm action={attachReceiptAction} className="mt-4 space-y-2 border-t border-ink-line/60 pt-3">
              <input type="hidden" name="id" value={e.id} />
              <label className={label}>
                {e.attachmentUrl ? "Replace receipt" : "Attach receipt"}
                <input type="file" name="receipt" required accept="image/jpeg,image/png,image/webp,image/avif,application/pdf" className="mt-1 block w-full text-sm" />
              </label>
              <SubmitButton size="sm" variant="outline">
                Upload
              </SubmitButton>
            </ActionForm>
          )}
        </Panel>
        <div className="space-y-4 lg:col-span-2">
          {e.status === "DRAFT" && !closed && (
            <Panel title="Draft">
              <div className="mb-4 flex flex-wrap gap-2">
                {canApprove && selfOk && (
                  <ActionForm action={approveExpenseAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <SubmitButton variant="dark">Approve</SubmitButton>
                  </ActionForm>
                )}
                {canApprove && !selfOk && <p className="text-sm text-ink-mute">You entered this expense, so someone else approves it.</p>}
              </div>
              {canCreate && (
                <>
                  <ActionForm action={updateExpenseAction} className="space-y-3">
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="attachmentUrl" value={e.attachmentUrl ?? ""} />
                    <ExpenseFields categories={categories} kitchens={kitchens} suppliers={suppliers} d={d} kitchenRequired={Boolean(scopeIds(user))} />
                    <SubmitButton variant="outline">Save changes</SubmitButton>
                  </ActionForm>
                  <ActionForm action={voidExpenseAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-ink-line/60 pt-3">
                    <input type="hidden" name="id" value={e.id} />
                    <label className={label}>
                      Reason to void
                      <input name="reason" required className="field mt-1 w-72" />
                    </label>
                    <SubmitButton variant="danger" size="sm">
                      Void
                    </SubmitButton>
                  </ActionForm>
                </>
              )}
            </Panel>
          )}
          {e.status === "APPROVED" && canApprove && (
            <Panel title="Mark paid">
              <ActionForm action={payExpenseAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={e.id} />
                <label className={label}>
                  Paid by
                  <select name="method" required defaultValue={e.method ?? ""} className="field mt-1 w-36">
                    <option value="">Pick…</option>
                    {EXPENSE_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.charAt(0) + m.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={label}>
                  Payment reference
                  <input name="reference" defaultValue={e.reference ?? ""} className="field mt-1 w-48" />
                </label>
                <SubmitButton variant="dark">Mark paid</SubmitButton>
              </ActionForm>
            </Panel>
          )}
          {["APPROVED", "PAID"].includes(e.status) && !isReversal(e) && !reversal && canApprove && (
            <>
              <Panel title="Reverse (cancel) this expense">
                <p className="mb-3 text-sm text-ink-mute">Posts a negative entry of {rs(-(e.amount + e.tax))} in an open month. This expense itself is never changed.</p>
                <ActionForm action={reverseExpenseAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={e.id} />
                  <label className={label}>
                    Reason
                    <input name="reason" required className="field mt-1 w-72" />
                  </label>
                  <label className={label}>
                    Reversal date
                    <input type="date" name="date" defaultValue={closed ? todayKTM() : isoDate(e.date)} max={todayKTM()} className="field mt-1 w-40" />
                  </label>
                  <SubmitButton variant="danger" confirm="Post a reversing entry?">
                    Reverse
                  </SubmitButton>
                </ActionForm>
              </Panel>
              {canCreate && (
                <Panel title="Correct (reverse + re-enter)">
                  <ActionForm action={correctExpenseAction} className="space-y-3">
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="attachmentUrl" value={e.attachmentUrl ?? ""} />
                    <ExpenseFields categories={categories} kitchens={kitchens} suppliers={suppliers} d={{ ...d, date: closed ? todayKTM() : d.date }} kitchenRequired={Boolean(scopeIds(user))} />
                    <label className={label}>
                      What was wrong
                      <input name="reason" required className={field} />
                    </label>
                    <SubmitButton variant="dark">Reverse and create corrected draft</SubmitButton>
                  </ActionForm>
                </Panel>
              )}
            </>
          )}
          <Panel title="History">
            <ul className="divide-y divide-ink-line/50 text-sm">
              {history.map((h) => (
                <li key={h.id} className="py-2">
                  <span className="font-semibold">{h.action.replace("expense.", "")}</span> · {h.actor?.name ?? "System"} · <span className="text-ink-mute">{formatStamp(h.createdAt)}</span>
                  {h.summary && <span className="block text-ink-soft">{h.summary}</span>}
                  {h.reason && <span className="block text-ink-mute">Reason: {h.reason}</span>}
                </li>
              ))}
              {!history.length && <li className="py-2 text-ink-mute">No history.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
