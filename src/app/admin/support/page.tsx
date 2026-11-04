import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { TICKET_CATEGORIES, TICKET_STATUSES } from "@/server/support";
import { PageHeader, Table, Th, Td, EmptyRow, Tabs, Pagination } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";

export const metadata = { title: "Support tickets" };
const PER = 40;
const PRIORITY_TONE = { LOW: "neutral", NORMAL: "info", HIGH: "warn", URGENT: "bad" } as const;

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("support.view");
  const sp = await searchParams;
  const status = sp.status ?? "OPEN";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.SupportTicketWhereInput = {
    ...(status !== "ALL" ? { status } : {}),
    ...(sp.priority ? { priority: sp.priority } : {}),
    ...(sp.category ? { category: sp.category } : {}),
    ...(sp.mine ? { assignedToId: user.id } : sp.assignee === "none" ? { assignedToId: null } : {}),
    ...(sp.q ? { OR: [{ number: { contains: sp.q, mode: "insensitive" } }, { subject: { contains: sp.q, mode: "insensitive" } }, { user: { name: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [tickets, total, counts] = await Promise.all([
    db.supportTicket.findMany({ where, include: { user: { select: { name: true } }, assignedTo: { select: { name: true } }, order: { select: { number: true } }, _count: { select: { messages: true } } }, orderBy: [{ updatedAt: "desc" }], skip: (page - 1) * PER, take: PER }),
    db.supportTicket.count({ where }),
    db.supportTicket.groupBy({ by: ["status"], _count: true }),
  ]);
  const c = (s: string) => counts.find((x) => x.status === s)?._count ?? 0;
  const PR = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as Record<string, number>;
  tickets.sort((a, b) => (PR[a.priority] ?? 2) - (PR[b.priority] ?? 2));
  return (
    <div>
      <PageHeader title="Support tickets" description="Customer problems with orders, food, delivery or payments. Public replies notify the customer; internal notes don't." />
      <Tabs current={status} tabs={[...TICKET_STATUSES.map((s) => ({ key: s, label: s.charAt(0) + s.slice(1).toLowerCase(), href: `/admin/support?status=${s}`, count: c(s) })), { key: "ALL", label: "All", href: "/admin/support?status=ALL" }]} />
      <form className="mb-3 flex flex-wrap gap-2">
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={sp.q} placeholder="Ticket no., subject, customer" className="field max-w-xs" />
        <select name="priority" defaultValue={sp.priority ?? ""} className="field w-36" aria-label="Priority"><option value="">Any priority</option>{["URGENT", "HIGH", "NORMAL", "LOW"].map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}</select>
        <select name="category" defaultValue={sp.category ?? ""} className="field w-40" aria-label="Category"><option value="">Any category</option>{TICKET_CATEGORIES.map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}</select>
        <select name="assignee" defaultValue={sp.assignee ?? ""} className="field w-36" aria-label="Assignee"><option value="">Anyone</option><option value="none">Unassigned</option></select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={Boolean(sp.mine)} /> Mine</label>
        <button className="rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Filter</button>
      </form>
      <Table>
        <thead><tr><Th>Ticket</Th><Th>Customer</Th><Th>Category</Th><Th>Priority</Th><Th>Assignee</Th><Th>Updated</Th></tr></thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id}>
              <Td><Link href={`/admin/support/${t.id}`} className="font-semibold hover:text-sindoor">{t.subject}</Link><div className="text-xs text-ink-mute">{t.number} · {t._count.messages} msg{t.order ? ` · ${t.order.number}` : ""}</div></Td>
              <Td className="text-sm">{t.user?.name ?? t.name ?? "Guest"}</Td>
              <Td className="text-xs">{t.category.toLowerCase()}</Td>
              <Td><Badge tone={PRIORITY_TONE[t.priority as keyof typeof PRIORITY_TONE] ?? "neutral"}>{t.priority.toLowerCase()}</Badge></Td>
              <Td className="text-xs">{t.assignedTo?.name ?? "—"}</Td>
              <Td className="text-xs">{formatStamp(t.updatedAt)}</Td>
            </tr>
          ))}
          {!tickets.length && <EmptyRow colSpan={6}>No tickets here.</EmptyRow>}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / PER)} params={sp} basePath="/admin/support" />
    </div>
  );
}
