import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { ROLE_LABEL } from "@/lib/permissions";
import { PageHeader, KV } from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { FilterForm, DateRangeFields, TextFilter, Field } from "@/components/admin/Filters";
import { SavedViews } from "@/components/admin/SavedViews";
import { Drawer } from "@/components/admin/Dialog";
import { Badge } from "@/components/ui/Badge";
import { flatParams, hrefWith, type SearchParamsRecord } from "../_kit/params";
import { listSavedViews } from "../_kit/saved-views";
import { auditFilterOptions, diffKeys, parseAuditFilters, parseAuditList, searchAudit, type AuditRow } from "./query";

export const metadata = { title: "Audit log" };
const BASE = "/admin/audit";

function show(v: unknown, max = 160) {
  if (v === undefined) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Field-level diff of before/after JSON. */
function Diff({ before, after, limit = 30 }: { before: unknown; after: unknown; limit?: number }) {
  const rows = diffKeys(before, after);
  if (!rows.length) {
    if (after === null && before === null) return <p className="text-ink-mute">No data captured.</p>;
    return <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-paper/60 p-2 font-mono text-[11px]">{show(after ?? before, 4000)}</pre>;
  }
  return (
    <table className="w-full text-[11px]">
      <caption className="sr-only">Changed fields</caption>
      <thead>
        <tr className="text-left text-ink-mute">
          <th scope="col" className="pb-1 pr-2 font-semibold">Field</th>
          <th scope="col" className="pb-1 pr-2 font-semibold">Before</th>
          <th scope="col" className="pb-1 font-semibold">After</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, limit).map((r) => (
          <tr key={r.key} className="align-top">
            <td className="pr-2 font-mono font-semibold">{r.key}</td>
            <td className="break-all pr-2 text-sindoor-dark line-through decoration-sindoor/40">{show(r.before)}</td>
            <td className="break-all text-saag-dark">{show(r.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requirePermission("audit.view");
  const sp = await searchParams;
  const filters = parseAuditFilters(sp);
  const state = parseAuditList(sp);
  const params = flatParams(sp);
  const [{ rows, total }, options, views] = await Promise.all([searchAudit(user, filters, state), auditFilterOptions(), listSavedViews(user.id, "audit")]);
  const filtered = Object.keys(params).some((k) => !["page", "sort", "dir", "per"].includes(k));

  const columns: Column<AuditRow>[] = [
    { key: "createdAt", header: "When", sortable: true, className: "whitespace-nowrap text-xs tabular-nums", cell: (l) => formatStamp(l.createdAt) },
    {
      key: "actor",
      header: "Who",
      className: "text-xs",
      cell: (l) =>
        l.actor ? (
          <>
            <Link href={hrefWith(BASE, params, { actor: l.actor.id })} className="font-semibold hover:underline">
              {l.actor.name}
            </Link>
            <span className="block text-ink-mute">{ROLE_LABEL[l.actor.role]}</span>
          </>
        ) : (
          <span className="text-ink-mute">System</span>
        ),
    },
    {
      key: "action",
      header: "Action",
      sortable: true,
      defaultDir: "asc",
      className: "text-xs",
      cell: (l) => (
        <>
          <span className="font-mono">{l.action}</span>
          {l.approver && (
            <span className="mt-1 block">
              <Badge tone="good">Approved by {l.approver.name}</Badge>
            </span>
          )}
        </>
      ),
    },
    {
      key: "entity",
      header: "Record",
      sortable: true,
      defaultDir: "asc",
      className: "text-xs",
      cell: (l) => (
        <>
          <Link href={hrefWith(BASE, params, { entity: l.entity })} className="hover:underline">
            {l.entity}
          </Link>
          {l.entityId &&
            (l.href ? (
              <Link href={l.href} className="block max-w-[150px] truncate font-mono text-akash hover:underline" title={`Open ${l.entity} ${l.entityId}`}>
                {l.entityId}
              </Link>
            ) : (
              <span className="block max-w-[150px] truncate font-mono text-ink-mute">{l.entityId}</span>
            ))}
        </>
      ),
    },
    {
      key: "change",
      header: "Change",
      className: "min-w-[320px] text-xs",
      cell: (l) => (
        <>
          {l.summary && <p className="font-medium text-ink">{l.summary}</p>}
          {l.reason && <p className="text-ink-mute">Reason: {l.reason}</p>}
          {(l.before !== null || l.after !== null) && (
            <details className="mt-1">
              <summary className="cursor-pointer text-ink-mute hover:text-ink">Before / after</summary>
              <div className="mt-1">
                <Diff before={l.before} after={l.after} />
              </div>
            </details>
          )}
        </>
      ),
    },
    {
      key: "details",
      header: <span className="sr-only">Details</span>,
      align: "right",
      cell: (l) => (
        <Drawer label="Details" title={l.action} description={formatStamp(l.createdAt)} triggerClassName="rounded-md px-2 py-1 text-xs font-semibold text-ink-mute hover:bg-ink/5 hover:text-ink">
          <div className="space-y-5">
            <KV
              items={[
                ["Who", l.actor ? `${l.actor.name} (${ROLE_LABEL[l.actor.role]})` : "System"],
                ["Approved by", l.approver?.name ?? "—"],
                ["Record", l.href ? <Link href={l.href} className="text-akash hover:underline">{`${l.entity} ${l.entityId ?? ""}`}</Link> : `${l.entity} ${l.entityId ?? ""}`],
                ["Summary", l.summary ?? "—"],
                ["Reason", l.reason ?? "—"],
                [
                  "Request ID",
                  l.requestId ? (
                    <Link href={hrefWith(BASE, {}, { requestId: l.requestId })} className="break-all font-mono text-xs text-akash hover:underline" title="Show every entry from this request">
                      {l.requestId}
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
                ["IP", l.ip ?? "—"],
                ["Device", l.userAgent ? <span className="break-words text-xs">{l.userAgent}</span> : "—"],
              ]}
            />
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-mute">Before / after</h3>
              <Diff before={l.before} after={l.after} limit={200} />
            </section>
          </div>
        </Drawer>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Audit log" description={`Who changed what, when and why. Append-only; secrets are never stored. ${total.toLocaleString("en-IN")} matching entries.`} />
      <SavedViews module="audit" basePath={BASE} current={params} views={views} />
      <FilterForm basePath={BASE} q={filters.q} qLabel="Search" placeholder="Summary, reason, person, ID" keep={{ sort: params.sort, dir: params.dir, per: params.per }} active={filtered}>
        <Field label="Record type" htmlFor="flt-entity">
          <select id="flt-entity" name="entity" defaultValue={filters.entity ?? ""} className="field w-auto">
            <option value="">All records</option>
            {options.entities.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Who" htmlFor="flt-actor">
          <select id="flt-actor" name="actor" defaultValue={filters.actor ?? ""} className="field w-auto">
            <option value="">Anyone</option>
            <option value="system">System</option>
            {options.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <TextFilter name="action" label="Action starts with" value={filters.action} placeholder="e.g. order." />
        <TextFilter name="entityId" label="Record ID" value={filters.entityId} className="w-36 font-mono" />
        <TextFilter name="requestId" label="Request ID" value={filters.requestId} className="w-36 font-mono" />
        <Field label="Approvals" htmlFor="flt-approved">
          <select id="flt-approved" name="approved" defaultValue={filters.approved ? "yes" : ""} className="field w-auto">
            <option value="">All entries</option>
            <option value="yes">Approved changes only</option>
          </select>
        </Field>
        <DateRangeFields from={filters.from} to={filters.to} />
      </FilterForm>
      <DataTable caption="Audit entries" columns={columns} rows={rows} rowKey={(l) => l.id} basePath={BASE} params={params} state={state} total={total} empty="No audit entries match these filters." minWidth={900} />
    </>
  );
}
