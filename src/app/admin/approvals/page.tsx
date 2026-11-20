import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { rs } from "@/lib/money";
import { formatStamp } from "@/lib/dates";
import { EmptyRow, PageHeader, Pagination, Table, Tabs, Td, Th } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { approvalThreshold, APPROVAL_STATUSES, describeRequest, EXECUTABLE_KINDS, KIND_LABEL, listApprovals } from "@/server/approvals";
import { APPROVAL_TONE } from "./tone";

export const metadata = { title: "Approvals" };

export default async function Approvals({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("approvals.view");
  const sp = await searchParams;
  const status = sp.status && (APPROVAL_STATUSES as string[]).includes(sp.status) ? sp.status : sp.status === "all" ? null : "PENDING";
  const kind = sp.kind && (EXECUTABLE_KINDS as readonly string[]).includes(sp.kind) ? sp.kind : null;
  const mine = sp.mine === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ rows, page: p, pages, total }, threshold] = await Promise.all([listApprovals(user, { status, kind, mine, page }), approvalThreshold()]);
  const decider = can(user, "approvals.approve");
  const qs = (o: Record<string, string | null | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ status: status ?? "all", kind, mine: mine ? "1" : null, ...o })) if (v) u.set(k, v);
    return `/admin/approvals?${u.toString()}`;
  };
  const tabs = [...APPROVAL_STATUSES.map((s) => ({ key: s, label: s.charAt(0) + s.slice(1).toLowerCase(), href: qs({ status: s }) })), { key: "all", label: "All", href: qs({ status: "all" }) }];

  return (
    <div>
      <PageHeader
        title="Approvals"
        description={
          <>
            Maker-checker: refunds, manual wallet adjustments and order adjustments of {rs(threshold)} or more wait here for a second person. Nobody can decide their own request.
            {decider ? " Approving carries the action out straight away, after re-checking the live balance or refundable amount." : " You see the requests you made."}
          </>
        }
      />
      <Tabs tabs={tabs} current={status ?? "all"} />
      <form className="mb-4 flex flex-wrap items-end gap-3 text-sm" action="/admin/approvals">
        <input type="hidden" name="status" value={status ?? "all"} />
        <label className="grid gap-1">
          <span className="font-semibold">Kind</span>
          <select name="kind" defaultValue={kind ?? ""} className="field w-48">
            <option value="">All kinds</option>
            {EXECUTABLE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} /> Only my requests
        </label>
        <button type="submit" className="rounded-lg border-2 border-ink px-3 py-1.5 font-semibold">
          Filter
        </button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Requested</Th>
            <Th>What</Th>
            <Th className="text-right">Amount</Th>
            <Th>Reason</Th>
            <Th>By</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r) => (
              <tr key={r.id} className="align-top">
                <Td className="whitespace-nowrap text-xs text-ink-mute">{formatStamp(r.createdAt)}</Td>
                <Td>
                  <Link href={`/admin/approvals/${r.id}`} className="font-semibold text-sindoor hover:underline">
                    {describeRequest(r)}
                  </Link>
                  <div className="text-xs text-ink-mute">{KIND_LABEL[r.kind]}</div>
                </Td>
                <Td className="text-right font-semibold tabular-nums">{rs(r.amount)}</Td>
                <Td className="max-w-64 text-xs">{r.reason}</Td>
                <Td className="text-xs">
                  {r.requestedBy.name}
                  {r.requestedById === user.id && <span className="ml-1 text-ink-mute">(you)</span>}
                </Td>
                <Td>
                  <Badge tone={APPROVAL_TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                  {r.decidedBy && <div className="mt-1 text-xs text-ink-mute">by {r.decidedBy.name}</div>}
                </Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={6}>No {status ? status.toLowerCase() : ""} requests.</EmptyRow>
          )}
        </tbody>
      </Table>
      <p className="mt-2 text-xs text-ink-mute">{total} request(s)</p>
      <Pagination page={p} pages={pages} params={{ status: status ?? "all", kind: kind ?? undefined, mine: mine ? "1" : undefined }} basePath="/admin/approvals" />
    </div>
  );
}
