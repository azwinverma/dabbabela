import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatDay, formatStamp, isoDate } from "@/lib/dates";
import { formatNepalPhone, maskEmail, maskPhone } from "@/lib/phone";
import { ADDRESS_TYPE_LABEL, METHOD_LABEL } from "@/lib/labels";
import { PageHeader, Panel, KV, Table, Th, Td, EmptyRow, OrderBadge, PaymentBadge, SubBadge } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { walletBalance } from "@/server/ledger";
import { AdjustForm } from "../../refunds/RefundForms";
import { ActiveForm, NoteForm, PrivacyRequestForm } from "../CustomerForms";

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("customers");
  const pii = can(staff.role, "customers.pii");
  const { id } = await params;
  const c = await db.user.findUnique({
    where: { id },
    include: {
      addresses: { orderBy: [{ archivedAt: "asc" }, { isDefault: "desc" }], include: { zone: { select: { name: true } } } },
      membership: { include: { company: { select: { id: true, name: true } } } },
      orders: { orderBy: { deliveryDate: "desc" }, take: 25, include: { items: { select: { name: true, quantity: true } } } },
      subscriptions: { orderBy: { createdAt: "desc" }, include: { plan: { select: { name: true } } } },
      payments: { orderBy: { createdAt: "desc" }, take: 15 },
      credits: { orderBy: { createdAt: "desc" }, take: 15 },
      tickets: { orderBy: { createdAt: "desc" }, take: 10 },
      dataRequests: { orderBy: { createdAt: "desc" }, take: 5 },
      _count: { select: { orders: true } },
    },
  });
  if (!c || c.role !== "CUSTOMER") notFound();
  const [balance, spent] = await Promise.all([
    walletBalance(c.id),
    db.order.aggregate({ where: { userId: c.id, status: { in: ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED"] } }, _sum: { customerShare: true } }),
  ]);
  const phone = pii ? formatNepalPhone(c.phoneNumber) : maskPhone(c.phoneNumber);

  return (
    <div>
      <PageHeader
        title={c.name}
        back={{ href: "/admin/customers", label: "Customers" }}
        description={c.deletedAt ? "Personal data deleted on request — financial records kept." : `Joined ${formatStamp(c.createdAt)} · last login ${c.lastLoginAt ? formatStamp(c.lastLoginAt) : "never"}`}
        actions={!c.isActive ? <Badge tone="bad">Deactivated</Badge> : null}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Profile & food preferences">
          <KV
            items={[
              ["Email", pii ? c.email : maskEmail(c.email)],
              ["Phone", phone || "—"],
              ["Language", c.locale === "ne" ? "Nepali" : "English"],
              ["Diet", c.diet === "ANY" ? "No restriction" : c.diet === "EGG_OK" ? "Vegetarian + egg" : c.diet.toLowerCase()],
              ["Spice", ["None", "Mild", "Medium", "Hot", "Very hot"][c.spiceTolerance] ?? c.spiceTolerance],
              ["Allergies", c.allergies.length ? <span className="font-semibold text-sindoor">{c.allergies.join(", ")}</span> : "None declared"],
              ["No onion/garlic", c.avoidOnionGarlic ? "Yes" : "No"],
              ["Notes", c.dietaryNotes],
              ["Marketing", c.marketingOptIn ? "Opted in" : "Not opted in"],
              ["Company", c.membership ? <Link className="text-sindoor underline" href={`/admin/companies/${c.membership.company.id}`}>{`${c.membership.company.name} · ${c.membership.role.toLowerCase()} · ${c.membership.status.toLowerCase()}`}</Link> : "—"],
            ]}
          />
        </Panel>
        <Panel title="Money">
          <KV
            items={[
              ["Orders", c._count.orders],
              ["Paid by them (live orders)", rs(spent._sum.customerShare ?? 0)],
              ["Credit balance", <span key="b" className="font-bold">{rs(balance)}</span>],
            ]}
          />
          {can(staff.role, "refunds.approve") && !c.deletedAt && (
            <div className="mt-3 border-t border-ink-line/60 pt-3">
              <AdjustForm userId={c.id} />
            </div>
          )}
          <ul className="mt-3 space-y-1 text-xs">
            {c.credits.map((l) => (
              <li key={l.id} className="flex justify-between gap-2">
                <span className="text-ink-mute">
                  {formatStamp(l.createdAt)} · {l.reason.replace(/_/g, " ").toLowerCase()}
                </span>
                <span className={`tabular-nums ${l.amount < 0 ? "text-sindoor" : "text-saag"}`}>{rs(l.amount)}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Staff actions">
          <div className="space-y-4">
            <NoteForm id={c.id} note={c.internalNote ?? ""} />
            {pii && !c.deletedAt && <ActiveForm id={c.id} active={c.isActive} />}
            {can(staff.role, "privacy") && !c.deletedAt && (
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-mute">Privacy request received by phone/email?</p>
                <PrivacyRequestForm id={c.id} />
              </div>
            )}
            {c.dataRequests.length > 0 && (
              <ul className="text-xs text-ink-mute">
                {c.dataRequests.map((r) => (
                  <li key={r.id}>
                    {r.type} · {r.status.toLowerCase()} · {formatStamp(r.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel title="Addresses" className="lg:col-span-3" bodyClass="p-0">
          <Table className="rounded-none border-0 shadow-none">
            <thead>
              <tr>
                <Th>Label</Th>
                <Th>Type</Th>
                <Th>Address</Th>
                <Th>Zone</Th>
                <Th>Recipient</Th>
              </tr>
            </thead>
            <tbody>
              {c.addresses.map((a) => (
                <tr key={a.id} className={a.archivedAt ? "opacity-50" : ""}>
                  <Td>
                    {a.label} {a.isDefault && <Badge tone="info">default</Badge>}
                  </Td>
                  <Td>{ADDRESS_TYPE_LABEL[a.type]}</Td>
                  <Td className="text-xs">{pii ? [a.placeName, a.line1, a.area, a.ward ? `Ward ${a.ward}` : null, a.landmark].filter(Boolean).join(", ") : `${a.area}${a.ward ? `, ward ${a.ward}` : ""}`}</Td>
                  <Td>{a.zone?.name ?? <Badge tone="bad">not served</Badge>}</Td>
                  <Td className="text-xs">{pii ? `${a.recipientName} · ${formatNepalPhone(a.phone)}` : a.recipientName}</Td>
                </tr>
              ))}
              {!c.addresses.length && <EmptyRow colSpan={5} />}
            </tbody>
          </Table>
        </Panel>

        <Panel title="Recent orders" className="lg:col-span-2" bodyClass="p-0">
          <Table className="rounded-none border-0 shadow-none">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Date</Th>
                <Th>Items</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {c.orders.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link className="font-semibold text-sindoor hover:underline" href={`/admin/orders/${o.id}`}>
                      {o.number}
                    </Link>
                  </Td>
                  <Td className="text-xs">{formatDay(isoDate(o.deliveryDate))}</Td>
                  <Td className="text-xs">{o.items.map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ")}</Td>
                  <Td>
                    <OrderBadge status={o.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{rs(o.total)}</Td>
                </tr>
              ))}
              {!c.orders.length && <EmptyRow colSpan={5} />}
            </tbody>
          </Table>
        </Panel>
        <div className="space-y-4">
          <Panel title="Meal plans">
            {c.subscriptions.length ? (
              <ul className="space-y-2 text-sm">
                {c.subscriptions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <Link className="hover:underline" href={`/admin/subscriptions/${s.id}`}>
                      {s.plan.name} <span className="text-xs text-ink-mute">· {s.reference}</span>
                    </Link>
                    <SubBadge status={s.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-mute">None.</p>
            )}
          </Panel>
          <Panel title="Payments">
            {c.payments.length ? (
              <ul className="space-y-2 text-sm">
                {c.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <Link className="font-mono text-xs hover:underline" href={`/admin/payments/${p.id}`}>
                      {p.reference}
                    </Link>
                    <span className="text-xs">{METHOD_LABEL[p.method]} · {rs(p.amount)}</span>
                    <PaymentBadge status={p.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-mute">None.</p>
            )}
          </Panel>
          <Panel title="Support tickets">
            {c.tickets.length ? (
              <ul className="space-y-1 text-sm">
                {c.tickets.map((t) => (
                  <li key={t.id}>
                    <Link className="hover:underline" href={`/admin/support/${t.id}`}>
                      {t.number} · {t.subject}
                    </Link>{" "}
                    <span className="text-xs text-ink-mute">{t.status.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-mute">None.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
