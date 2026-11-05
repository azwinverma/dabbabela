import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatDay, isoDate } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, Pagination } from "@/components/admin/ui";
import { RangeForm, readRange } from "@/components/admin/finance/kit";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { kitchensFor, scopeIds } from "@/components/admin/ops/scope";
import { EXPENSE_STATUSES, expenseTotals, expenseWhere, isReversal, reversalsFor } from "@/server/finance/expenses";
import { ExpenseFields, FinBadge, label } from "./_shared";
import { approveExpenseAction, createExpenseAction, voidExpenseAction } from "./actions";

export const metadata = { title: "Expenses" };
const PER = 50;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("expenses.view");
  const sp = await searchParams;
  const { from, to } = readRange(sp, 31);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const filter = { from, to, status: sp.status, categoryId: sp.category || undefined, kitchenIds: scopeIds(user), q: sp.q?.trim().slice(0, 60) || undefined };
  const where = expenseWhere(filter);
  const [rows, total, categories, kitchens, suppliers, totals, waiting] = await Promise.all([
    db.expense.findMany({ where, include: { category: { select: { name: true } }, kitchen: { select: { name: true } } }, orderBy: [{ date: "desc" }, { number: "desc" }], skip: (page - 1) * PER, take: PER }),
    db.expense.count({ where }),
    db.expenseCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, key: true } }),
    kitchensFor(user),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    expenseTotals(filter),
    db.expense.count({ where: { AND: [expenseWhere({ kitchenIds: scopeIds(user) }), { status: "DRAFT" }] } }),
  ]);
  const reversed = await reversalsFor(rows.map((r) => r.number));
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const canCreate = can(user, "expenses.create");
  const canApprove = can(user, "expenses.approve");
  const recorded = totals.reduce((a, t) => a + t.amount + t.tax, 0);

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Every business expense with its receipt. Drafts are approved by someone other than who entered them; approved entries are never edited — corrections are reversing entries."
        actions={
          can(user, "expenses.export") ? (
            <Link className="text-sm font-semibold text-sindoor underline" href={`/admin/settlements?tab=journal&from=${from}&to=${to}`}>
              Journal export
            </Link>
          ) : null
        }
      />
      {canCreate && (
        <details className="mb-5 rounded-xl border border-ink-line/80 bg-white p-4 shadow-card" open={sp.new === "1"}>
          <summary className="cursor-pointer font-display text-sm font-bold">+ Record an expense</summary>
          <ActionForm action={createExpenseAction} resetOnSuccess className="mt-4 space-y-3">
            <ExpenseFields categories={categories} kitchens={kitchens} suppliers={suppliers} kitchenRequired={Boolean(scopeIds(user))} />
            <SubmitButton variant="dark">Save draft</SubmitButton>
          </ActionForm>
        </details>
      )}
      <RangeForm from={from} to={to}>
        <label className={label}>
          Status
          <select name="status" defaultValue={sp.status ?? ""} className="field mt-1 w-36">
            <option value="">Any</option>
            {EXPENSE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Category
          <select name="category" defaultValue={sp.category ?? ""} className="field mt-1 w-44">
            <option value="">Any</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Search
          <input name="q" defaultValue={sp.q} placeholder="No., description, bill" className="field mt-1 w-48" />
        </label>
      </RangeForm>
      <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Panel title="Recorded in this range (approved + paid, incl. tax)">
          <p className="font-display text-2xl font-bold tabular-nums">{rs(recorded)}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {totals
              .sort((a, b) => b.amount - a.amount)
              .map((t) => (
                <li key={t.categoryId} className="flex justify-between">
                  <span>
                    {catName.get(t.categoryId) ?? "—"} <span className="text-ink-mute">({t.count})</span>
                  </span>
                  <span className="tabular-nums">{rs(t.amount + t.tax)}</span>
                </li>
              ))}
          </ul>
          {waiting > 0 && (
            <p className="mt-3 text-sm">
              <Link href="/admin/expenses?status=DRAFT&from=2000-01-01" className="font-semibold text-besar-dark underline">
                {waiting} draft(s) waiting for approval
              </Link>
            </p>
          )}
        </Panel>
        <Panel title="How it works">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>Enter a draft with its receipt. Another finance person approves it (owner can self-approve).</li>
            <li>Mark approved expenses paid when money leaves. Drafts can be voided; nothing is deleted.</li>
            <li>A wrong approved expense: open it and use <b>Reverse</b> or <b>Correct</b> — a negative entry cancels it in an open month.</li>
            <li>Closed months (see Profitability) refuse anything dated inside them.</li>
          </ul>
        </Panel>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>No.</Th>
            <Th>Date</Th>
            <Th>Category</Th>
            <Th>Kitchen</Th>
            <Th>Description</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">Tax</Th>
            <Th>Status</Th>
            <Th>Receipt</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((e) => (
              <tr key={e.id} className="hover:bg-paper/40">
                <Td>
                  <Link href={`/admin/expenses/${e.id}`} className="font-mono text-xs font-semibold text-sindoor hover:underline">
                    {e.number}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">{formatDay(isoDate(e.date))}</Td>
                <Td>{e.category.name}</Td>
                <Td>{e.kitchen?.name ?? <span className="text-ink-mute">Company</span>}</Td>
                <Td className="max-w-xs truncate" title={e.description}>
                  {e.description}
                </Td>
                <Td className={`text-right tabular-nums ${e.amount < 0 ? "text-sindoor" : ""}`}>{rs(e.amount)}</Td>
                <Td className="text-right tabular-nums text-ink-mute">{e.tax ? rs(e.tax) : "—"}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    <FinBadge status={e.status} />
                    {isReversal(e) && <FinBadge status="VOID">Reversal</FinBadge>}
                    {reversed.has(e.number) && <FinBadge status="VOID">Reversed</FinBadge>}
                  </span>
                </Td>
                <Td>
                  {e.attachmentUrl ? (
                    <a href={e.attachmentUrl} target="_blank" rel="noreferrer" className="text-sindoor underline">
                      View
                    </a>
                  ) : (
                    <span className="text-ink-mute">—</span>
                  )}
                </Td>
                <Td>
                  {e.status === "DRAFT" && (
                    <span className="flex flex-wrap gap-1">
                      {canApprove && e.createdById !== user.id ? (
                        <ActionForm action={approveExpenseAction} showMessage>
                          <input type="hidden" name="id" value={e.id} />
                          <SubmitButton size="sm" variant="dark" pendingText="…">
                            Approve
                          </SubmitButton>
                        </ActionForm>
                      ) : canApprove && ["OWNER", "SUPER_ADMIN"].includes(user.role) ? (
                        <ActionForm action={approveExpenseAction}>
                          <input type="hidden" name="id" value={e.id} />
                          <SubmitButton size="sm" variant="dark" pendingText="…" confirm="Approve an expense you entered yourself?">
                            Approve
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                      {canCreate && (
                        <ActionForm action={voidExpenseAction}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="reason" value="Voided from the ledger" />
                          <SubmitButton size="sm" variant="outline" pendingText="…" confirm={`Void ${e.number}? It stays on record as void.`}>
                            Void
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </span>
                  )}
                  {e.status === "APPROVED" && (
                    <Link href={`/admin/expenses/${e.id}`} className="text-xs font-semibold text-sindoor underline">
                      Pay / reverse
                    </Link>
                  )}
                </Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={10}>No expenses match. Record one above.</EmptyRow>
          )}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / PER)} params={sp} basePath="/admin/expenses" />
    </div>
  );
}
