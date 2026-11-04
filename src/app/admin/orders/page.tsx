import Link from "next/link";
import type { OrderPaymentStatus, OrderSource, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { addDays, dateOnly, formatDay, isoDate, isValidISODate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { ORDER_PAYMENT_STATUS, ORDER_STATUS, METHOD_LABEL } from "@/lib/labels";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, Table, Th, Td, EmptyRow, OrderBadge, Pagination } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { kitchensFor, piiFor, inScope, kitchenWhere } from "@/components/admin/ops/scope";
import { bulkStatusAction } from "./actions";

export const metadata = { title: "Orders" };
const PER = 50;

type SP = Record<string, string | undefined>;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("orders.view");
  const sp = await searchParams;
  const pii = piiFor(user);
  const today = todayKTM();
  const from = sp.from && isValidISODate(sp.from) ? sp.from : today;
  const to = sp.to && isValidISODate(sp.to) ? sp.to : addDays(from, 6);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const kitchens = await kitchensFor(user);
  const [zones, companies, slots] = await Promise.all([
    db.deliveryZone.findMany({ where: kitchenWhere(user), orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.deliverySlot.findMany({ where: { isActive: true, ...kitchenWhere(user) }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } }),
  ]);

  const q = sp.q?.trim();
  const where: Prisma.OrderWhereInput = {
    deliveryDate: { gte: dateOnly(from), lte: dateOnly(to) },
    ...(sp.kitchen && inScope(user, sp.kitchen) ? { kitchenId: sp.kitchen } : kitchenWhere(user)),
    ...(sp.status ? { status: sp.status as OrderStatus } : {}),
    ...(sp.pay ? { paymentStatus: sp.pay as OrderPaymentStatus } : {}),
    ...(sp.zone ? { zoneId: sp.zone } : {}),
    ...(sp.slot ? { slotId: sp.slot } : {}),
    ...(sp.source ? { source: sp.source as OrderSource } : {}),
    ...(sp.company ? { companyId: sp.company } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { code: { equals: q.toUpperCase() } },
            { contactPhone: { contains: q.replace(/\D/g, "").slice(-8) || q } },
            { contactName: { contains: q, mode: "insensitive" } },
            { placeName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [orders, total, byStatus] = await Promise.all([
    db.order.findMany({
      where,
      include: { items: { select: { name: true, quantity: true } }, payment: { select: { method: true } }, zone: { select: { name: true } }, company: { select: { name: true } } },
      orderBy: [{ deliveryDate: "asc" }, { slotLabel: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PER,
      take: PER,
    }),
    db.order.count({ where }),
    db.order.groupBy({ by: ["status"], where: { ...where, status: undefined }, _count: true }),
  ]);
  const meals = orders.reduce((a, o) => a + o.items.reduce((b, i) => b + i.quantity, 0), 0);
  const canBulk = can(user, "orders.bulk");
  const params: SP = { ...sp, from, to };
  const statusLink = (s?: string) => {
    const p = new URLSearchParams(Object.entries({ ...params, status: s, page: undefined }).filter(([, v]) => v) as [string, string][]);
    return `/admin/orders?${p}`;
  };

  return (
    <div>
      <PageHeader title="Orders" description="One order per delivery day. Filter, open an order for its full timeline, or change many at once." />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href={statusLink()} className={`rounded-full border px-3 py-1 text-xs font-semibold ${!sp.status ? "border-ink bg-ink text-paper" : "border-ink-line bg-white"}`}>
          All {byStatus.reduce((a, s) => a + s._count, 0)}
        </Link>
        {byStatus
          .sort((a, b) => Object.keys(ORDER_STATUS).indexOf(a.status) - Object.keys(ORDER_STATUS).indexOf(b.status))
          .map((s) => (
            <Link key={s.status} href={statusLink(s.status)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${sp.status === s.status ? "border-ink bg-ink text-paper" : "border-ink-line bg-white"}`}>
              {ORDER_STATUS[s.status].label} {s._count}
            </Link>
          ))}
      </div>
      <form className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-ink-line/80 bg-white p-3 shadow-card md:grid-cols-4 lg:grid-cols-6">
        <input name="q" defaultValue={q} placeholder="Order no., code, phone, name, office" className="field col-span-2" aria-label="Search" />
        <label className="text-xs font-semibold text-ink-mute">From<input type="date" name="from" defaultValue={from} className="field mt-1" /></label>
        <label className="text-xs font-semibold text-ink-mute">To<input type="date" name="to" defaultValue={to} className="field mt-1" /></label>
        <Sel name="status" value={sp.status} label="Status" options={Object.entries(ORDER_STATUS).map(([v, s]) => [v, s.label])} />
        <Sel name="pay" value={sp.pay} label="Payment" options={Object.entries(ORDER_PAYMENT_STATUS).map(([v, s]) => [v, s.label])} />
        {kitchens.length > 1 && <Sel name="kitchen" value={sp.kitchen} label="Kitchen" options={kitchens.map((k) => [k.id, k.name])} />}
        <Sel name="zone" value={sp.zone} label="Zone" options={zones.map((z) => [z.id, z.name])} />
        <Sel name="slot" value={sp.slot} label="Slot" options={slots.map((s) => [s.id, s.label])} />
        <Sel name="source" value={sp.source} label="Source" options={[["SINGLE", "Single"], ["SUBSCRIPTION", "Plan"], ["CORPORATE", "Corporate"], ["ADMIN", "Staff"]]} />
        <Sel name="company" value={sp.company} label="Company" options={companies.map((c) => [c.id, c.name])} />
        <div className="col-span-2 flex items-end gap-2 md:col-span-1">
          <button className="h-[38px] flex-1 rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Filter</button>
          <Link href="/admin/orders" className="h-[38px] rounded-lg border border-ink-line px-3 py-2 text-sm">Reset</Link>
        </div>
      </form>
      <p className="mb-2 text-sm text-ink-mute">
        {total} orders · {meals} meals on this page · {formatDay(from)} – {formatDay(to)}
      </p>

      <ActionForm action={bulkStatusAction}>
        {canBulk && (
          <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-ink-line/80 bg-paper-card p-2 shadow-card">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-mute">Bulk</span>
            <select name="status" className="field w-48" defaultValue="" aria-label="New status">
              <option value="">Move ticked to…</option>
              {Object.entries(ORDER_STATUS)
                .filter(([v]) => v !== "CANCELLED" && v !== "PENDING_PAYMENT")
                .map(([v, s]) => (
                  <option key={v} value={v}>
                    {s.label}
                  </option>
                ))}
            </select>
            <input name="reason" placeholder="Reason (audited)" className="field w-56" />
            <SubmitButton size="sm" variant="dark" confirm="Change the status of every ticked order?">
              Apply
            </SubmitButton>
            <span className="text-xs text-ink-mute">Invalid moves are skipped and listed.</span>
          </div>
        )}
        <Table>
          <thead>
            <tr>
              {canBulk && <Th className="w-8"><span className="sr-only">Select</span></Th>}
              <Th>Order</Th>
              <Th>Day · slot</Th>
              <Th>Customer · drop</Th>
              <Th>Dabbas</Th>
              <Th>Status</Th>
              <Th>Payment</Th>
              <Th className="text-right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-paper/40">
                {canBulk && (
                  <Td>
                    <input type="checkbox" name="ids" value={o.id} className="h-4 w-4 accent-sindoor" aria-label={`Select ${o.number}`} />
                  </Td>
                )}
                <Td>
                  <Link href={`/admin/orders/${o.id}`} className="font-semibold text-ink hover:text-sindoor">{o.number}</Link>
                  <div className="font-mono text-xs text-ink-mute">#{o.code} · {o.source === "SUBSCRIPTION" ? "plan" : o.source.toLowerCase()}</div>
                </Td>
                <Td>
                  <div className="font-medium">{formatDay(isoDate(o.deliveryDate))}</div>
                  <div className="text-xs text-ink-mute">{o.slotLabel ?? "Any slot"}</div>
                </Td>
                <Td>
                  <div className="font-medium">{o.contactName} <span className="text-xs font-normal text-ink-mute">{pii.phone(o.contactPhone)}</span></div>
                  <div className="text-xs text-ink-mute">{[o.placeName, o.area, o.zone?.name].filter(Boolean).join(" · ")}</div>
                  {o.company && <div className="text-xs text-akash">{o.company.name}</div>}
                </Td>
                <Td className="text-xs">
                  {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                  {o.allergenNote && <div className="mt-0.5 font-semibold text-sindoor">⚠ {o.allergenNote}</div>}
                </Td>
                <Td><OrderBadge status={o.status} /></Td>
                <Td>
                  <Badge tone={ORDER_PAYMENT_STATUS[o.paymentStatus].tone}>{ORDER_PAYMENT_STATUS[o.paymentStatus].label}</Badge>
                  {o.payment && <div className="mt-0.5 text-xs text-ink-mute">{METHOD_LABEL[o.payment.method]}</div>}
                </Td>
                <Td className="text-right tabular-nums">
                  {rs(o.total)}
                  {o.companyShare > 0 && <div className="text-xs text-ink-mute">co. {rs(o.companyShare)}</div>}
                </Td>
              </tr>
            ))}
            {!orders.length && <EmptyRow colSpan={canBulk ? 8 : 7}>No orders match these filters.</EmptyRow>}
          </tbody>
        </Table>
      </ActionForm>
      <Pagination page={page} pages={Math.ceil(total / PER)} params={params} basePath="/admin/orders" />
    </div>
  );
}

function Sel({ name, value, label, options }: { name: string; value?: string; label: string; options: [string, string][] }) {
  return (
    <label className="text-xs font-semibold text-ink-mute">
      {label}
      <select name={name} defaultValue={value ?? ""} className="field mt-1">
        <option value="">Any</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
