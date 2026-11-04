import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { PageHeader, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { LinkButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { companyOutstanding } from "@/server/corporate";

export const metadata = { title: "Companies" };

const MODE = { EMPLOYEE_PAID: "Employees pay", COMPANY_PAID: "Company pays", SPLIT: "Split" } as const;

export default async function Companies({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("corporate");
  const { q } = await searchParams;
  const companies = await db.company.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { joinCode: { equals: q.toUpperCase() } }] } : {},
    include: { _count: { select: { members: { where: { status: "ACTIVE" } } } }, zone: { select: { name: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  const pending = await db.companyMember.groupBy({ by: ["companyId"], where: { status: "PENDING" }, _count: true });
  const outstanding = await Promise.all(companies.map((c) => companyOutstanding(c.id)));
  return (
    <div>
      <PageHeader title="Companies" description="Corporate lunch accounts: who pays what, members, offices, contracts and what they owe." actions={<LinkButton href="/admin/companies/new" size="sm">New company</LinkButton>} />
      <form className="mb-4">
        <input name="q" defaultValue={q} placeholder="Name or join code" className="field max-w-xs" />
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Company</Th>
            <Th>Billing</Th>
            <Th>Zone</Th>
            <Th className="text-right">Members</Th>
            <Th>Join code</Th>
            <Th className="text-right">Owes (incl. unbilled)</Th>
          </tr>
        </thead>
        <tbody>
          {companies.length ? (
            companies.map((c, i) => {
              const p = pending.find((x) => x.companyId === c.id)?._count ?? 0;
              const over = c.creditLimit != null && outstanding[i] > c.creditLimit;
              return (
                <tr key={c.id} className="hover:bg-paper/40">
                  <Td>
                    <Link href={`/admin/companies/${c.id}`} className="font-semibold hover:text-sindoor">
                      {c.name}
                    </Link>
                    {!c.isActive && <Badge className="ml-2">inactive</Badge>}
                  </Td>
                  <Td className="text-xs">
                    {MODE[c.billingMode]}
                    {c.billingMode === "SPLIT" && ` ${c.subsidyPct}%${c.subsidyCap ? ` ≤ ${rs(c.subsidyCap)}` : ""}`}
                    {c.discountPct ? ` · ${c.discountPct}% off` : ""}
                  </Td>
                  <Td className="text-xs">{c.zone?.name ?? "—"}</Td>
                  <Td className="text-right tabular-nums">
                    {c._count.members}
                    {p > 0 && <Badge tone="warn" className="ml-1">{p} pending</Badge>}
                  </Td>
                  <Td className="font-mono text-xs">{c.joinCode}</Td>
                  <Td className={`text-right tabular-nums ${over ? "font-bold text-sindoor" : ""}`}>
                    {rs(outstanding[i])}
                    {c.creditLimit != null && <div className="text-[10px] text-ink-mute">limit {rs(c.creditLimit)}</div>}
                  </Td>
                </tr>
              );
            })
          ) : (
            <EmptyRow colSpan={6}>No companies yet. Convert a won lead, or add one.</EmptyRow>
          )}
        </tbody>
      </Table>
    </div>
  );
}
