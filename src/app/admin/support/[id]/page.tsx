import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can, STAFF_ROLES } from "@/lib/permissions";
import { formatStamp } from "@/lib/dates";
import { TICKET_STATUSES } from "@/server/support";
import { PageHeader, Panel, KV } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { piiFor } from "@/components/admin/ops/scope";
import { replyAction, ticketStatusAction } from "../actions";

export const metadata = { title: "Ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("support");
  const { id } = await params;
  const t = await db.supportTicket.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, email: true, phoneNumber: true } }, order: { select: { id: true, number: true, status: true } }, messages: { include: { author: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!t) notFound();
  const staff = await db.user.findMany({ where: { role: { in: STAFF_ROLES }, isActive: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  const pii = piiFor(user.role);
  return (
    <div>
      <PageHeader back={{ href: "/admin/support", label: "Support" }} title={t.subject} description={<span className="flex items-center gap-2">{t.number} · <Badge tone={t.status === "OPEN" ? "warn" : t.status === "PENDING" ? "info" : "good"}>{t.status.toLowerCase()}</Badge> · {t.category.toLowerCase()} · via {t.source.replace("_", " ")}</span>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {t.messages.map((m) => {
            const isStaff = m.author && m.author.role !== "CUSTOMER";
            return (
              <div key={m.id} className={`rounded-xl border p-4 ${m.internal ? "border-besar/60 bg-besar-light" : isStaff ? "ml-8 border-ink-line bg-white" : "mr-8 border-ink-line bg-paper-card"}`}>
                <p className="mb-1 text-xs text-ink-mute">
                  <b className="text-ink">{m.author?.name ?? t.name ?? "Customer"}</b> · {formatStamp(m.createdAt)}
                  {m.internal && " · internal note"}
                </p>
                <p className="whitespace-pre-line text-sm">{m.body}</p>
              </div>
            );
          })}
          <Panel title="Reply">
            <ActionForm action={replyAction.bind(null, t.id)} className="space-y-2" resetOnSuccess>
              <textarea name="body" rows={4} required className="field" placeholder="Write a reply…" />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="internal" className="h-4 w-4" /> Internal note (customer won&apos;t see it)</label>
                <SubmitButton size="sm">Send</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Customer">
            <KV
              items={[
                ["Name", t.user ? (can(user.role, "customers") ? <Link key="u" href={`/admin/customers/${t.user.id}`} className="text-akash underline">{t.user.name}</Link> : t.user.name) : t.name],
                ["Email", pii.email(t.user?.email ?? t.email)],
                ["Phone", pii.phone(t.user?.phoneNumber ?? t.phone)],
                ["Order", t.order ? <Link key="o" href={`/admin/orders/${t.order.id}`} className="text-akash underline">{t.order.number} ({t.order.status.toLowerCase()})</Link> : null],
                ["Opened", formatStamp(t.createdAt)],
                ["Resolved", t.resolvedAt ? formatStamp(t.resolvedAt) : null],
              ]}
            />
          </Panel>
          <Panel title="Manage">
            <ActionForm action={ticketStatusAction.bind(null, t.id)} className="space-y-2">
              <select name="status" defaultValue={t.status} className="field" aria-label="Status">{TICKET_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
              <select name="priority" defaultValue={t.priority} className="field" aria-label="Priority">{["URGENT", "HIGH", "NORMAL", "LOW"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
              <select name="assignedToId" defaultValue={t.assignedToId ?? ""} className="field" aria-label="Assignee"><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <SubmitButton size="sm" variant="dark">Update</SubmitButton>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </div>
  );
}
