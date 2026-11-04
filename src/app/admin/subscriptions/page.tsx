import Link from "next/link";
import type { Prisma, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatDay, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { SUB_STATUS } from "@/lib/labels";
import { PageHeader, Table, Th, Td, EmptyRow, SubBadge, Pagination, Tabs } from "@/components/admin/ui";
import { piiFor } from "@/components/admin/ops/scope";

export const metadata = { title: "Meal plans sold" };
const PER = 40;

export default async function SubsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; plan?: string; page?: string }> }) {
  const user = await requirePermission("subscriptions.view");
  const sp = await searchParams;
  const pii = piiFor(user);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = sp.q?.trim();
  const where: Prisma.SubscriptionWhereInput = {
    ...(sp.status ? { status: sp.status as SubscriptionStatus } : {}),
    ...(sp.plan ? { planId: sp.plan } : {}),
    ...(q ? { OR: [{ reference: { contains: q, mode: "insensitive" } }, { user: { name: { contains: q, mode: "insensitive" } } }, { user: { phoneNumber: { contains: q } } }] } : {}),
  };
  const [subs, total, counts, plans] = await Promise.all([
    db.subscription.findMany({ where, include: { user: { select: { name: true, phoneNumber: true } }, plan: { select: { name: true } }, _count: { select: { orders: { where: { status: "DELIVERED" } } } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }),
    db.subscription.count({ where }),
    db.subscription.groupBy({ by: ["status"], _count: true }),
    db.mealPlan.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const count = (s?: string) => (s ? counts.find((c) => c.status === s)?._count ?? 0 : counts.reduce((a, c) => a + c._count, 0));
  return (
    <div>
      <PageHeader title="Meal plans sold" description="Each plan is a set of daily orders. Open one to skip, pause, resume or cancel on the customer's behalf." />
      <Tabs current={sp.status ?? "all"} tabs={[{ key: "all", label: "All", href: "/admin/subscriptions", count: count() }, ...Object.entries(SUB_STATUS).map(([k, v]) => ({ key: k, label: v.label, href: `/admin/subscriptions?status=${k}`, count: count(k) }))]} />
      <form className="mb-3 flex flex-wrap gap-2">
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <input name="q" defaultValue={q} placeholder="Reference, name or phone" className="field max-w-xs" />
        <select name="plan" defaultValue={sp.plan ?? ""} className="field w-52" aria-label="Plan"><option value="">All plans</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button className="rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Filter</button>
      </form>
      <Table>
        <thead><tr><Th>Plan</Th><Th>Customer</Th><Th>Dates</Th><Th>Progress</Th><Th>Status</Th><Th className="text-right">Total</Th></tr></thead>
        <tbody>
          {subs.map((s) => (
            <tr key={s.id}>
              <Td><Link href={`/admin/subscriptions/${s.id}`} className="font-semibold hover:text-sindoor">{s.reference}</Link><div className="text-xs text-ink-mute">{s.plan.name}{s.vegOnly ? " · veg" : ""}{s.boxChoice === "CUSTOM" ? " · picked days" : ""}</div></Td>
              <Td>{s.user.name}<div className="text-xs text-ink-mute">{pii.phone(s.user.phoneNumber)}</div></Td>
              <Td className="text-xs">{formatDay(isoDate(s.startDate))} → {formatDay(isoDate(s.endDate))}<div>{s.days.join(" ")}</div></Td>
              <Td className="text-xs">{s._count.orders}/{s.mealsTotal} delivered<div className="mt-1 h-1.5 w-24 rounded bg-paper-deep"><div className="h-1.5 rounded bg-saag" style={{ width: `${Math.min(100, (s._count.orders / Math.max(1, s.mealsTotal)) * 100)}%` }} /></div></Td>
              <Td><SubBadge status={s.status} /></Td>
              <Td className="text-right tabular-nums">{rs(s.total)}</Td>
            </tr>
          ))}
          {!subs.length && <EmptyRow colSpan={6}>No plans match.</EmptyRow>}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / PER)} params={sp} basePath="/admin/subscriptions" />
    </div>
  );
}
