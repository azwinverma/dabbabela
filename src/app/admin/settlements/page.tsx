import Link from "next/link";
import { requirePermission, type CurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { rs, rupeesInput } from "@/lib/money";
import { addDays, formatDay, formatStamp, isValidISODate, todayKTM } from "@/lib/dates";
import { METHOD_LABEL } from "@/lib/labels";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, Tabs, Callout } from "@/components/admin/ui";
import { Kpi, RangeForm, readRange } from "@/components/admin/finance/kit";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { scopeIds } from "@/components/admin/ops/scope";
import { cashFlow, settlementSheet } from "@/server/finance/settlement";
import { statementBatches, statementDuplicates, unmatchedLines } from "@/server/finance/statements";
import { buildJournal, journalAccountKeys } from "@/server/finance/journal";
import { GATEWAY_METHODS, getFinanceConfig } from "@/server/finance/common";
import { FinBadge, label } from "../expenses/_shared";
import { closeSettlementAction, matchLineAction, saveFinanceSettingsAction, saveSettlementAction } from "./actions";
import { ImportForm } from "./ImportForm";

export const metadata = { title: "Daily settlement" };
type SP = Record<string, string | undefined>;

const TABS = [
  { key: "daily", label: "Daily settlement" },
  { key: "statements", label: "Gateway statements" },
  { key: "cashflow", label: "Cash flow" },
  { key: "journal", label: "Journal export" },
  { key: "settings", label: "Fees & accounts" },
] as const;

