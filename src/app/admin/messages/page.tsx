import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Table, Th, Td, EmptyRow, Tabs } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { piiFor } from "@/components/admin/ops/scope";

export const metadata = { title: "Contact messages" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requirePermission("support.view");
  const { view = "inbox" } = await searchParams;
  const pii = piiFor(user);
  const msgs = await db.contactMessage.findMany({ where: { isArchived: view === "archive" }, orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div>
      <PageHeader title="Contact messages" description="Messages from the website contact form. Turn one into a ticket to track a reply." />
      <Tabs current={view} tabs={[{ key: "inbox", label: "Inbox", href: "/admin/messages" }, { key: "archive", label: "Archived", href: "/admin/messages?view=archive" }]} />
      <Table>
        <thead><tr><Th>From</Th><Th>Subject</Th><Th>Received</Th><Th>State</Th></tr></thead>
        <tbody>
          {msgs.map((m) => (
            <tr key={m.id} className={m.isRead ? "" : "font-semibold"}>
              <Td>{m.name}<div className="text-xs font-normal text-ink-mute">{pii.email(m.email)}</div></Td>
              <Td><Link href={`/admin/messages/${m.id}`} className="hover:text-sindoor">{m.subject || m.message.slice(0, 60)}</Link></Td>
              <Td className="text-xs font-normal">{formatStamp(m.createdAt)}</Td>
              <Td>{m.ticketId ? <Badge tone="info">ticket</Badge> : m.isRead ? <Badge>read</Badge> : <Badge tone="brand">new</Badge>}</Td>
            </tr>
          ))}
          {!msgs.length && <EmptyRow colSpan={4}>No messages.</EmptyRow>}
        </tbody>
      </Table>
    </div>
  );
}
