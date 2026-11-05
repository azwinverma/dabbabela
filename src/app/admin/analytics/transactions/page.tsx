import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { rs } from "@/lib/money";
import { formatDay, formatStamp, isoDate } from "@/lib/dates";
import { METHOD_LABEL } from "@/lib/labels";
import { PageHeader, Table, Th, Td, EmptyRow, OrderBadge, PaymentBadge, SubBadge, Pagination } from "@/components/admin/ui";
import { piiFor } from "@/components/admin/ops/scope";
import { filterParams, parseFilters, qs } from "@/server/analytics/filters";
import { DRILL_BASES, PAGE_SIZE, drill, isDrillBasis, orderValue } from "@/server/analytics/transactions";
import { AnalyticsFilterBar, filterOptions } from "../_components/FilterBar";

export const metadata = { title: "Analytics records" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("analytics.view");
  const sp = await searchParams;
  const basis = isDrillBasis(sp.basis) ? sp.basis : "recognised";
  const f = parseFilters(sp, user);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const [opts, r] = await Promise.all([filterOptions(user), drill(basis, f, { page })]);
  const pii = piiFor(user);
  const def = DRILL_BASES[basis];
  const pages = Math.max(1, Math.ceil(r.count / PAGE_SIZE));
  const extra = [f.categoryId && "category", f.channel && "channel", f.method && `method ${METHOD_LABEL[f.method]}`].filter(Boolean);
  const canOrders = can(user, "orders.view");

  return (
    <div>
      <PageHeader
        title={def.label}
        back={{ href: `/admin/analytics?${qs({ ...f, categoryId: undefined, channel: undefined, method: undefined })}`, label: "Analytics" }}
        description={
          <>
            {formatDay(f.from, "long")} → {formatDay(f.to, "long")} · <strong className="tabular-nums">{r.count}</strong> records · {def.valueLabel}: <strong className="tabular-nums">{rs(r.sum)}</strong>
            {extra.length ? ` · drilled by ${extra.join(", ")}` : ""}
          </>
        }
        actions={
          can(user, "analytics.export") ? (
            <a className="text-sm font-semibold text-sindoor underline" href={`/admin/analytics/export?${qs(f, { basis })}`}>
              Export CSV
            </a>
          ) : null
        }
      />
      <AnalyticsFilterBar f={f} opts={opts} action="/admin/analytics/transactions" hidden={{ basis }} />

      {r.kind === "orders" && (
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Delivery</Th>
              <Th>Status</Th>
              <Th>Customer</Th>
              <Th>Kitchen · zone</Th>
              <Th>Company / plan</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">VAT</Th>
              <Th className="text-right">Refunded</Th>
              <Th className="text-right">Counts as</Th>
            </tr>
          </thead>
          <tbody>
            {r.rows.length ? (
              r.rows.map((o) => (
                <tr key={o.id} className="border-t border-ink-line/50">
                  <Td>{canOrders ? <Link className="font-semibold text-sindoor hover:underline" href={`/admin/orders/${o.id}`}>{o.number}</Link> : o.number}</Td>
                  <Td>
                    {formatDay(isoDate(o.deliveryDate))}
                    <span className="block text-[11px] text-ink-mute">placed {formatStamp(o.createdAt)}</span>
                  </Td>
                  <Td>
                    <OrderBadge status={o.status} />
                    <span className="block text-[11px] text-ink-mute">{o.paymentStatus}</span>
                  </Td>
                  <Td>
                    {o.user.name}
                    <span className="block text-[11px] text-ink-mute">{pii.phone(o.contactPhone)}</span>
                  </Td>
                  <Td>
                    {o.kitchen.name}
                    <span className="block text-[11px] text-ink-mute">{o.zone?.name ?? "—"}</span>
                  </Td>
                  <Td>
                    {o.company?.name ?? "Individual"}
                    <span className="block text-[11px] text-ink-mute">{o.subscription ? `${o.subscription.plan.name} · ${o.subscription.reference}` : "single order"}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{rs(o.total)}</Td>
                  <Td className="text-right tabular-nums">{rs(o.tax)}</Td>
                  <Td className="text-right tabular-nums">{o.refundedAmount ? rs(o.refundedAmount) : "—"}</Td>
                  <Td className="text-right font-semibold tabular-nums">{rs(orderValue(basis, o))}</Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={10}>No records match these filters.</EmptyRow>
            )}
          </tbody>
        </Table>
      )}

      {r.kind === "plans" && (
        <Table>
          <thead>
            <tr>
              <Th>Plan</Th>
              <Th>Customer</Th>
              <Th>Status</Th>
              <Th>Bought</Th>
              <Th>Runs</Th>
              <Th className="text-right">Meals</Th>
              <Th className="text-right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {r.rows.length ? (
              r.rows.map((s) => (
                <tr key={s.id} className="border-t border-ink-line/50">
                  <Td>
                    {can(user, "subscriptions.view") ? <Link className="font-semibold text-sindoor hover:underline" href={`/admin/subscriptions/${s.id}`}>{s.reference}</Link> : s.reference}
                    <span className="block text-[11px] text-ink-mute">{s.plan.name}</span>
                  </Td>
                  <Td>
                    {s.user.name}
                    <span className="block text-[11px] text-ink-mute">{pii.email(s.user.email)}</span>
                  </Td>
                  <Td>
                    <SubBadge status={s.status} />
                    {s.cancelReason && <span className="block text-[11px] text-ink-mute">{s.cancelReason}</span>}
                  </Td>
                  <Td>{formatStamp(s.createdAt)}</Td>
                  <Td>
                    {formatDay(isoDate(s.startDate))} → {formatDay(isoDate(s.endDate))}
                  </Td>
                  <Td className="text-right tabular-nums">{s.mealsTotal}</Td>
                  <Td className="text-right font-semibold tabular-nums">{rs(s.total)}</Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={7}>No records match these filters.</EmptyRow>
            )}
          </tbody>
        </Table>
      )}

      {r.kind === "payments" && (
        <Table>
          <thead>
            <tr>
              <Th>Payment</Th>
              <Th>Customer</Th>
              <Th>Method · status</Th>
              <Th>Paid at</Th>
              <Th className="text-right">Orders</Th>
              <Th className="text-right">Fee est. / actual</Th>
              <Th className="text-right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {r.rows.length ? (
              r.rows.map((p) => (
                <tr key={p.id} className="border-t border-ink-line/50">
                  <Td className="font-semibold">
                    {p.reference}
                    {p.subscription && <span className="block text-[11px] font-normal text-ink-mute">plan {p.subscription.reference}</span>}
                  </Td>
                  <Td>
                    {p.user.name}
                    <span className="block text-[11px] text-ink-mute">{pii.email(p.user.email)}</span>
                  </Td>
                  <Td>
                    {METHOD_LABEL[p.method]} <PaymentBadge status={p.status} />
                  </Td>
                  <Td>{p.paidAt ? formatStamp(p.paidAt) : "—"}</Td>
                  <Td className="text-right tabular-nums">{p._count.orders}</Td>
                  <Td className="text-right tabular-nums">
                    {rs(p.gatewayFee)} / {p.feeActual == null ? <span className="text-ink-mute">not reconciled</span> : rs(p.feeActual)}
                  </Td>
                  <Td className="text-right font-semibold tabular-nums">{rs(p.amount)}</Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={7}>No records match these filters.</EmptyRow>
            )}
          </tbody>
        </Table>
      )}

      {r.kind === "refunds" && (
        <Table>
          <thead>
            <tr>
              <Th>Payment</Th>
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th>Method</Th>
              <Th>Reason</Th>
              <Th>Processed</Th>
              <Th className="text-right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {r.rows.length ? (
              r.rows.map((x) => (
                <tr key={x.id} className="border-t border-ink-line/50">
                  <Td className="font-semibold">{x.payment.reference}</Td>
                  <Td>{x.order ? (canOrders ? <Link className="text-sindoor hover:underline" href={`/admin/orders/${x.order.id}`}>{x.order.number}</Link> : x.order.number) : "—"}</Td>
                  <Td>
                    {x.payment.user.name}
                    <span className="block text-[11px] text-ink-mute">{pii.email(x.payment.user.email)}</span>
                  </Td>
                  <Td>{x.method}</Td>
                  <Td className="max-w-[16rem] truncate" title={x.reason}>
                    {x.reason}
                  </Td>
                  <Td>{x.processedAt ? formatStamp(x.processedAt) : "—"}</Td>
                  <Td className="text-right font-semibold tabular-nums">{rs(x.amount)}</Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={7}>No records match these filters.</EmptyRow>
            )}
          </tbody>
        </Table>
      )}

      <Pagination page={page} pages={pages} params={filterParams(f, { basis })} basePath="/admin/analytics/transactions" />
    </div>
  );
}
