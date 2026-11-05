import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDay, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { ORDER_PAYMENT_STATUS, ORDER_STATUS, METHOD_LABEL } from "@/lib/labels";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader, OrderBadge } from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { FilterForm, DateRangeFields, StatusSelect } from "@/components/admin/Filters";
import { SavedViews } from "@/components/admin/SavedViews";
import { ExportButton } from "@/components/admin/ExportButton";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { kitchensFor, piiFor, kitchenWhere } from "@/components/admin/ops/scope";
import { flatParams, hrefWith, pageWindow, parseListParams, type SearchParamsRecord } from "../_kit/params";
import { listSavedViews } from "../_kit/saved-views";
import { ORDER_SORTS, parseOrderFilters, searchOrders } from "@/server/orders-admin";
import { bulkStatusAction } from "./actions";

export const metadata = { title: "Orders" };
const BASE = "/admin/orders";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requirePermission("orders.view");
  const sp = await searchParams;
  const pii = piiFor(user);
  const f = parseOrderFilters(sp);
  const state = parseListParams(sp, { sortable: ORDER_SORTS, sort: "deliveryDate", dir: "asc", per: 50 });
  const params: Record<string, string | undefined> = { ...flatParams(sp), from: f.from, to: f.to };

  const [kitchens, zones, companies, slots, views, result] = await Promise.all([
    kitchensFor(user),
    db.deliveryZone.findMany({ where: kitchenWhere(user), orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.deliverySlot.findMany({ where: { isActive: true, ...kitchenWhere(user) }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } }),
    listSavedViews(user.id, "orders"),
    searchOrders(user, f, { sort: state.sort, dir: state.dir, ...pageWindow(state) }),
  ]);
  const { rows: orders, total, byStatus } = result;
  type Row = (typeof orders)[number];
  const meals = orders.reduce((a, o) => a + o.items.reduce((b, i) => b + i.quantity, 0), 0);
  const canBulk = can(user, "orders.bulk");
  const canCreate = can(user, "orders.create");
  const filtered = Object.keys(flatParams(sp)).some((k) => !["page", "sort", "dir", "per"].includes(k));

  const columns: Column<Row>[] = [
    ...(canBulk
      ? [{ key: "pick", header: <span className="sr-only">Select</span>, className: "w-8", cell: (o: Row) => <input type="checkbox" name="ids" value={o.id} form="bulk-status" className="h-4 w-4 accent-sindoor" aria-label={`Select ${o.number}`} /> }]
      : []),
    {
      key: "number",
      header: "Order",
      sortable: true,
      defaultDir: "asc",
      cell: (o) => (
        <>
          <Link href={`/admin/orders/${o.id}`} className="font-semibold text-ink hover:text-sindoor">
            {o.number}
          </Link>
          <div className="font-mono text-xs text-ink-mute">
            #{o.code} · {o.source === "SUBSCRIPTION" ? "plan" : o.source === "ADMIN" ? "staff" : o.source.toLowerCase()}
          </div>
        </>
      ),
    },
    {
      key: "deliveryDate",
      header: "Day · slot",
      sortable: true,
      defaultDir: "asc",
      cell: (o) => (
        <>
          <div className="font-medium">{formatDay(isoDate(o.deliveryDate))}</div>
          <div className="text-xs text-ink-mute">
            {o.slotLabel ?? "Any slot"}
            {kitchens.length > 1 ? ` · ${o.kitchen.name}` : ""}
          </div>
        </>
      ),
    },
    {
      key: "customer",
      header: "Customer · drop",
      cell: (o) => (
        <>
          <div className="font-medium">
            {o.contactName} <span className="text-xs font-normal text-ink-mute">{pii.phone(o.contactPhone)}</span>
          </div>
          <div className="text-xs text-ink-mute">{[o.placeName, o.area, o.zone?.name].filter(Boolean).join(" · ")}</div>
          {o.company && (
            <Link href={hrefWith(BASE, params, { company: o.companyId })} className="text-xs text-akash hover:underline">
              {o.company.name}
            </Link>
          )}
        </>
      ),
    },
    {
      key: "items",
      header: "Dabbas",
      className: "text-xs",
      cell: (o) => (
        <>
          {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
          {o.allergenNote && <div className="mt-0.5 font-semibold text-sindoor">⚠ {o.allergenNote}</div>}
        </>
      ),
    },
    { key: "status", header: "Status", cell: (o) => <OrderBadge status={o.status} /> },
    {
      key: "pay",
      header: "Payment",
      cell: (o) => (
        <>
          <Badge tone={ORDER_PAYMENT_STATUS[o.paymentStatus].tone}>{ORDER_PAYMENT_STATUS[o.paymentStatus].label}</Badge>
          {o.payment && <div className="mt-0.5 text-xs text-ink-mute">{METHOD_LABEL[o.payment.method]}</div>}
        </>
      ),
    },
    {
      key: "total",
      header: "Total",
      sortable: true,
      align: "right",
      className: "tabular-nums",
      cell: (o) => (
        <>
          {rs(o.total)}
          {o.companyShare > 0 && <div className="text-xs text-ink-mute">co. {rs(o.companyShare)}</div>}
        </>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Orders"
        description="One order per delivery day. Search by order no., code, customer, company (phone/email with contact access); open an order for its timeline and edits."
        actions={
          <div className="flex flex-wrap gap-2">
            <ExportButton href={`${BASE}/export`} params={params} allowed={can(user, "orders.export")} />
            {canCreate && (
              <>
                <Link href={`${BASE}/bulk`} className={buttonClass("outline", "sm")}>
                  Corporate bulk order
                </Link>
                <Link href={`${BASE}/new`} className={buttonClass("dark", "sm")}>
                  New phone order
                </Link>
              </>
            )}
          </div>
        }
      />
      <SavedViews module="orders" basePath={BASE} current={flatParams(sp)} views={views} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href={hrefWith(BASE, params, { status: null })} className={`rounded-full border px-3 py-1 text-xs font-semibold ${!f.status ? "border-ink bg-ink text-paper" : "border-ink-line bg-white"}`}>
          All {byStatus.reduce((a, s) => a + s._count, 0)}
        </Link>
        {byStatus
          .sort((a, b) => Object.keys(ORDER_STATUS).indexOf(a.status) - Object.keys(ORDER_STATUS).indexOf(b.status))
          .map((s) => (
            <Link key={s.status} href={hrefWith(BASE, params, { status: s.status })} className={`rounded-full border px-3 py-1 text-xs font-semibold ${f.status === s.status ? "border-ink bg-ink text-paper" : "border-ink-line bg-white"}`}>
              {ORDER_STATUS[s.status].label} {s._count}
            </Link>
          ))}
      </div>
      <FilterForm basePath={BASE} q={f.q ?? ""} placeholder={pii.full ? "Order no., code, name, phone, company" : "Order no., code, name, company"} keep={{ sort: params.sort, dir: params.dir, per: params.per }} active={filtered}>
        <DateRangeFields from={f.from} to={f.to} label="Delivery" />
        <StatusSelect name="status" value={f.status} options={Object.entries(ORDER_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
        <StatusSelect name="pay" label="Payment" value={f.pay} options={Object.entries(ORDER_PAYMENT_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
        <StatusSelect name="method" label="Method" value={f.method} options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
        {kitchens.length > 1 && <StatusSelect name="kitchen" label="Kitchen" value={f.kitchen} options={kitchens.map((k) => ({ value: k.id, label: k.name }))} />}
        <StatusSelect name="zone" label="Zone" value={f.zone} options={zones.map((z) => ({ value: z.id, label: z.name }))} />
        <StatusSelect name="slot" label="Slot" value={f.slot} options={slots.map((s) => ({ value: s.id, label: s.label }))} />
        <StatusSelect
          name="source"
          label="Source"
          value={f.source}
          options={[
            { value: "SINGLE", label: "Single" },
            { value: "SUBSCRIPTION", label: "Plan" },
            { value: "CORPORATE", label: "Corporate" },
            { value: "ADMIN", label: "Staff" },
          ]}
        />
        <StatusSelect name="company" label="Company" value={f.company} options={companies.map((c) => ({ value: c.id, label: c.name }))} />
      </FilterForm>
      <p className="mb-2 text-sm text-ink-mute">
        {total} orders · {meals} meals on this page · {formatDay(f.from)} – {formatDay(f.to)}
      </p>

      {canBulk && (
        <ActionForm action={bulkStatusAction} id="bulk-status">
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
            <input name="reason" placeholder="Reason (audited)" className="field w-56" aria-label="Reason" />
            <SubmitButton size="sm" variant="dark" confirm="Change the status of every ticked order?">
              Apply
            </SubmitButton>
            <span className="text-xs text-ink-mute">Invalid moves are skipped and listed.</span>
          </div>
        </ActionForm>
      )}
      <DataTable basePath={BASE} params={params} state={state} total={total} rows={orders} rowKey={(o) => o.id} columns={columns} caption="Orders" minWidth={900} empty="No orders match these filters." />
    </div>
  );
}
