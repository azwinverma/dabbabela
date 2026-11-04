import Link from "next/link";
import { requireCompanyAdmin } from "@/lib/auth";
import { formatNepalPhone } from "@/lib/phone";
import { roster, officeLocations } from "@/server/team";
import { Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { MemberControls } from "../TeamForms";

export const metadata = { title: "People" };

export default async function Roster({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; department?: string }> }) {
  const { company } = await requireCompanyAdmin();
  const sp = await searchParams;
  const status = ["PENDING", "ACTIVE", "REMOVED"].includes(sp.status ?? "") ? sp.status : undefined;
  const [people, locs] = await Promise.all([roster(company.id, { status, search: sp.q, department: sp.department }), officeLocations(company.id)]);
  const departments = [...new Set(people.map((p) => p.department).filter(Boolean))] as string[];
  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-bold">People</h1>
      <p className="mb-4 text-sm text-ink-mute">Approve new staff, set departments and cost centres for reports, and the office their lunch goes to.</p>
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Name or email" className="field max-w-xs" />
        <select name="status" defaultValue={status ?? ""} className="field w-36">
          <option value="">Current</option>
          <option value="PENDING">Pending</option>
          <option value="ACTIVE">Active</option>
          <option value="REMOVED">Removed</option>
        </select>
        {departments.length > 0 && (
          <select name="department" defaultValue={sp.department ?? ""} className="field w-40">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        )}
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Filter</button>
        <Link href="/team/invites" className="ml-auto self-center text-sm font-semibold text-sindoor underline">
          Invite people →
        </Link>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Person</Th>
            <Th>Status</Th>
            <Th>Details</Th>
          </tr>
        </thead>
        <tbody>
          {people.length ? (
            people.map((m) => (
              <tr key={m.id} className="align-top">
                <Td>
                  <p className="font-semibold">{m.user.name}</p>
                  <p className="text-xs text-ink-mute">
                    {m.user.email}
                    {m.user.phoneNumber ? ` · ${formatNepalPhone(m.user.phoneNumber)}` : ""}
                  </p>
                </Td>
                <Td>
                  <Badge tone={m.status === "ACTIVE" ? "good" : m.status === "PENDING" ? "warn" : "neutral"}>{m.status.toLowerCase()}</Badge>
                  {m.role === "ADMIN" && <Badge tone="info" className="ml-1">admin</Badge>}
                </Td>
                <Td>{m.status === "REMOVED" ? <span className="text-xs text-ink-mute">Removed</span> : <MemberControls m={m} locations={locs.map((l) => ({ id: l.id, name: l.name }))} />}</Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={3}>Nobody here yet. Share your join code or send invites.</EmptyRow>
          )}
        </tbody>
      </Table>
    </div>
  );
}
