import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Panel, KV } from "@/components/admin/ui";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { piiFor } from "@/components/admin/ops/scope";
import { messageFlagAction, messageToTicketAction } from "../../support/actions";

export const metadata = { title: "Message" };

export default async function MessagePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("support");
  const { id } = await params;
  const m = await db.contactMessage.findUnique({ where: { id } });
  if (!m) notFound();
  if (!m.isRead) await db.contactMessage.update({ where: { id }, data: { isRead: true } });
  const pii = piiFor(user.role);
  return (
    <div>
      <PageHeader back={{ href: "/admin/messages", label: "Messages" }} title={m.subject || "Website message"} actions={<>
        {m.ticketId ? <Link href={`/admin/support/${m.ticketId}`} className="rounded-lg border border-ink-line bg-white px-3 py-2 text-sm font-semibold">Open ticket</Link> : <ConfirmAction action={messageToTicketAction.bind(null, m.id)} label="Make a ticket" variant="dark" />}
        <ConfirmAction action={messageFlagAction.bind(null, m.id, m.isArchived ? "unarchive" : "archive")} label={m.isArchived ? "Unarchive" : "Archive"} />
      </>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <Panel><p className="whitespace-pre-line text-sm">{m.message}</p></Panel>
        <Panel title="From"><KV items={[["Name", m.name], ["Email", pii.email(m.email)], ["Phone", pii.phone(m.phone)], ["Received", formatStamp(m.createdAt)]]} /></Panel>
      </div>
    </div>
  );
}
