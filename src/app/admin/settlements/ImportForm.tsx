"use client";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/ActionForm";
import { importStatementAction, type ImportState } from "./actions";

const rs = (p: number) => `Rs ${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Statement CSV upload with the import report (matches, unmatched rows, duplicates) shown inline. */
export function ImportForm() {
  const [state, action] = useActionState<ImportState, FormData>(importStatementAction, { ok: false });
  const r = state.report;
  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-ink-soft">
          Gateway / bank
          <select name="provider" required className="field mt-1 w-36" defaultValue="ESEWA">
            <option value="ESEWA">eSewa</option>
            <option value="KHALTI">Khalti</option>
            <option value="BANK">Bank</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-soft">
          Amounts in
          <select name="unit" className="field mt-1 w-32" defaultValue="rupees">
            <option value="rupees">Rupees</option>
            <option value="paisa">Paisa</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-soft">
          Statement CSV
          <input type="file" name="file" accept=".csv,text/csv" required className="mt-1 block text-sm" />
        </label>
        <SubmitButton variant="dark" pendingText="Importing…">
          Import
        </SubmitButton>
      </form>
      {state.message && <FormMessage ok={state.ok} message={state.message} />}
      {r && (
        <div className="mt-4 space-y-3 text-sm">
          <p className="text-ink-mute">
            Batch <span className="font-mono">{r.batch}</span> · {r.rows} valid row(s) · fees updated on {r.feesUpdated} payment(s)
          </p>
          <Section title={`Unmatched (${r.unmatched.length})`} tone="warn" items={r.unmatched.map((u) => `Line ${u.line}: ${u.providerRef} · ${rs(u.amount)} — ${u.reason}`)} />
          <Section title={`Duplicate payments (${r.duplicatePayments.length})`} tone="bad" items={r.duplicatePayments.map((d) => `${d.reference}: settled ${d.lines}× for ${rs(d.amount)} — check for a double charge and refund`)} />
          <Section title={`Paid at the gateway but not paid here (${r.notPaidInSystem.length})`} tone="bad" items={r.notPaidInSystem.map((x) => `Line ${x.line}: ${x.providerRef} — our status ${x.status}`)} />
          <Section title={`Amount differs (${r.amountMismatches.length})`} tone="warn" items={r.amountMismatches.map((x) => `Line ${x.line}: ${x.providerRef} statement ${rs(x.statement)} vs payment ${rs(x.payment)}`)} />
          <Section title={`Repeated in this file (${r.duplicatesInFile.length})`} tone="warn" items={r.duplicatesInFile.map((x) => `Line ${x.line}: ${x.providerRef} (skipped)`)} />
          <Section title={`Rows with errors (${r.errors.length})`} tone="warn" items={r.errors.map((x) => `Line ${x.line}: ${x.error}`)} />
        </div>
      )}
    </div>
  );
}

function Section({ title, items, tone }: { title: string; items: string[]; tone: "warn" | "bad" }) {
  if (!items.length) return null;
  return (
    <details open className={`rounded-lg border px-3 py-2 ${tone === "bad" ? "border-sindoor/30 bg-sindoor-light" : "border-besar/50 bg-besar-light"}`}>
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <ul className="mt-1 list-disc pl-5">
        {items.slice(0, 200).map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </details>
  );
}
