import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { FilterForm, StatusSelect } from "@/components/admin/Filters";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { ConfirmDialog } from "@/components/admin/Dialog";
import { Badge } from "@/components/ui/Badge";
import type { Tone } from "@/lib/labels";
import { flatParams, hrefWith, one, parseEnum, parseListParams, type SearchParamsRecord } from "../_kit/params";
import { JOBS, jobLabel, jobOverview, type JobName } from "@/server/jobs";
import { retryRunAction, runJobAction } from "./actions";

export const metadata = { title: "Scheduled jobs" };
const BASE = "/admin/jobs";
const STATUSES = ["RUNNING", "DONE", "FAILED"] as const;
const TONE: Record<string, Tone> = { DONE: "good", FAILED: "bad", RUNNING: "info" };

type Run = Awaited<ReturnType<typeof jobOverview>>["rows"][number];

function duration(r: { startedAt: Date; finishedAt: Date | null }) {
  if (!r.finishedAt) return "—";
  const ms = r.finishedAt.getTime() - r.startedAt.getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function brief(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = JSON.stringify(v);
  return s.length > 160 ? s.slice(0, 160) + "…" : s;
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requirePermission("settings.view");
  const canRun = can(user, "settings.edit");
  const sp = await searchParams;
  const params = flatParams(sp);
  const state = parseListParams(sp, { sortable: ["startedAt"] as const, sort: "startedAt" });
  const name = one(sp, "name");
  const status = parseEnum(sp, "status", STATUSES);
  const data = await jobOverview({ name, status, page: state.page, per: state.per });
  const stale = (r: Run) => r.status === "RUNNING" && Date.now() - r.startedAt.getTime() >= 15 * 60_000;
  const retryable = (r: Run) => canRun && (r.status === "FAILED" || stale(r)) && (/^lock-day:/.test(r.key) || /^(cutoff|housekeeping|frequent|alerts)\.[a-z-]+:/.test(r.key));

  const columns: Column<Run>[] = [
    { key: "startedAt", header: "Started", sortable: true, className: "whitespace-nowrap text-xs tabular-nums", cell: (r) => formatStamp(r.startedAt) },
    {
      key: "name",
      header: "Job",
      className: "text-xs",
      cell: (r) => (
        <>
          <Link href={hrefWith(BASE, params, { name: r.name })} className="font-semibold hover:underline">
            {jobLabel(r.name)}
          </Link>
          <span className="block break-all font-mono text-ink-mute">{r.key}</span>
        </>
      ),
    },
    { key: "status", header: "Status", className: "whitespace-nowrap", cell: (r) => <Badge tone={stale(r) ? "warn" : (TONE[r.status] ?? "neutral")}>{stale(r) ? "stuck" : r.status.toLowerCase()}</Badge> },
    { key: "duration", header: "Took", align: "right", className: "whitespace-nowrap text-xs tabular-nums", cell: duration },
    { key: "result", header: "Result / error", className: "min-w-[260px] text-xs", cell: (r) => (r.error ? <span className="text-sindoor-dark">{r.error.slice(0, 300)}</span> : <span className="font-mono text-ink-mute">{brief(r.result)}</span>) },
    {
      key: "retry",
      header: <span className="sr-only">Retry</span>,
      align: "right",
      cell: (r) =>
        retryable(r) ? <ConfirmDialog action={retryRunAction} fields={{ key: r.key }} label="Retry" title="Retry this run?" description={`Runs ${jobLabel(r.name)} again under the same key (${r.key}). The step is idempotent.`} confirmLabel="Retry" tone="primary" /> : null,
    },
  ];

  return (
    <>
      <PageHeader title="Scheduled jobs" description="Vercel Cron runs these; every step is recorded below with its idempotency key, so re-running is safe and failures stay visible (they also raise an alert)." />
      <Panel title="Jobs" className="mb-6">
        <Table>
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Schedule</Th>
              <Th>Steps</Th>
              <Th>
                <span className="sr-only">Run</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(JOBS) as JobName[]).map((j) => (
              <tr key={j} className="align-top">
                <Td>
                  <p className="font-semibold">{JOBS[j].label}</p>
                  <p className="text-xs text-ink-mute">{JOBS[j].description}</p>
                </Td>
                <Td className="text-xs">{JOBS[j].schedule}</Td>
                <Td className="text-xs">{JOBS[j].steps.map((s) => jobLabel(j === "cutoff" && s === "lock-day" ? "lock-day" : `${j}.${s}`).split(" · ").pop()).join(", ")}</Td>
                <Td className="text-right">{canRun ? <ConfirmAction action={runJobAction.bind(null, j)} label="Run now" confirm={`Run ${JOBS[j].label} now? Steps are idempotent; a double click within a minute is ignored.`} /> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {!canRun && <p className="mt-2 text-xs text-ink-mute">Running jobs by hand needs the settings edit permission.</p>}
      </Panel>
      <Panel title="Last run per step" className="mb-6">
        <Table>
          <thead>
            <tr>
              <Th>Step</Th>
              <Th>Last run</Th>
              <Th>Status</Th>
              <Th>History</Th>
            </tr>
          </thead>
          <tbody>
            {data.latest.length === 0 && <EmptyRow colSpan={4}>No job has run yet.</EmptyRow>}
            {data.latest.map((l) => (
              <tr key={l.id}>
                <Td className="text-sm">
                  <Link href={hrefWith(BASE, {}, { name: l.name })} className="font-medium hover:underline">
                    {jobLabel(l.name)}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap text-xs tabular-nums">{formatStamp(l.startedAt)}</Td>
                <Td>
                  <Badge tone={stale(l) ? "warn" : (TONE[l.status] ?? "neutral")}>{stale(l) ? "stuck" : l.status.toLowerCase()}</Badge>
                </Td>
                <Td className="text-xs text-ink-mute">
                  {l.counts.DONE ?? 0} done · {l.counts.FAILED ?? 0} failed{l.counts.RUNNING ? ` · ${l.counts.RUNNING} running` : ""}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <FilterForm basePath={BASE} q={null} keep={{ per: params.per }} active={Boolean(name || status)}>
        <StatusSelect name="name" label="Step" value={name} options={data.latest.map((l) => ({ value: l.name, label: jobLabel(l.name) }))} />
        <StatusSelect name="status" label="Status" value={status} options={STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))} />
      </FilterForm>
      <DataTable caption="Job runs" columns={columns} rows={data.rows} rowKey={(r) => r.id} basePath={BASE} params={params} state={state} total={data.total} empty="No runs match." minWidth={900} />
    </>
  );
}
