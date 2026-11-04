import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { CompleteForm, RejectForm } from "./PrivacyForms";

export const metadata = { title: "Privacy requests" };

export default async function Privacy() {
  await requirePermission("privacy");
  const [open, done] = await Promise.all([
    db.dataRequest.findMany({ where: { status: "OPEN" }, include: { user: { select: { id: true, name: true, email: true, deletedAt: true } } }, orderBy: { createdAt: "asc" } }),
    db.dataRequest.findMany({ where: { status: { not: "OPEN" } }, include: { user: { select: { id: true, name: true } } }, orderBy: { completedAt: "desc" }, take: 30 }),
  ]);
  return (
    <div>
      <PageHeader title="Privacy requests" description="Customers ask for a copy of their data or for deletion from their account page (or you log it from their customer record). Confirm the person's identity before acting." />
      <Panel title="What deletion does" className="mb-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>Removes name, email, phone, saved addresses, allergies and notes, saved dabbas, favourites, notifications and sign-in methods. The account can no longer sign in.</li>
          <li>Keeps orders, payments, invoices, refunds and the credit ledger — required for tax and accounting — with contact details stripped from the order snapshots.</li>
          <li>Feedback comments are cleared; ratings stay for kitchen statistics without a name.</li>
        </ul>
      </Panel>
      <Table>
        <thead>
          <tr>
            <Th>Customer</Th>
            <Th>Type</Th>
            <Th>Received</Th>
            <Th>Note</Th>
            <Th>Action</Th>
          </tr>
        </thead>
        <tbody>
          {open.length ? (
            open.map((r) => (
              <tr key={r.id} className="align-top">
                <Td>
                  <Link className="font-semibold hover:text-sindoor" href={`/admin/customers/${r.user.id}`}>
                    {r.user.name}
                  </Link>
                  <div className="text-xs text-ink-mute">{r.user.email}</div>
                </Td>
                <Td>
                  <Badge tone={r.type === "DELETE" ? "bad" : "info"}>{r.type === "DELETE" ? "Delete" : "Export"}</Badge>
                </Td>
                <Td className="text-xs">{formatStamp(r.createdAt)}</Td>
                <Td className="max-w-48 text-xs">{r.note}</Td>
                <Td>
                  <div className="flex flex-col gap-2">
                    {r.type === "EXPORT" && (
                      <a className="text-sm font-semibold text-sindoor underline" href={`/api/admin/export/privacy?user=${r.user.id}`}>
                        ↓ Download JSON to send them
                      </a>
                    )}
                    <CompleteForm id={r.id} type={r.type} />
                    <RejectForm id={r.id} />
                  </div>
                </Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={5}>No open requests.</EmptyRow>
          )}
        </tbody>
      </Table>
      {done.length > 0 && (
        <Panel title="Handled" className="mt-4">
          <ul className="divide-y divide-ink-line/50 text-sm">
            {done.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>
                  {r.user.name} · {r.type.toLowerCase()}
                </span>
                <span className="text-xs text-ink-mute">
                  {r.status.toLowerCase()} {r.completedAt ? formatStamp(r.completedAt) : ""} {r.note ? `· ${r.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
