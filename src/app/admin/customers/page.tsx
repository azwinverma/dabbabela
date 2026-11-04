import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { formatStamp } from "@/lib/dates";
import { formatNepalPhone, maskEmail, maskPhone } from "@/lib/phone";
import { DIET_LABEL } from "@/lib/labels";
import { PageHeader, Table, Th, Td, EmptyRow, Pagination } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";

export const metadata = { title: "Customers" };
const PER = 40;

export default async function Customers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("customers");
  const pii = can(user.role, "customers.pii");
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = sp.q?.trim();
  const digits = q?.replace(/\D/g, "");
  const where: Prisma.UserWhereInput = {
    role: "CUSTOMER",
    deletedAt: null,
    ...(sp.status === "inactive" ? { isActive: false } : sp.status === "active" ? { isActive: true } : {}),
    ...(sp.company === "yes" ? { membership: { status: "ACTIVE" } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            ...(digits && digits.length >= 4 ? [{ phoneNumber: { contains: digits } }] : []),
            { addresses: { some: { area: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      include: {
        membership: { include: { company: { select: { name: true } } } },
        addresses: { where: { isDefault: true }, select: { area: true, type: true }, take: 1 },
        _count: { select: { orders: true, subscriptions: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER,
      take: PER,
    }),
    db.user.count({ where }),
  ]);

  return (
    <div>
      <PageHeader title="Customers" description={`${total} customers${pii ? "" : " · contact details are masked for your role"}`} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Name, email, phone or area" className="field max-w-xs" />
        <select name="status" defaultValue={sp.status ?? ""} className="field w-36">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
        </select>
        <select name="company" defaultValue={sp.company ?? ""} className="field w-44">
          <option value="">Everyone</option>
          <option value="yes">Company members</option>
        </select>
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Filter</button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Contact</Th>
            <Th>Area</Th>
            <Th>Diet</Th>
            <Th>Company</Th>
            <Th className="text-right">Orders</Th>
            <Th>Joined</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((c) => (
              <tr key={c.id} className="hover:bg-paper/40">
                <Td>
                  <Link href={`/admin/customers/${c.id}`} className="font-semibold text-ink hover:text-sindoor">
                    {c.name}
                  </Link>
                  {!c.isActive && <Badge tone="bad" className="ml-2">deactivated</Badge>}
                  {c.allergies.length > 0 && <Badge tone="warn" className="ml-2">allergies</Badge>}
                </Td>
                <Td className="text-xs">
                  <div>{pii ? c.email : maskEmail(c.email)}</div>
                  <div className="text-ink-mute">{pii ? formatNepalPhone(c.phoneNumber) : maskPhone(c.phoneNumber)}</div>
                </Td>
                <Td className="text-xs">{c.addresses[0] ? `${c.addresses[0].area} · ${c.addresses[0].type.toLowerCase()}` : "—"}</Td>
                <Td className="text-xs">{c.diet === "ANY" ? "Any" : c.diet === "EGG_OK" ? "Veg + egg" : DIET_LABEL[c.diet as "VEG" | "VEGAN"]?.label}</Td>
                <Td className="text-xs">{c.membership ? `${c.membership.company.name}${c.membership.status !== "ACTIVE" ? ` (${c.membership.status.toLowerCase()})` : ""}` : "—"}</Td>
                <Td className="text-right tabular-nums">
                  {c._count.orders}
                  {c._count.subscriptions > 0 && <span className="text-xs text-ink-mute"> · {c._count.subscriptions} plans</span>}
                </Td>
                <Td className="whitespace-nowrap text-xs text-ink-mute">{formatStamp(c.createdAt)}</Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={7}>No customers match.</EmptyRow>
          )}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / PER)} params={sp} basePath="/admin/customers" />
    </div>
  );
}
