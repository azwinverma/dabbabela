import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatStamp } from "@/lib/dates";
import { Callout, KV, PageHeader, Panel, Table, Td, Th } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { currentState, decisionBlocker, describeRequest, getApproval, KIND_LABEL } from "@/server/approvals";
import { APPROVAL_TONE } from "../tone";
import { CancelForm, DecisionForms, RetryForm } from "../ApprovalForms";

export const metadata = { title: "Approval request" };

const LINK: Record<string, (id: string) => string> = {
  Payment: (id) => `/admin/payments/${id}`,
  Order: (id) => `/admin/orders/${id}`,
  User: (id) => `/admin/customers/${id}`,
};

/** Payload fields shown to the approver (ids link to the record; amounts in rupees). */
function payloadRows(payload: unknown): [string, React.ReactNode][] {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const out: [string, React.ReactNode][] = [];
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === "") continue;
    const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
    if (k === "amount") out.push([label, `${Number(v) < 0 ? "−" : ""}${rs(Math.abs(Number(v)))}`]);
    else if (k === "paymentId") out.push([label, <Link key={k} href={`/admin/payments/${v}`} className="font-mono text-xs text-sindoor hover:underline">{String(v)}</Link>]);
    else if (k === "orderId") out.push([label, <Link key={k} href={`/admin/orders/${v}`} className="font-mono text-xs text-sindoor hover:underline">{String(v)}</Link>]);
    else if (k === "userId") out.push([label, <Link key={k} href={`/admin/customers/${v}`} className="font-mono text-xs text-sindoor hover:underline">{String(v)}</Link>]);
    else out.push([label, String(v)]);
  }
  return out;
}

export default async function ApprovalDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("approvals.view");
  const { id } = await params;
  const r = await getApproval(user, id);
  if (!r) notFound();
  const [state, history] = await Promise.all([
    currentState(r),
    db.auditLog.findMany({ where: { entity: "ApprovalRequest", entityId: r.id }, orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true } } }, take: 50 }),
  ]);
  const blocker = decisionBlocker(user, r);
  const own = r.requestedById === user.id;
  const executed = history.find((h) => h.action === "approval.execute")?.after as Record<string, unknown> | undefined;

  return (
    <div className="space-y-5">
      <PageHeader title={describeRequest(r)} description={`${KIND_LABEL[r.kind]} · requested ${formatStamp(r.createdAt)} by ${r.requestedBy.name}`} back={{ href: "/admin/approvals", label: "Approvals" }} actions={<Badge tone={APPROVAL_TONE[r.status]}>{r.status.toLowerCase()}</Badge>} />
      {r.status === "FAILED" && (
        <Callout tone="bad" title="Approved, but carrying it out failed">
          {r.error}
        </Callout>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Requested">
          <KV
            items={[
              ["Amount", rs(r.amount)],
              ["Reason", r.reason],
              ...(r.entity && r.entityId && LINK[r.entity] ? ([["Record", <Link key="rec" href={LINK[r.entity](r.entityId)} className="text-sindoor hover:underline">{r.entity}</Link>]] as [string, React.ReactNode][]) : []),
              ...payloadRows(r.payload),
            ]}
          />
        </Panel>
        <Panel title="Now (re-checked when executed)">
          {state.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Check</Th>
                  <Th>Requested</Th>
                  <Th>Now</Th>
                </tr>
              </thead>
              <tbody>
                {state.map((s) => (
                  <tr key={s.label} className={s.changed ? "bg-sindoor-light" : undefined}>
                    <Td className="font-semibold">{s.label}</Td>
                    <Td>{s.requested}</Td>
                    <Td>
                      {s.now}
                      {s.changed && <span className="ml-2 text-xs font-bold text-sindoor-dark">changed</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-ink-mute">No live checks for this kind.</p>
          )}
        </Panel>
      </div>

      {r.status === "PENDING" &&
        (own ? (
          <Panel title="Your request">
            <p className="mb-3 text-sm text-ink-soft">Someone else has to approve or reject this. You can withdraw it while it's pending.</p>
            <CancelForm id={r.id} />
          </Panel>
        ) : blocker ? (
          <Callout tone="info">{blocker}</Callout>
        ) : (
          <Panel title="Decide">
            <DecisionForms id={r.id} />
          </Panel>
        ))}
      {r.status === "FAILED" && !blocker && (
        <Panel title="Retry">
          <p className="mb-3 text-sm text-ink-soft">Fix the cause (e.g. the refundable amount or balance changed), then try again. It runs at most once.</p>
          <RetryForm id={r.id} />
        </Panel>
      )}

      <Panel title="Decision & history">
        <KV
          items={[
            ["Decided by", r.decidedBy?.name ?? "—"],
            ["Decided at", r.decidedAt ? formatStamp(r.decidedAt) : "—"],
            ["Note", r.decisionNote ?? "—"],
            ["Executed at", r.executedAt ? formatStamp(r.executedAt) : "—"],
            ...(executed?.refundId ? ([["Refund", <Link key="ref" href="/admin/refunds?view=APPROVED" className="text-sindoor hover:underline">created, waiting to be processed with proof</Link>]] as [string, React.ReactNode][]) : []),
          ]}
        />
        <ol className="mt-4 space-y-1 text-xs text-ink-soft">
          {history.map((h) => (
            <li key={h.id}>
              {formatStamp(h.createdAt)} — <span className="font-semibold">{h.action.replace("approval.", "")}</span> by {h.actor?.name ?? "system"}
              {h.reason ? `: ${h.reason}` : ""}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
