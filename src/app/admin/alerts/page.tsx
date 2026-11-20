import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatStamp } from "@/lib/dates";
import { db } from "@/lib/db";
import { PageHeader, Panel, StatCard, KV } from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { FilterForm, Field, StatusSelect } from "@/components/admin/Filters";
import { SavedViews } from "@/components/admin/SavedViews";
import { Drawer } from "@/components/admin/Dialog";
import { Badge } from "@/components/ui/Badge";
import type { Tone } from "@/lib/labels";
import { flatParams, hrefWith, one, parseEnum, parseListParams, type SearchParamsRecord } from "../_kit/params";
import { listSavedViews } from "../_kit/saved-views";
import { ALERT_SORTS, ALERT_STATUSES, DETECTORS, DETECTOR_LABEL, SEVERITIES, alertAssignees, getEscalationRules, listAlerts, type AlertFilters, type AlertRow } from "@/server/alerts";
import { AlertActions, BulkBar, EscalationForm, RunDetectorsButton } from "./AlertControls";

export const metadata = { title: "Alerts" };
const BASE = "/admin/alerts";

const SEV_TONE: Record<string, Tone> = { CRITICAL: "bad", WARNING: "warn", INFO: "info" };
const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = { OPEN: { label: "Open", tone: "bad" }, ACKNOWLEDGED: { label: "Acknowledged", tone: "warn" }, RESOLVED: { label: "Resolved", tone: "good" } };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requirePermission("alerts.view");
  const canEdit = can(user, "alerts.edit");
  const sp = await searchParams;
  const params = flatParams(sp);
  const statusRaw = one(sp, "status");
  const ownerRaw = one(sp, "owner");
  const filters: AlertFilters = {
    status: statusRaw === "ALL" ? "ALL" : (parseEnum(sp, "status", ALERT_STATUSES) ?? "ACTIVE"),
    severity: parseEnum(sp, "severity", SEVERITIES),
    source: parseEnum(sp, "source", DETECTORS.map((d) => d.name)),
    owner: ownerRaw === "me" ? user.id : ownerRaw,
    q: one(sp, "q"),
    kitchenId: one(sp, "kitchen"),
  };
  const state = parseListParams(sp, { sortable: ALERT_SORTS, sort: "severity", dir: "desc" });
  const [{ rows, total, active }, assignees, rules, views, kitchens] = await Promise.all([
    listAlerts(user, filters, state),
    alertAssignees(),
    getEscalationRules(),
    listSavedViews(user.id, "alerts"),
    db.kitchen.findMany({ where: { isActive: true, ...(user.kitchenIds ? { id: { in: user.kitchenIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const kitchenName = new Map(kitchens.map((k) => [k.id, k.name]));
  const filtered = Object.keys(params).some((k) => !["page", "sort", "dir", "per"].includes(k));

  const columns: Column<AlertRow>[] = [
    ...(canEdit
      ? [
          {
            key: "select",
            header: <span className="sr-only">Select</span>,
            className: "w-8",
            cell: (a: AlertRow) => (a.status === "RESOLVED" ? null : <input type="checkbox" data-alert-select value={a.id} aria-label={`Select: ${a.message}`} />),
          },
        ]
      : []),
    { key: "severity", header: "Severity", sortable: true, className: "whitespace-nowrap", cell: (a) => <Badge tone={SEV_TONE[a.severity] ?? "neutral"}>{a.severity.toLowerCase()}</Badge> },
    {
      key: "message",
      header: "Alert",
      className: "min-w-[320px] text-sm",
      cell: (a) => (
        <>
          <p className="font-medium text-ink">{a.message}</p>
          <p className="text-xs text-ink-mute">
            <Link href={hrefWith(BASE, params, { source: a.source })} className="hover:underline">
              {DETECTOR_LABEL[a.source] ?? a.source}
            </Link>
            {" · "}
            <span className="font-mono">{a.type}</span>
            {a.meta.kitchenId && kitchenName.get(a.meta.kitchenId) ? ` · ${kitchenName.get(a.meta.kitchenId)}` : ""}
            {a.meta.href && (
              <>
                {" · "}
                <Link href={a.meta.href} className="font-semibold text-akash hover:underline">
                  Open
                </Link>
              </>
            )}
          </p>
        </>
      ),
    },
    {
      key: "status",
      header: "Status",
      className: "whitespace-nowrap text-xs",
      cell: (a) => (
        <>
          <Badge tone={STATUS_LABEL[a.status]?.tone ?? "neutral"}>{STATUS_LABEL[a.status]?.label ?? a.status}</Badge>
          {a.status === "ACKNOWLEDGED" && a.ackByName && <span className="mt-1 block text-ink-mute">by {a.ackByName}</span>}
          {a.status === "RESOLVED" && <span className="mt-1 block text-ink-mute">by {a.resolvedByName}</span>}
          {a.meta.escalatedAt && a.status === "OPEN" && <span className="mt-1 block text-sindoor-dark">escalated</span>}
        </>
      ),
    },
    { key: "owner", header: "Owner", className: "whitespace-nowrap text-xs", cell: (a) => a.ownerName ?? <span className="text-ink-mute">—</span> },
    { key: "lastSeenAt", header: "Last seen", sortable: true, className: "whitespace-nowrap text-xs tabular-nums", cell: (a) => formatStamp(a.lastSeenAt) },
    { key: "firstSeenAt", header: "First seen", sortable: true, className: "whitespace-nowrap text-xs tabular-nums", cell: (a) => formatStamp(a.firstSeenAt) },
    { key: "count", header: "Times", sortable: true, align: "right", className: "text-xs tabular-nums", cell: (a) => a.count },
    {
      key: "details",
      header: <span className="sr-only">Details</span>,
      align: "right",
      cell: (a) => (
        <Drawer label="Details" title={DETECTOR_LABEL[a.source] ?? a.type} description={a.message} triggerClassName="rounded-md px-2 py-1 text-xs font-semibold text-ink-mute hover:bg-ink/5 hover:text-ink">
          <div className="space-y-5">
            <KV
              items={[
                ["Severity", `${a.severity} · priority ${a.priority}`],
                ["Status", STATUS_LABEL[a.status]?.label ?? a.status],
                ["Owner", a.ownerName ?? "Unassigned"],
                ["First seen", formatStamp(a.firstSeenAt)],
                ["Last seen", formatStamp(a.lastSeenAt)],
                ["Occurrences", String(a.count)],
                ["Acknowledged", a.ackAt ? `${formatStamp(a.ackAt)} by ${a.ackByName}` : "—"],
                ["Resolved", a.resolvedAt ? `${formatStamp(a.resolvedAt)} by ${a.resolvedByName}` : "—"],
                ["Resolution note", a.resolutionNote ?? "—"],
                ["Escalated", a.meta.escalatedAt ? `${formatStamp(a.meta.escalatedAt)}${a.meta.escalatedTo?.length ? ` to ${a.meta.escalatedTo.length} recipient(s)` : ""}` : "—"],
                ["Record", a.meta.href ? <Link href={a.meta.href} className="text-akash hover:underline">{`${a.entity ?? "Open"} ${a.entityId ?? ""}`}</Link> : `${a.entity ?? "—"} ${a.entityId ?? ""}`],
                ["Key", <span key="k" className="break-all font-mono text-xs">{a.dedupeKey}</span>],
              ]}
            />
            {canEdit ? <AlertActions alert={{ id: a.id, status: a.status, ownerId: a.ownerId }} assignees={assignees} /> : <p className="text-xs text-ink-mute">You can view alerts; acknowledging, assigning and resolving needs the alerts edit permission.</p>}
            <Link href={`/admin/audit?entity=Alert&entityId=${a.id}`} className="block text-xs font-semibold text-akash hover:underline">
              Audit history
            </Link>
          </div>
        </Drawer>
      ),
    },
  ];

  const sevCard = (s: (typeof SEVERITIES)[number], tone: "warn" | "brand" | "default") => <StatCard label={`Active ${s.toLowerCase()}`} value={active[s] ?? 0} tone={tone} href={hrefWith(BASE, {}, { severity: s })} />;

  return (
    <>
      <PageHeader
        title="Alerts"
        description={`Problems the system found — deduplicated, with an owner, acknowledgement and resolution. Detectors run in the daily housekeeping cron, after the cut-off lock, and on demand. ${total.toLocaleString("en-IN")} matching.`}
        actions={canEdit ? <RunDetectorsButton /> : undefined}
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {sevCard("CRITICAL", "brand")}
        {sevCard("WARNING", "warn")}
        {sevCard("INFO", "default")}
      </div>
      <SavedViews module="alerts" basePath={BASE} current={params} views={views} />
      <FilterForm basePath={BASE} q={filters.q} placeholder="Message, type or record ID" keep={{ sort: params.sort, dir: params.dir, per: params.per }} active={filtered}>
        <Field label="Status" htmlFor="flt-status">
          <select id="flt-status" name="status" defaultValue={statusRaw ?? ""} className="field w-auto">
            <option value="">Active (open + acknowledged)</option>
            <option value="OPEN">Open</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ALL">All</option>
          </select>
        </Field>
        <StatusSelect name="severity" label="Severity" value={filters.severity} options={SEVERITIES.map((s) => ({ value: s, label: s.toLowerCase() }))} />
        <StatusSelect name="source" label="Detector" value={filters.source} options={DETECTORS.map((d) => ({ value: d.name, label: d.label }))} />
        <Field label="Owner" htmlFor="flt-owner">
          <select id="flt-owner" name="owner" defaultValue={ownerRaw ?? ""} className="field w-auto">
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="none">Unassigned</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        {kitchens.length > 1 && <StatusSelect name="kitchen" label="Kitchen" value={filters.kitchenId} anyLabel="All kitchens" options={kitchens.map((k) => ({ value: k.id, label: k.name }))} />}
      </FilterForm>
      {canEdit && rows.some((r) => r.status !== "RESOLVED") && <BulkBar assignees={assignees} />}
      <DataTable caption="Alerts" columns={columns} rows={rows} rowKey={(a) => a.id} basePath={BASE} params={params} state={state} total={total} empty={filtered ? "No alerts match these filters." : "No active alerts. Detectors run in the daily housekeeping cron."} minWidth={960} />
      <Panel title="Escalation" className="mt-6">
        <p className="mb-3 text-sm text-ink-soft">
          Alerts still <strong>open</strong> (not acknowledged) past these times are emailed to the owner — or, when unassigned, to the roles below and super admins — once per occurrence, through the outbox. Without an email provider (Resend) configured, messages are recorded in the outbox as not sent.
        </p>
        <EscalationForm rules={rules} canEdit={canEdit} />
      </Panel>
    </>
  );
}
