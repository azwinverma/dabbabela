import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDay, formatStamp, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { DIET_LABEL, METHOD_LABEL, ORDER_PAYMENT_STATUS, ORDER_STATUS, PAYMENT_STATUS, REFUND_STATUS, ADDRESS_TYPE_LABEL } from "@/lib/labels";
import { TRANSITIONS } from "@/server/transitions";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { PageHeader, Panel, KV, OrderBadge } from "@/components/admin/ui";
import { Timeline, type TimelineItem } from "@/components/admin/Timeline";
import { piiFor, inScope, kitchensFor } from "@/components/admin/ops/scope";
import { ReasonForm } from "@/components/admin/ops/ReasonForm";
import { orderAuditTrail, orderEditOptions } from "@/server/orders-admin";
import { adjustAction, cancelAction, changeStatusAction, editLinesAction, reassignDeliveryAction, reassignKitchenAction, refundAction, substituteAction } from "../actions";

export const metadata = { title: "Order" };

type Comp = { menuItemId: string; name: string; qty: number; diet?: string; allergens?: string[]; station?: string | null; substitutedFrom?: string };

const CHARGE_METHODS = [
  ["CASH", "Collect cash at hand-off"],
  ["BANK_TRANSFER", "Bank transfer"],
  ["WALLET", "Customer wallet credit"],
] as const;
const DELIVERY_EDITABLE = ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "FAILED_DELIVERY"];

function ChargeMethod() {
  return (
    <select name="chargeMethod" className="field" defaultValue="CASH" aria-label="How an extra charge is collected">
      {CHARGE_METHODS.map(([v, l]) => (
        <option key={v} value={v}>
          Extra charge: {l}
        </option>
      ))}
    </select>
  );
}

