import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatDay, isoDate, monthRange, todayKTM, dateOnly } from "@/lib/dates";
import { maskEmail } from "@/lib/phone";
import { INVOICE_STATUS } from "@/lib/labels";
import { PageHeader, Panel, Tabs, Table, Th, Td, EmptyRow, OrderBadge } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { Kpi } from "@/components/admin/finance/kit";
import { companyOutstanding } from "@/server/corporate";
import { CompanyForm, RegenerateCode, MemberRow, LocationForm, LocationToggle, ContractForm } from "../CompanyForms";

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; status?: string }> }) {
  const user = await requirePermission("corporate.view");
  const { id } = await params;
  const { tab = "overview", status } = await searchParams;
  const c = await db.company.findUnique({ where: { id }, include: { zone: { select: { name: true } } } });
  if (!c) notFound();
  const pii = can(user, "customers.pii");
  const { start, end, ym } = monthRange(todayKTM().slice(0, 7));
  const [outstanding, members, locations, contracts, invoices, month, zones, slots, counts] = await Promise.all([
    companyOutstanding(c.id),
    db.companyMember.findMany({ where: { companyId: c.id, ...(status ? { status: status as "PENDING" | "ACTIVE" | "REMOVED" } : { status: { not: "REMOVED" } }) }, include: { user: { select: { id: true, name: true, email: true } }, officeLocation: { select: { name: true } } }, orderBy: [{ status: "asc" }, { createdAt: "asc" }] }),
    db.officeLocation.findMany({ where: { companyId: c.id }, include: { zone: { select: { name: true } }, slot: { select: { label: true } }, _count: { select: { members: true } } }, orderBy: { createdAt: "asc" } }),
    db.corporateContract.findMany({ where: { companyId: c.id }, orderBy: { startsOn: "desc" } }),
    db.invoice.findMany({ where: { companyId: c.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.order.aggregate({ where: { companyId: c.id, deliveryDate: { gte: dateOnly(start), lte: dateOnly(end) }, status: { in: ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED"] } }, _sum: { companyShare: true, customerShare: true }, _count: true }),
    db.deliveryZone.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
    db.deliverySlot.findMany({ where: { isActive: true }, select: { id: true, label: true }, orderBy: { sortOrder: "asc" } }),
    db.companyMember.groupBy({ by: ["status"], where: { companyId: c.id }, _count: true }),
  ]);
  const n = (s: string) => counts.find((x) => x.status === s)?._count ?? 0;
  const orders =
    tab === "orders"
      ? await db.order.findMany({ where: { companyId: c.id }, include: { user: { select: { name: true } } }, orderBy: [{ deliveryDate: "desc" }, { number: "desc" }], take: 100 })
      : [];
  const base = `/admin/companies/${c.id}`;
  const tabs = [
    { key: "overview", label: "Overview", href: base },
    { key: "members", label: "Members", href: `${base}?tab=members`, count: n("ACTIVE") + n("PENDING") },
    { key: "locations", label: "Offices", href: `${base}?tab=locations`, count: locations.length },
    { key: "contracts", label: "Contracts", href: `${base}?tab=contracts`, count: contracts.length },
    { key: "invoices", label: "Invoices", href: `${base}?tab=invoices`, count: invoices.length },
    { key: "orders", label: "Orders", href: `${base}?tab=orders` },
    { key: "settings", label: "Billing & settings", href: `${base}?tab=settings` },
  ];

  return (
    <div>
      <PageHeader
        title={c.name}
        back={{ href: "/admin/companies", label: "Companies" }}
        description={
          <>
            Join code <span className="font-mono font-semibold">{c.joinCode}</span> · staff enter it in their profile{c.requireApproval ? " and wait for approval" : ""}.
          </>
        }
        actions={<RegenerateCode id={c.id} />}
      />
      <Tabs tabs={tabs} current={tab} />

      {tab === "overview" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label={`Meals · ${ym}`} value={month._count} />
          <Kpi label="Company share this month" value={rs(month._sum.companyShare ?? 0)} />
          <Kpi label="Employees paid this month" value={rs(month._sum.customerShare ?? 0)} />
          <Kpi label="Owes now" value={rs(outstanding)} sub={c.creditLimit != null ? `Limit ${rs(c.creditLimit)}` : "No credit limit"} tone={c.creditLimit != null && outstanding > c.creditLimit ? "bad" : "default"} formula="Company share of live meals not yet invoiced + unpaid balance of issued invoices." />
          <Kpi label="Active members" value={n("ACTIVE")} sub={n("PENDING") ? `${n("PENDING")} waiting for approval` : undefined} tone={n("PENDING") ? "warn" : "default"} />
          <Kpi label="Billing" value={c.billingMode === "SPLIT" ? `${c.subsidyPct}% split` : c.billingMode === "COMPANY_PAID" ? "Company pays" : "Employees pay"} sub={[c.subsidyCap ? `cap ${rs(c.subsidyCap)}/meal` : null, c.monthlyAllowance ? `${rs(c.monthlyAllowance)}/person/month` : null, c.discountPct ? `${c.discountPct}% discount` : null].filter(Boolean).join(" · ") || undefined} />
          <Kpi label="Zone" value={c.zone?.name ?? "—"} sub={c.cutoffOverride ? `Own cut-off ${c.cutoffOverride}` : "Global cut-off"} />
          <Kpi label="Invoice terms" value={`${c.invoiceTermsDays} days`} sub={c.panVat ? `PAN ${c.panVat}` : "PAN/VAT missing"} tone={c.panVat ? "default" : "warn"} />
        </div>
      )}

      {tab === "members" && (
        <>
          <div className="mb-3 flex gap-2 text-sm">
            {[["", "Current"], ["PENDING", "Pending"], ["ACTIVE", "Active"], ["REMOVED", "Removed"]].map(([k, l]) => (
              <Link key={k} href={`${base}?tab=members${k ? `&status=${k}` : ""}`} className={`rounded-full border px-3 py-1 ${status === k || (!status && !k) ? "border-ink bg-ink text-paper" : "border-ink-line bg-white"}`}>
                {l}
              </Link>
            ))}
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Office</Th>
                <Th>Settings</Th>
              </tr>
            </thead>
            <tbody>
              {members.length ? (
                members.map((m) => (
                  <tr key={m.id} className="align-top">
                    <Td>
                      <Link href={`/admin/customers/${m.user.id}`} className="font-semibold hover:text-sindoor">
                        {m.user.name}
                      </Link>
                      {m.role === "ADMIN" && <Badge tone="info" className="ml-1">admin</Badge>}
                      <div className="text-xs text-ink-mute">{pii ? m.user.email : maskEmail(m.user.email)}</div>
                    </Td>
                    <Td className="text-xs">{m.officeLocation?.name ?? "—"}</Td>
                    <Td>
                      <MemberRow m={m} locations={locations.filter((l) => l.isActive).map((l) => ({ id: l.id, name: l.name }))} />
                    </Td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={3}>No members here.</EmptyRow>
              )}
            </tbody>
          </Table>
        </>
      )}

      {tab === "locations" && (
        <div className="space-y-4">
          <Table>
            <thead>
              <tr>
                <Th>Office</Th>
                <Th>Address</Th>
                <Th>Zone</Th>
                <Th>Slot</Th>
                <Th>Receiver</Th>
                <Th className="text-right">People</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {locations.length ? (
                locations.map((l) => (
                  <tr key={l.id} className={l.isActive ? "" : "opacity-50"}>
                    <Td className="font-semibold">{l.name}</Td>
                    <Td className="text-xs">{[l.line1, l.area, l.ward ? `ward ${l.ward}` : null, l.landmark].filter(Boolean).join(", ")}</Td>
                    <Td>{l.zone?.name ?? <Badge tone="bad">not served</Badge>}</Td>
                    <Td className="text-xs">{l.slot?.label ?? "—"}</Td>
                    <Td className="text-xs">{l.receiverName ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{l._count.members}</Td>
                    <Td>
                      <LocationToggle id={l.id} active={l.isActive} />
                    </Td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={7}>No offices yet. Team orders deliver to each member&apos;s office.</EmptyRow>
              )}
            </tbody>
          </Table>
          <Panel title="Add an office">
            <LocationForm companyId={c.id} slots={slots} />
          </Panel>
        </div>
      )}

      {tab === "contracts" && (
        <div className="space-y-4">
          {contracts.map((k) => (
            <Panel key={k.id} title={k.title} actions={<Badge tone={k.status === "ACTIVE" ? "good" : "neutral"}>{k.status.toLowerCase()}</Badge>}>
              <ContractForm companyId={c.id} contract={{ ...k, startsOn: isoDate(k.startsOn), endsOn: k.endsOn ? isoDate(k.endsOn) : null }} />
            </Panel>
          ))}
          <Panel title="New contract">
            <ContractForm companyId={c.id} />
          </Panel>
        </div>
      )}

      {tab === "invoices" && (
        <Table>
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Period</Th>
              <Th>Status</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Paid</Th>
              <Th>Due</Th>
            </tr>
          </thead>
          <tbody>
            {invoices.length ? (
              invoices.map((i) => (
                <tr key={i.id}>
                  <Td>
                    {can(user, "invoices.view") ? (
                      <Link href={`/admin/invoices/${i.id}`} className="font-mono text-xs text-sindoor hover:underline">
                        {i.number}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs">{i.number}</span>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {formatDay(isoDate(i.periodStart))} – {formatDay(isoDate(i.periodEnd))}
                  </Td>
                  <Td>
                    <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{rs(i.total)}</Td>
                  <Td className="text-right tabular-nums">{rs(i.paidAmount)}</Td>
                  <Td className="text-xs">{i.dueDate ? formatDay(isoDate(i.dueDate)) : "—"}</Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={6}>No invoices yet.</EmptyRow>
            )}
          </tbody>
        </Table>
      )}

      {tab === "orders" && (
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Date</Th>
              <Th>Member</Th>
              <Th>Status</Th>
              <Th className="text-right">Company</Th>
              <Th className="text-right">Member</Th>
              <Th>Invoice</Th>
            </tr>
          </thead>
          <tbody>
            {orders.length ? (
              orders.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link href={`/admin/orders/${o.id}`} className="font-semibold text-sindoor hover:underline">
                      {o.number}
                    </Link>
                  </Td>
                  <Td className="text-xs">{formatDay(isoDate(o.deliveryDate))}</Td>
                  <Td>{o.user.name}</Td>
                  <Td>
                    <OrderBadge status={o.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{rs(o.companyShare)}</Td>
                  <Td className="text-right tabular-nums">{rs(o.customerShare)}</Td>
                  <Td className="text-xs">{o.invoiceId ? "billed" : o.companyShare ? "not yet" : "—"}</Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={7}>No orders yet.</EmptyRow>
            )}
          </tbody>
        </Table>
      )}

      {tab === "settings" && (
        <Panel>
          <CompanyForm company={c} zones={zones} />
        </Panel>
      )}
    </div>
  );
}