export default async function SettlementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("settlements.view");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "daily";
  return (
    <div>
      <PageHeader title="Daily settlement & reconciliation" description="Cash from riders, gateway statements and bank receipts checked against what the system expected — then closed and locked." />
      <Tabs current={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/admin/settlements?tab=${t.key}` }))} />
      {tab === "daily" && <Daily user={user} date={sp.date && isValidISODate(sp.date) && sp.date <= todayKTM() ? sp.date : addDays(todayKTM(), -1)} />}
      {tab === "statements" && <Statements canEdit={can(user, "settlements.edit")} />}
      {tab === "cashflow" && (can(user, "expenses.view") || can(user, "analytics.view") ? <CashFlow sp={sp} /> : <Callout tone="info">Cash flow needs the expenses or analytics view permission.</Callout>)}
      {tab === "journal" && (can(user, "expenses.view") ? <Journal sp={sp} canExport={can(user, "expenses.export")} /> : <Callout tone="info">The journal needs the expenses view permission.</Callout>)}
      {tab === "settings" && <Settings canEdit={can(user, "settlements.approve")} />}
    </div>
  );
}

async function Daily({ user, date }: { user: CurrentUser; date: string }) {
  const rows = await settlementSheet(date, scopeIds(user));
  const canEdit = can(user, "settlements.edit");
  const canClose = can(user, "settlements.approve");
  return (
    <>
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="daily" />
        <label className={label}>
          Day
          <input type="date" name="date" defaultValue={date} max={todayKTM()} className="field mt-1 w-40" />
        </label>
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Show</button>
        <Link href={`/admin/settlements?tab=daily&date=${addDays(date, -1)}`} className="text-sm text-sindoor underline">
          ← Previous day
        </Link>
      </form>
      <p className="mb-3 text-sm text-ink-mute">
        Expected is always recomputed from the records: cash = what riders collected on {formatDay(date, "long")}; eSewa / Khalti = payments marked paid that day; bank = transfers verified that day. Counted = cash handed in, the gateway
        statement, or the bank statement. A variance must be explained before closing; closed rows are locked.
      </p>
      <Table>
        <thead>
          <tr>
            <Th>Kitchen</Th>
            <Th>Method</Th>
            <Th className="text-right">Expected</Th>
            <Th>Counted</Th>
            <Th className="text-right">Variance</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const counted = r.saved?.counted ?? r.suggested;
            const variance = r.saved ? r.saved.counted - r.expected : null;
            return (
              <tr key={`${r.kitchenId}-${r.method}`} className="align-top">
                <Td>{r.kitchen}</Td>
                <Td>
                  {METHOD_LABEL[r.method]}
                  <span className="block text-xs text-ink-mute">{r.detail}</span>
                </Td>
                <Td className="text-right tabular-nums">{rs(r.expected)}</Td>
                <Td>
                  {r.closed ? (
                    <span className="tabular-nums">{rs(r.saved!.counted)}</span>
                  ) : canEdit ? (
                    <ActionForm action={saveSettlementAction} className="flex flex-wrap items-start gap-1">
                      <input type="hidden" name="date" value={date} />
                      <input type="hidden" name="method" value={r.method} />
                      <input type="hidden" name="kitchenId" value={r.kitchenId ?? ""} />
                      <input name="counted" required inputMode="decimal" defaultValue={counted == null ? "" : rupeesInput(counted)} aria-label="Counted (Rs)" className="field h-8 w-28 py-1" />
                      <input name="note" defaultValue={r.saved?.note ?? ""} placeholder="Note" aria-label="Note" className="field h-8 w-40 py-1" />
                      <SubmitButton size="sm" variant="outline" pendingText="…">
                        Save
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <span className="text-ink-mute">{counted == null ? "—" : rs(counted)}</span>
                  )}
                </Td>
                <Td className={`text-right tabular-nums ${variance ? "font-semibold text-sindoor" : "text-ink-mute"}`}>{variance == null ? "—" : rs(variance)}</Td>
                <Td>
                  {r.closed ? (
                    <span title={r.saved?.note ?? undefined}>
                      <FinBadge status="PAID">Closed</FinBadge>
                      <span className="block text-xs text-ink-mute">{formatStamp(r.saved!.closedAt!)}</span>
                    </span>
                  ) : r.saved && canClose ? (
                    <ActionForm action={closeSettlementAction} className="flex flex-wrap gap-1">
                      <input type="hidden" name="id" value={r.saved.id} />
                      {variance ? <input name="note" defaultValue={r.saved.note ?? ""} required placeholder="Explain variance" aria-label="Variance explanation" className="field h-8 w-40 py-1" /> : null}
                      <SubmitButton size="sm" variant="dark" pendingText="…" confirm="Close and lock this settlement?">
                        Close
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <FinBadge status={r.saved ? "DRAFT" : "VOID"}>{r.saved ? "Open" : "Not counted"}</FinBadge>
                  )}
                </Td>
              </tr>
            );
          })}
          {!rows.length && <EmptyRow colSpan={6}>No kitchens in your scope.</EmptyRow>}
        </tbody>
      </Table>
    </>
  );
}

async function Statements({ canEdit }: { canEdit: boolean }) {
  const [batches, unmatched, dups] = await Promise.all([statementBatches(), unmatchedLines(), statementDuplicates()]);
  return (
    <div className="space-y-4">
      {canEdit && (
        <Panel title="Import a statement">
          <p className="mb-3 text-sm text-ink-mute">
            Download the settlement report (CSV) from the eSewa / Khalti merchant portal or your bank. Columns are matched by name: a reference (transaction UUID, pidx, purchase order id or our payment reference), amount, fee and date.
            Importing the same file twice adds nothing.
          </p>
          <ImportForm />
        </Panel>
      )}
      {dups.length > 0 && (
        <Callout tone="bad" title={`Possible duplicate payments (${dups.length})`}>
          <ul className="list-disc pl-5">
            {dups.map((d) => (
              <li key={d.payment.id}>
                <Link className="underline" href={`/admin/payments/${d.payment.id}`}>
                  {d.payment.reference}
                </Link>{" "}
                ({rs(d.payment.amount)}) settled {d.lines}× for {rs(d.settled)} — refund the extra charge.
              </li>
            ))}
          </ul>
        </Callout>
      )}
      <Panel title={`Unmatched statement lines (${unmatched.length})`} bodyClass="p-0">
        <Table className="rounded-none border-0 shadow-none">
          <thead>
            <tr>
              <Th>Provider</Th>
              <Th>Reference</Th>
              <Th>Settled</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Fee</Th>
              <Th>Match to payment</Th>
            </tr>
          </thead>
          <tbody>
            {unmatched.length ? (
              unmatched.map((l) => (
                <tr key={l.id}>
                  <Td>{l.provider}</Td>
                  <Td className="font-mono text-xs">{l.providerRef}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatStamp(l.settledAt)}</Td>
                  <Td className="text-right tabular-nums">{rs(l.amount)}</Td>
                  <Td className="text-right tabular-nums">{rs(l.fee)}</Td>
                  <Td>
                    {canEdit ? (
                      <ActionForm action={matchLineAction} className="flex items-center gap-1">
                        <input type="hidden" name="lineId" value={l.id} />
                        <input name="reference" required placeholder="Payment reference" aria-label="Payment reference" className="field h-8 w-40 py-1 text-xs" />
                        <SubmitButton size="sm" variant="outline" pendingText="…">
                          Match
                        </SubmitButton>
                      </ActionForm>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={6}>Every imported line matched a payment.</EmptyRow>
            )}
          </tbody>
        </Table>
      </Panel>
      <Panel title="Recent imports" bodyClass="p-0">
        <Table className="rounded-none border-0 shadow-none">
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th>Provider</Th>
              <Th>Imported</Th>
              <Th className="text-right">Lines</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Fees</Th>
              <Th className="text-right">Unmatched</Th>
            </tr>
          </thead>
          <tbody>
            {batches.length ? (
              batches.map((b) => (
                <tr key={b.batch}>
                  <Td className="font-mono text-xs">{b.batch}</Td>
                  <Td>{b.provider}</Td>
                  <Td className="whitespace-nowrap text-xs">{b.importedAt ? formatStamp(b.importedAt) : "—"}</Td>
                  <Td className="text-right tabular-nums">{b.lines}</Td>
                  <Td className="text-right tabular-nums">{rs(b.amount)}</Td>
                  <Td className="text-right tabular-nums">{rs(b.fee)}</Td>
                  <Td className={`text-right tabular-nums ${b.unmatched ? "font-semibold text-sindoor" : ""}`}>{b.unmatched}</Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={7}>No statements imported yet. Gateway fee actuals and reconciliation appear once you import one.</EmptyRow>
            )}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}

async function CashFlow({ sp }: { sp: SP }) {
  const { from, to } = readRange(sp, 30);
  const cf = await cashFlow(from, to);
  return (
    <>
      <RangeForm from={from} to={to}>
        <input type="hidden" name="tab" value="cashflow" />
      </RangeForm>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Cash in" value={rs(cf.totals.inflow)} formula="eSewa, Khalti, bank-transfer and cash payments marked paid in the range (wallet and company invoice excluded)." />
        <Kpi label="Cash out" value={rs(cf.totals.outflow)} formula="Refunds paid out (not wallet credit) + expenses marked paid (by expense date, incl. VAT) + supplier payments + gateway fees (statement actual, else estimate)." />
        <Kpi label="Net cash flow" value={rs(cf.totals.net)} tone={cf.totals.net < 0 ? "bad" : "good"} formula="Cash in − cash out." />
        <Kpi label="Gateway fees" value={rs(cf.totals.fees)} formula="Payment.feeActual when a statement was imported, otherwise the estimated gatewayFee." />
      </div>
      <p className="mb-3 text-xs text-ink-mute">Company invoice receipts aren&apos;t dated per payment yet, so they aren&apos;t included.</p>
      <Table>
        <thead>
          <tr>
            <Th>Day</Th>
            <Th className="text-right">In</Th>
            <Th className="text-right">Refunds</Th>
            <Th className="text-right">Expenses</Th>
            <Th className="text-right">Suppliers</Th>
            <Th className="text-right">Fees</Th>
            <Th className="text-right">Net</Th>
          </tr>
        </thead>
        <tbody>
          {[...cf.rows].reverse().map((r) => (
            <tr key={r.date}>
              <Td className="whitespace-nowrap">{formatDay(r.date)}</Td>
              <Td className="text-right tabular-nums">{r.inflow ? rs(r.inflow) : "—"}</Td>
              <Td className="text-right tabular-nums">{r.refunds ? rs(r.refunds) : "—"}</Td>
              <Td className="text-right tabular-nums">{r.expenses ? rs(r.expenses) : "—"}</Td>
              <Td className="text-right tabular-nums">{r.suppliers ? rs(r.suppliers) : "—"}</Td>
              <Td className="text-right tabular-nums">{r.fees ? rs(r.fees) : "—"}</Td>
              <Td className={`text-right font-semibold tabular-nums ${r.net < 0 ? "text-sindoor" : ""}`}>{rs(r.net)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

async function Journal({ sp, canExport }: { sp: SP; canExport: boolean }) {
  const { from, to } = readRange(sp, 31);
  const [j, cfg] = await Promise.all([buildJournal(from, to), getFinanceConfig()]);
  const unmapped = [...new Set(j.lines.map((l) => l.key).filter((k) => !cfg.chartOfAccounts[k]))];
  return (
    <>
      <RangeForm from={from} to={to}>
        <input type="hidden" name="tab" value="journal" />
      </RangeForm>
      <Callout tone="warn" title="Chart of accounts not final" className="mb-4">
        The accountant&apos;s chart of accounts is still pending, so each line carries our internal account key. Map keys to account codes on the <Link className="underline" href="/admin/settlements?tab=settings">Fees &amp; accounts</Link> tab; unmapped keys export as
        &quot;UNMAPPED key&quot;. {unmapped.length ? `${unmapped.length} key(s) in this range are unmapped.` : "Every key in this range is mapped."}
      </Callout>
      <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
        <span>
          {j.lines.length} lines · debits {rs(j.debit)} · credits {rs(j.credit)} · {j.balanced ? <b className="text-saag">balanced</b> : <b className="text-sindoor">NOT balanced</b>}
        </span>
        {canExport ? (
          <a className="font-semibold text-sindoor underline" href={`/admin/settlements/journal?from=${from}&to=${to}`}>
            Download journal CSV
          </a>
        ) : (
          <span className="text-ink-mute">Export needs the expenses export permission.</span>
        )}
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Journal</Th>
            <Th>Entry</Th>
            <Th>Account</Th>
            <Th className="text-right">Debit</Th>
            <Th className="text-right">Credit</Th>
            <Th>Memo</Th>
          </tr>
        </thead>
        <tbody>
          {j.lines.slice(0, 300).map((l, i) => (
            <tr key={i}>
              <Td className="whitespace-nowrap text-xs">{l.date}</Td>
              <Td className="text-xs">{l.journal}</Td>
              <Td className="font-mono text-xs">{l.entry}</Td>
              <Td className="text-xs">
                {cfg.chartOfAccounts[l.key] ?? <span className="text-besar-dark">{l.key}</span>}
              </Td>
              <Td className="text-right tabular-nums">{l.debit ? rs(l.debit) : ""}</Td>
              <Td className="text-right tabular-nums">{l.credit ? rs(l.credit) : ""}</Td>
              <Td className="max-w-xs truncate text-xs" title={l.memo}>
                {l.memo}
              </Td>
            </tr>
          ))}
          {!j.lines.length && <EmptyRow colSpan={7}>Nothing to post in this range.</EmptyRow>}
        </tbody>
      </Table>
      {j.lines.length > 300 && <p className="mt-2 text-xs text-ink-mute">Showing the first 300 lines; the CSV has all {j.lines.length}.</p>}
    </>
  );
}

async function Settings({ canEdit }: { canEdit: boolean }) {
  const [cfg, keys] = await Promise.all([getFinanceConfig(), journalAccountKeys()]);
  return (
    <ActionForm action={saveFinanceSettingsAction} className="space-y-4">
      <Panel title="Gateway fee rates (for estimates)">
        <p className="mb-3 text-sm text-ink-mute">Used to estimate `gatewayFee` when a payment is marked paid. Take these from your merchant agreements; leave blank or 0 if unknown. The imported statement overrides the estimate with the actual fee.</p>
        <div className="grid gap-3 sm:grid-cols-4">
          {GATEWAY_METHODS.map((m) => (
            <label key={m} className={label}>
              {METHOD_LABEL[m]} fee %
              <input name={`fee_${m}`} inputMode="decimal" disabled={!canEdit} defaultValue={cfg.feeBps[m] != null ? String(cfg.feeBps[m] / 100) : ""} className="field mt-1 w-full" placeholder="e.g. 1.5" />
            </label>
          ))}
        </div>
      </Panel>
      <Panel title="Chart-of-accounts mapping (journal export)">
        <p className="mb-3 text-sm text-ink-mute">Enter the accountant&apos;s account code / name for each internal key. Blank = exported as UNMAPPED.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {keys.map((k) => (
            <label key={k.key} className={label}>
              {k.label} <span className="font-mono font-normal text-ink-mute">({k.key})</span>
              <input name={`acct_${k.key}`} maxLength={80} disabled={!canEdit} defaultValue={cfg.chartOfAccounts[k.key] ?? ""} className="field mt-1 w-full" />
            </label>
          ))}
        </div>
      </Panel>
      {canEdit ? <SubmitButton variant="dark">Save finance settings</SubmitButton> : <p className="text-sm text-ink-mute">Only finance approvers can change these.</p>}
    </ActionForm>
  );
}