function Reason() {
  return <input name="reason" required minLength={3} placeholder="Reason (goes in the audit log)" className="field" aria-label="Reason" />;
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("orders.view");
  const { id } = await params;
  const o = await db.order.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      placedBy: { select: { name: true } },
      kitchen: { select: { name: true } },
      zone: { select: { name: true } },
      company: { select: { id: true, name: true } },
      subscription: { select: { id: true, reference: true } },
      invoice: { select: { id: true, number: true } },
      items: { include: { customizations: true } },
      events: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      deliveryEvents: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      adjustments: { orderBy: { createdAt: "asc" } },
      refunds: { orderBy: { createdAt: "desc" } },
      payment: { include: { attempts: { orderBy: { createdAt: "desc" } }, orders: { select: { id: true, number: true } } } },
      ticket: true,
      packing: { orderBy: { createdAt: "desc" }, take: 3 },
      assignment: { include: { route: { include: { rider: { select: { name: true } } } } } },
      feedback: true,
    },
  });
  if (!o || !inScope(user, o.kitchenId)) notFound();
  const pii = piiFor(user);
  const manage = can(user, "orders.edit");
  const next = TRANSITIONS[o.status].filter((s) => s !== "CANCELLED");
  const canCancel = TRANSITIONS[o.status].includes("CANCELLED");
  const refundable = o.paymentStatus === "PAID" || o.paymentStatus === "PARTIALLY_REFUNDED" ? o.customerShare - o.refundedAmount : 0;

  const [trail, opts, kitchens, slots, adjActors] = await Promise.all([
    orderAuditTrail(o),
    manage ? orderEditOptions(o) : Promise.resolve(null),
    manage ? kitchensFor(user) : Promise.resolve([]),
    manage ? db.deliverySlot.findMany({ where: { kitchenId: o.kitchenId, isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } }) : Promise.resolve([]),
    db.user.findMany({ where: { id: { in: o.adjustments.map((a) => a.actorId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
  ]);
  const isCompanyAdj = (reason: string) => reason.startsWith("Company share");
  const adjNet = o.adjustments.filter((a) => !isCompanyAdj(a.reason)).reduce((a, x) => a + x.amount, 0);
  const coAdjNet = o.adjustments.filter((a) => isCompanyAdj(a.reason)).reduce((a, x) => a + x.amount, 0);
  const canEdit = Boolean(manage && opts?.window.open);
  const auditHref = can(user, "audit.view") ? `/admin/audit?entityId=${o.id}` : undefined;

  const timeline: TimelineItem[] = [
    ...o.events.map((e) => ({
      id: `s-${e.id}`,
      at: e.createdAt,
      title: `${e.fromStatus ? `${ORDER_STATUS[e.fromStatus].label} → ` : ""}${ORDER_STATUS[e.toStatus].label}`,
      actor: e.actor?.name,
      body: e.note,
      tone: ORDER_STATUS[e.toStatus].tone,
    })),
    ...o.deliveryEvents.map((e) => ({
      id: `d-${e.id}`,
      at: e.createdAt,
      title: `Delivery: ${e.type.replace(/_/g, " ").toLowerCase()}${e.amount ? ` ${rs(e.amount)}` : ""}${e.otpOk === false ? " (wrong code)" : e.otpOk ? " (code ok)" : ""}`,
      actor: e.actor?.name,
      body: (
        <>
          {e.note}
          {e.photoUrl && (
            <a href={e.photoUrl} target="_blank" rel="noreferrer" className="ml-1 text-xs font-semibold text-akash underline">
              Proof photo
            </a>
          )}
        </>
      ),
      tone: "info" as const,
    })),
    ...o.adjustments.map((a) => ({
      id: `a-${a.id}`,
      at: a.createdAt,
      title: `Adjustment ${rs(a.amount)}`,
      actor: adjActors.find((x) => x.id === a.actorId)?.name,
      body: a.reason,
      tone: a.amount < 0 ? ("good" as const) : ("warn" as const),
    })),
    ...trail.map((l) => ({
      id: `l-${l.id}`,
      at: l.createdAt,
      title: <span className="font-mono text-xs">{l.action}</span>,
      actor: l.actor?.name ?? "System",
      body: [l.summary, l.reason ? `Reason: ${l.reason}` : null].filter(Boolean).join(" — "),
      tone: "neutral" as const,
      href: auditHref,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div>
      <PageHeader
        back={{ href: "/admin/orders", label: "Orders" }}
        title={`Order ${o.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <OrderBadge status={o.status} />
            <Badge tone={ORDER_PAYMENT_STATUS[o.paymentStatus].tone}>{ORDER_PAYMENT_STATUS[o.paymentStatus].label}</Badge>
            <span>
              {formatDay(isoDate(o.deliveryDate), "full")} · {o.slotLabel ?? "any slot"} · {o.kitchen.name} · code <b className="font-mono">#{o.code}</b>
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {can(user, "kitchen.view") && (
              <Link href={`/admin/kitchen/labels?order=${o.id}`} className={buttonClass("outline", "sm")}>
                Print label
              </Link>
            )}
            <Link href={`/admin/orders/${o.id}/receipt`} className={buttonClass("outline", "sm")}>
              Staff receipt
            </Link>
            {o.invoice && can(user, "invoices.view") && (
              <Link href={`/admin/invoices/${o.invoice.id}`} className={buttonClass("outline", "sm")}>
                Invoice {o.invoice.number}
              </Link>
            )}
          </div>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Panel title="Dabbas">
            <ul className="divide-y divide-ink-line/50">
              {o.items.map((it) => (
                <li key={it.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {it.quantity}× {it.name} <Badge tone={DIET_LABEL[it.diet].veg ? "good" : "warn"}>{DIET_LABEL[it.diet].short}</Badge>
                      </p>
                      {it.details && <p className="text-xs text-ink-mute">{it.details}</p>}
                    </div>
                    <span className="tabular-nums">{rs(it.lineTotal)}</span>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {(Array.isArray(it.components) ? (it.components as Comp[]) : []).map((c, i) => (
                      <li key={i} className="rounded-md bg-paper px-2 py-1 text-xs">
                        {c.qty > 1 ? `${c.qty}× ` : ""}
                        {c.name}
                        {c.substitutedFrom && <span className="text-ink-mute"> (swapped from {c.substitutedFrom})</span>}
                        {!!c.allergens?.length && <span className="ml-1 font-semibold text-sindoor">{c.allergens.join(", ").toLowerCase()}</span>}
                      </li>
                    ))}
                  </ul>
                  {it.customizations.map((c) => (
                    <p key={c.id} className="mt-1 text-xs text-ink-mute">
                      {c.kind.toLowerCase()}: {c.label} {c.priceDelta ? `(${c.priceDelta > 0 ? "+" : ""}${rs(c.priceDelta)})` : ""}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            {o.allergenNote && <p className="mt-3 rounded-lg border border-sindoor/30 bg-sindoor-light px-3 py-2 text-sm font-semibold text-sindoor-dark">⚠ Customer allergy note: {o.allergenNote}</p>}
            {o.notes && (
              <p className="mt-2 text-sm">
                <b>Customer note:</b> {o.notes}
              </p>
            )}
            <p className="mt-2 text-xs text-ink-mute">Contents are a snapshot from when the order was placed (or last edited by staff — see the timeline); later recipe changes don&apos;t alter it.</p>
          </Panel>

          <Panel title="Timeline & audit">
            <Timeline items={timeline} />
          </Panel>

          {o.payment && (
            <Panel title={`Payment ${o.payment.reference}`}>
              <KV
                items={[
                  ["Method", METHOD_LABEL[o.payment.method]],
                  ["Status", <Badge key="s" tone={PAYMENT_STATUS[o.payment.status].tone}>{PAYMENT_STATUS[o.payment.status].label}</Badge>],
                  ["Amount", `${rs(o.payment.amount)}${o.payment.refundedAmount ? ` (refunded ${rs(o.payment.refundedAmount)})` : ""}`],
                  ["Covers", o.payment.orders.map((x) => x.number).join(", ")],
                  ["Paid at", o.payment.paidAt ? formatStamp(o.payment.paidAt) : "—"],
                ]}
              />
              {!!o.payment.attempts.length && (
                <div className="mt-3">
                  <p className="label">Attempts</p>
                  <ul className="space-y-1 text-xs">
                    {o.payment.attempts.map((a) => (
                      <li key={a.id} className="flex justify-between gap-2 rounded bg-paper px-2 py-1">
                        <span className="font-mono">{a.providerRef}</span>
                        <span>
                          {a.method} · {a.status} · {rs(a.amount)} · {formatStamp(a.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!o.refunds.length && (
                <div className="mt-3">
                  <p className="label">Refunds</p>
                  <ul className="space-y-1 text-xs">
                    {o.refunds.map((r) => (
                      <li key={r.id} className="flex justify-between gap-2 rounded bg-paper px-2 py-1">
                        <span>
                          {rs(r.amount)} · {r.method.replace("_", " ").toLowerCase()} — {r.reason}
                        </span>
                        <Badge tone={REFUND_STATUS[r.status].tone}>{REFUND_STATUS[r.status].label}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <Panel title="Customer & drop-off">
            <KV
              items={[
                ["Customer", can(user, "customers.view") ? <Link key="c" href={`/admin/customers/${o.user.id}`} className="text-akash underline">{o.user.name}</Link> : o.user.name],
                ["Email", pii.email(o.user.email)],
                ["Receiver", o.contactName],
                ["Phone", pii.phone(o.contactPhone)],
                ["Drop", `${ADDRESS_TYPE_LABEL[o.addressType]}${o.placeName ? ` · ${o.placeName}` : ""}`],
                ["Address", [o.addressLine, o.area, o.ward ? `ward ${o.ward}` : null].filter(Boolean).join(", ")],
                ["Landmark", o.landmark],
                ["Instructions", o.instructions],
                ["Zone", o.zone?.name],
                ["Company", o.company?.name],
                ["Plan", o.subscription ? <Link key="p" href={`/admin/subscriptions/${o.subscription.id}`} className="text-akash underline">{o.subscription.reference}</Link> : null],
                ["Placed by", o.placedBy?.name],
                ["Route", o.assignment ? `${o.assignment.route.name} (#${o.assignment.sequence})${o.assignment.route.rider ? ` · ${o.assignment.route.rider.name}` : ""}` : null],
                ["Hand-off code", manage ? <span key="otp" className="font-mono">{o.deliveryOtp}</span> : "hidden"],
              ]}
            />
          </Panel>

          <Panel title="Money">
            <KV
              items={[
                ["Subtotal", rs(o.subtotal)],
                ["Delivery", rs(o.deliveryFee)],
                ["Discount", o.discount ? `−${rs(o.discount)}${o.couponCode ? ` (${o.couponCode})` : ""}` : "—"],
                [o.taxInclusive ? "VAT (incl.)" : "VAT", rs(o.tax)],
                ["Total", <b key="t">{rs(o.total)}</b>],
                ["Company pays", rs(o.companyShare)],
                ["Customer pays", rs(o.customerShare)],
                ["Refunded", o.refundedAmount ? rs(o.refundedAmount) : "—"],
                ["Food cost", can(user, "analytics.view") ? rs(o.costTotal) : "—"],
                ["Packaging", can(user, "analytics.view") ? rs(o.packagingCost) : "—"],
              ]}
            />
            {!!o.adjustments.length && (
              <>
                <ul className="mt-3 space-y-1 text-xs">
                  {o.adjustments.map((a) => (
                    <li key={a.id} className="rounded bg-paper px-2 py-1">
                      {rs(a.amount)} — {a.reason}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-mute">
                  Net after adjustments: customer {rs(o.customerShare + adjNet)}
                  {o.companyShare || coAdjNet ? ` · company ${rs(o.companyShare + coAdjNet)}` : ""}. The amounts above stay as originally placed.
                </p>
              </>
            )}
          </Panel>

          {manage && opts && (
            <Panel title="Edit dabbas">
              {canEdit ? (
                <ActionForm action={editLinesAction.bind(null, o.id)} className="space-y-2">
                  <input type="hidden" name="version" value={o.version} />
                  {o.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between gap-2 text-sm">
                      <label htmlFor={`q-${it.id}`}>{it.name}</label>
                      <input id={`q-${it.id}`} type="number" name={`qty:${it.id}`} min={0} max={25} defaultValue={it.quantity} className="field w-20" />
                    </div>
                  ))}
                  {opts.menu.length > 0 && (
                    <div className="flex gap-2">
                      <select name="addBox" className="field" defaultValue="" aria-label="Add a dabba">
                        <option value="">Add a dabba…</option>
                        {opts.menu.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({rs(m.price)})
                          </option>
                        ))}
                      </select>
                      <input type="number" name="addQty" min={1} max={25} defaultValue={1} className="field w-20" aria-label="Quantity to add" />
                    </div>
                  )}
                  <ChargeMethod />
                  <Reason />
                  <SubmitButton size="sm" variant="dark" confirm="Re-price and save these dabbas?">
                    Save &amp; re-price
                  </SubmitButton>
                  <p className="text-xs text-ink-mute">
                    Quantity 0 removes a dabba. Changes close at {opts.window.cutoff}. The price difference is recorded as an adjustment: a credit goes to the wallet when already paid, a charge becomes a new payment.
                  </p>
                </ActionForm>
              ) : (
                <p className="text-sm text-ink-mute">{opts.window.reason}</p>
              )}
            </Panel>
          )}

          {canEdit && opts && opts.substitutions.length > 0 && (
            <Panel title="Substitution">
              <ActionForm action={substituteAction.bind(null, o.id)} className="space-y-2">
                <input type="hidden" name="version" value={o.version} />
                <select name="pick" className="field" defaultValue="" aria-label="Approved substitution" required>
                  <option value="">Pick an approved swap…</option>
                  {o.items.flatMap((it) =>
                    opts.substitutions
                      .filter((s) => s.boxId === it.boxId)
                      .map((s) => (
                        <option key={`${it.id}|${s.id}`} value={`${it.id}|${s.id}`}>
                          {it.name}: {s.label}
                          {s.priceDelta ? ` (${s.priceDelta > 0 ? "+" : ""}${rs(s.priceDelta)})` : ""}
                        </option>
                      )),
                  )}
                </select>
                <ChargeMethod />
                <Reason />
                <SubmitButton size="sm" variant="outline">
                  Apply substitution
                </SubmitButton>
              </ActionForm>
            </Panel>
          )}

          {canEdit && kitchens.length > 1 && (
            <Panel title="Move to another kitchen">
              <ActionForm action={reassignKitchenAction.bind(null, o.id)} className="space-y-2">
                <input type="hidden" name="version" value={o.version} />
                <select name="kitchenId" className="field" defaultValue="" aria-label="New kitchen" required>
                  <option value="">Pick a kitchen…</option>
                  {kitchens
                    .filter((k) => k.id !== o.kitchenId)
                    .map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                </select>
                <Reason />
                <SubmitButton size="sm" variant="outline" confirm="Move this order to the other kitchen?">
                  Move order
                </SubmitButton>
                <p className="text-xs text-ink-mute">Checked against that kitchen&apos;s capacity and menu. The delivery window is cleared — pick one of the new kitchen&apos;s below.</p>
              </ActionForm>
            </Panel>
          )}

          {manage && DELIVERY_EDITABLE.includes(o.status) && (
            <Panel title="Delivery window & address">
              <ActionForm action={reassignDeliveryAction.bind(null, o.id)} className="space-y-2">
                <input type="hidden" name="version" value={o.version} />
                <select name="slotId" className="field" defaultValue="keep" aria-label="Delivery window">
                  <option value="keep">Window: keep {o.slotLabel ?? "any"}</option>
                  <option value="">Any window</option>
                  {slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <select name="addressId" className="field" defaultValue="" aria-label="Delivery address">
                  <option value="">Address: keep current</option>
                  {(opts?.addresses ?? [])
                    .filter((a) => a.sameKitchen)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                </select>
                <Reason />
                <SubmitButton size="sm" variant="outline">
                  Update delivery
                </SubmitButton>
                <p className="text-xs text-ink-mute">Rider and route changes are made in Dispatch. The delivery fee isn&apos;t re-priced.</p>
              </ActionForm>
            </Panel>
          )}

          {manage && (
            <Panel title="Change status">
              {next.length ? (
                <ActionForm action={changeStatusAction.bind(null, o.id)} className="space-y-2">
                  <select name="status" className="field" defaultValue={next[0]} aria-label="Next status">
                    {next.map((s) => (
                      <option key={s} value={s}>
                        {ORDER_STATUS[s].label}
                      </option>
                    ))}
                  </select>
                  <input name="note" placeholder="Note (required for failed delivery)" className="field" aria-label="Note" />
                  <SubmitButton size="sm" variant="dark">
                    Update
                  </SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-sm text-ink-mute">This order is final.</p>
              )}
            </Panel>
          )}

          {manage && canCancel && (
            <Panel title="Cancel order">
              <ReasonForm action={cancelAction.bind(null, o.id)} label="Cancel order" variant="danger" confirm={`Cancel ${o.number}?`}>
                <select name="settlement" className="field" defaultValue="CREDIT" aria-label="Money back">
                  <option value="CREDIT">Paid amount → wallet credit</option>
                  <option value="REFUND">Paid amount → refund request (finance)</option>
                  <option value="NONE">No money back</option>
                </select>
              </ReasonForm>
            </Panel>
          )}

          {manage && (
            <Panel title="Adjustment">
              <p className="mb-2 text-xs text-ink-mute">Negative = credit to the customer&apos;s wallet (e.g. −50). Positive = extra charge recorded. The order total itself is never edited.</p>
              <ReasonForm action={adjustAction.bind(null, o.id)} label="Record adjustment">
                <input name="amount" inputMode="decimal" placeholder="Amount in Rs, e.g. -50" className="field" required />
              </ReasonForm>
            </Panel>
          )}

          {can(user, "refunds.create") && refundable > 0 && (
            <Panel title="Request refund">
              <p className="mb-2 text-xs text-ink-mute">Up to {rs(refundable)}. Finance approves and processes with proof.</p>
              <ReasonForm action={refundAction.bind(null, o.id)} label="Request refund">
                <input name="amount" inputMode="decimal" placeholder="Amount in Rs" className="field" required />
                <select name="method" className="field" defaultValue="WALLET_CREDIT" aria-label="Refund method">
                  <option value="WALLET_CREDIT">Wallet credit</option>
                  <option value="ORIGINAL">Back to eSewa/Khalti</option>
                  <option value="BANK">Bank transfer</option>
                  <option value="CASH">Cash</option>
                </select>
              </ReasonForm>
            </Panel>
          )}

          <Panel title="Kitchen">
            <KV
              items={[
                ["Ticket", o.ticket?.printedAt ? `printed ${formatStamp(o.ticket.printedAt)}${o.ticket.reprintCount ? ` · ${o.ticket.reprintCount} reprint(s)` : ""}` : "not printed"],
                ["Packing", o.packing[0] ? `${o.packing[0].itemsOk && o.packing[0].labelOk && o.packing[0].allergenOk && o.packing[0].sealedOk ? "passed" : "issue"} · ${formatStamp(o.packing[0].createdAt)}` : "not checked"],
                ["Feedback", o.feedback ? `${o.feedback.rating}/5${o.feedback.comment ? ` — ${o.feedback.comment}` : ""}` : "—"],
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
