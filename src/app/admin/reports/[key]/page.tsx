import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDay } from "@/lib/dates";
import { rs } from "@/lib/money";
import { PageHeader, Panel, Callout } from "@/components/admin/ui";
import { Kpi, pct } from "@/components/admin/finance/kit";
import { ExportButton } from "@/components/admin/ExportButton";
import { TablePager } from "@/components/admin/DataTable";
import { PrintButton } from "@/components/admin/finance/PrintButton";
import { kitchensFor } from "@/components/admin/ops/scope";
import { companyScope } from "@/server/corporate";
import { REPORTS, canExportReport, canViewReport, reportParams, runReport, type Col } from "@/server/reports-center";
import type { Cell, ColKind } from "@/server/reports-center/types";

type SP = Record<string, string | undefined>;

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return { title: REPORTS[key]?.title ?? "Report" };
}

function fmt(v: Cell, kind: ColKind | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (kind === "money") return rs(v);
    if (kind === "pct") return pct(v, 1);
    if (kind === "num") return v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
    return v.toLocaleString("en-IN");
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (kind === "date") return formatDay(v);
  return v;
}

const numeric = (c: Col) => c.kind === "money" || c.kind === "int" || c.kind === "num" || c.kind === "pct";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SP> }) {
  const user = await requirePermission("reports.view");
  const { key } = await params;
  const def = REPORTS[key];
  if (!def) notFound();
  if (!canViewReport(user, def)) redirect("/admin/forbidden");
  const sp = await searchParams;
  const out = await runReport(user, key, sp);
  const { f } = out.ctx;
  const base = `/admin/reports/${key}`;
  const current = { ...reportParams(out), per: out.paging.per !== 50 ? String(out.paging.per) : undefined };
  const scopeCompanies = companyScope(user);
  const [kitchens, companies] = await Promise.all([
    def.filters.includes("kitchen") ? kitchensFor(user) : Promise.resolve([]),
    def.filters.includes("company") ? db.company.findMany({ where: scopeCompanies ? { id: { in: scopeCompanies } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const canExport = canExportReport(user, def);
  const kitchenValue = f.kitchenIds?.length === 1 ? f.kitchenIds[0] : "";
  const range = def.filters.includes("range") && !def.snapshot;

  return (
    <div>
      <PageHeader
        back={{ href: "/admin/reports", label: "Reports" }}
        title={def.title}
        description={
          <>
            {def.description} {range ? `${formatDay(f.from, "long")} → ${formatDay(f.to, "long")}.` : def.snapshot ? "Snapshot right now." : ""}
          </>
        }
        actions={
          <>
            <ExportButton href={`/api/admin/export/report/${key}`} params={current} allowed={canExport} label="CSV" format="csv" />
            <ExportButton href={`/api/admin/export/report/${key}`} params={current} allowed={canExport} label="Excel" format="xlsx" />
            <PrintButton />
          </>
        }
      />

      <form action={base} method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-ink-line/80 bg-white p-3 shadow-card print:hidden">
        {range && (
          <>
            <label className="text-xs font-semibold text-ink-soft">
              From
              <input type="date" name="from" defaultValue={f.from} className="field mt-1 w-40" />
            </label>
            <label className="text-xs font-semibold text-ink-soft">
              To
              <input type="date" name="to" defaultValue={f.to} className="field mt-1 w-40" />
            </label>
          </>
        )}
        {def.filters.includes("kitchen") && kitchens.length > 1 && (
          <label className="text-xs font-semibold text-ink-soft">
            Kitchen
            <select name="kitchen" defaultValue={kitchenValue} className="field mt-1 w-44">
              <option value="">All my kitchens</option>
              {kitchens.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {def.filters.includes("company") && companies.length > 0 && (
          <label className="text-xs font-semibold text-ink-soft">
            Company
            <select name="company" defaultValue={f.companyId ?? ""} className="field mt-1 w-44">
              <option value="">{scopeCompanies ? "All my companies" : "All"}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {def.filters.includes("ctype") && (
          <label className="text-xs font-semibold text-ink-soft">
            Customers
            <select name="ctype" defaultValue={f.customerType ?? ""} className="field mt-1 w-36">
              <option value="">All</option>
              <option value="INDIVIDUAL">Individuals</option>
              <option value="CORPORATE">Corporate</option>
            </select>
          </label>
        )}
        {(def.choices ?? []).map((c) => (
          <label key={c.name} className="text-xs font-semibold text-ink-soft">
            {c.label}
            <select name={c.name} defaultValue={out.ctx.choice[c.name]} className="field mt-1 w-40">
              {c.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {out.paging.per !== 50 && <input type="hidden" name="per" value={out.paging.per} />}
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-soft">Apply</button>
      </form>

      {out.summary && out.summary.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {out.summary.map((s) => (
            <Kpi key={s.label} label={s.label} value={fmt(s.value, s.kind)} formula={s.note} />
          ))}
        </div>
      )}
      {(out.notes ?? []).map((n) => (
        <Callout key={n} tone="info" className="mb-4">
          {n}
        </Callout>
      ))}

      <div className="overflow-x-auto rounded-xl border border-ink-line/80 bg-white shadow-card">
        <table className="w-full text-left text-sm" style={{ minWidth: Math.max(640, out.columns.length * 110) }}>
          <caption className="sr-only">{def.title}</caption>
          <thead>
            <tr>
              {out.columns.map((c) => (
                <th key={c.key} scope="col" className={`border-b border-ink-line/70 bg-paper/60 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-mute ${numeric(c) ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {out.rows.length === 0 && (
              <tr>
                <td colSpan={out.columns.length} className="px-3 py-12 text-center text-sm text-ink-mute">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
            {out.rows.map((r, i) => (
              <tr key={i} className="align-top hover:bg-paper/30">
                {out.columns.map((c) => (
                  <td key={c.key} className={`border-b border-ink-line/40 px-3 py-2 ${numeric(c) ? "text-right tabular-nums" : ""}`}>
                    {fmt(r[c.key], c.kind)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {out.totals && out.rows.length > 0 && (
            <tfoot>
              <tr className="bg-paper/40 font-semibold">
                {out.columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${numeric(c) ? "text-right tabular-nums" : ""}`}>
                    {out.totals![c.key] === undefined ? "" : fmt(out.totals![c.key], c.kind)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <TablePager basePath={base} params={current} state={out.paging} total={out.count} />

      <Panel title="How this report is calculated" className="mt-6">
        <p className="text-sm text-ink-soft">{def.definition}</p>
        <p className="mt-2 text-xs text-ink-mute">
          Totals cover every matching row, not just this page.{out.piiMasked ? " Contact details are masked for your role." : ""}
          {canExport ? " Exports carry the same filters, include the totals row and are recorded in the audit log." : ""}
        </p>
      </Panel>
    </div>
  );
}
