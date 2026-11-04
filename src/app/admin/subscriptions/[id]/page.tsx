import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatDay, formatStamp, isoDate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { METHOD_LABEL, PAYMENT_STATUS } from "@/lib/labels";
import { PageHeader, Panel, KV, SubBadge, OrderBadge } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { ReasonForm } from "@/components/admin/ops/ReasonForm";
import { piiFor } from "@/components/admin/ops/scope";
import { cancelPlanAction, pauseAction, resumeAction, staffSkipAction, staffUnskipAction } from "../actions";

export const metadata = { title: "Meal plan" };

export default async function SubPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("subscriptions.view");
  const { id } = await params;
  const s = await db.subscription.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, phoneNumber: true } },
      plan: true,
      address: true,
      slot: { select: { label: true } },
      orders: { include: { items: { select: { name: true } } }, orderBy: { deliveryDate: "asc" } },
      payments: true,
      changes: { orderBy: { createdAt: "desc" } },
      pauses: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!s) notFound();
  const pii = piiFor(user);
  const today = todayKTM();
  const delivered = s.orders.filter((o) => o.status === "DELIVERED").length;
  const live = s.orders.filter((o) => !["CANCELLED", "SKIPPED"].includes(o.status)).length;
  const open = s.status === "ACTIVE" || s.status === "PAUSED" || s.status === "PENDING_PAYMENT";
  return (
    <div>
      <PageHeader back={{ href: "/admin/subscriptions", label: "Meal plans" }} title={`${s.reference} · ${s.plan.name}`} description={<span className="flex items-center gap-2"><SubBadge status={s.status} /> {formatDay(isoDate(s.startDate))} → {formatDay(isoDate(s.endDate))} · {delivered}/{s.mealsTotal} delivered</span>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Panel title={`Meals (${live} live of ${s.orders.length})`}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {s.orders.map((o) => {
                const d = isoDate(o.deliveryDate);
                return (
                  <li key={o.id} className={`rounded-lg border p-2.5 text-sm ${o.status === "SKIPPED" || o.status === "CANCELLED" ? "border-dashed border-ink-line opacity-70" : "border-ink-line"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/admin/orders/${o.id}`} className="font-semibold hover:text-sindoor">{formatDay(d)}</Link>
                      <OrderBadge status={o.status} />
                    </div>
                    <p className="text-xs text-ink-mute">{o.items.map((i) => i.name).join(", ")}{o.followsRotation ? " · chef's pick" : ""}</p>
                    {open && o.status === "SCHEDULED" && d >= today && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-semibold text-akash">Skip for customer</summary>
                        <div className="mt-2"><ReasonForm action={staffSkipAction.bind(null, s.id, o.id)} label="Skip meal" placeholder="Why (e.g. customer called)" /></div>
                      </details>
                    )}
                    {o.status === "SKIPPED" && d >= today && o.paymentStatus !== "REFUNDED" && <div className="mt-1"><ConfirmAction action={staffUnskipAction.bind(null, s.id, o.id)} label="Undo skip" variant="ghost" className="h-7 px-2 text-xs" /></div>}
                  </li>
                );
              })}
            </ul>
          </Panel>
          <Panel title="History">
            <ul className="space-y-2 text-sm">
              {s.changes.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 border-b border-ink-line/40 pb-2 last:border-0">
                  <span><b>{c.type.toLowerCase()}</b>{c.date ? ` · ${formatDay(isoDate(c.date))}` : ""}{c.detail ? ` — ${c.detail}` : ""}{c.amount ? ` (${rs(c.amount)})` : ""}</span>
                  <span className="shrink-0 text-xs text-ink-mute">{formatStamp(c.createdAt)}</span>
                </li>
              ))}
              {!s.changes.length && <li className="text-ink-mute">No changes yet.</li>}
            </ul>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Plan">
            <KV
              items={[
                ["Customer", <Link key="c" href={`/admin/customers/${s.user.id}`} className="text-akash underline">{s.user.name}</Link>],
                ["Phone", pii.phone(s.user.phoneNumber)],
                ["Days", s.days.join(", ")],
                ["Choice", s.boxChoice === "ROTATION" ? "Chef's rotation" : "Picked per day"],
                ["Veg only", s.vegOnly ? "Yes" : "No"],
                ["Address", s.address ? `${s.address.label} · ${s.address.area}` : "—"],
                ["Slot", s.slot?.label],
                ["Per meal", rs(s.pricePerMeal)],
                ["Total", `${rs(s.total)}${s.discount ? ` (−${rs(s.discount)})` : ""}`],
                ["Renewal", s.renewal.toLowerCase()],
                ["Cancel reason", s.cancelReason],
              ]}
            />
            {s.payments.map((p) => (
              <p key={p.id} className="mt-2 flex items-center justify-between rounded bg-paper px-2 py-1 text-xs">
                <span>{p.reference} · {METHOD_LABEL[p.method]} · {rs(p.amount)}</span>
                <Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge>
              </p>
            ))}
          </Panel>
          {s.status === "ACTIVE" && (
            <Panel title="Pause">
              <p className="mb-2 text-xs text-ink-mute">Meals from the date below are held (skipped, not credited) and re-added after the plan's end when resumed.</p>
              <ReasonForm action={pauseAction.bind(null, s.id)} label="Pause plan">
                <input type="date" name="from" min={today} className="field" aria-label="Pause from" />
              </ReasonForm>
            </Panel>
          )}
          {s.status === "PAUSED" && (
            <Panel title="Resume">
              {s.pauses[0] && <p className="mb-2 text-xs text-ink-mute">Paused from {formatDay(isoDate(s.pauses[0].fromDate))}{s.pauses[0].reason ? ` — ${s.pauses[0].reason}` : ""}</p>}
              <ConfirmAction action={resumeAction.bind(null, s.id)} label="Resume plan" variant="primary" />
            </Panel>
          )}
          {open && (
            <Panel title="Cancel plan">
              <p className="mb-2 text-xs text-ink-mute">Meals still before their cut-off are cancelled; their paid value goes back. Locked meals still go out.</p>
              <ReasonForm action={cancelPlanAction.bind(null, s.id)} label="Cancel plan" variant="danger" confirm="Cancel this plan?">
                <select name="settlement" className="field" defaultValue="CREDIT" aria-label="Money back"><option value="CREDIT">Wallet credit</option><option value="REFUND">Refund request (finance)</option></select>
              </ReasonForm>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
