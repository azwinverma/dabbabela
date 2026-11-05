import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDay, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { SUB_STATUS } from "@/lib/labels";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { cancelPolicyFor } from "@/server/subscriptions";
import { PlanActions } from "./PlanActions";

export default async function PlansPage() {
  const user = await requireUser("/account/plans");
  const subs = await db.subscription.findMany({
    where: { userId: user.id },
    include: {
      plan: { select: { name: true, slug: true, isActive: true, cancelPolicy: true } },
      renewedFrom: { select: { id: true, reference: true } },
      renewals: { where: { status: { not: "CANCELLED" } }, select: { id: true, reference: true } },
      address: { select: { label: true, area: true } },
      payments: { where: { status: { in: ["PENDING", "FAILED"] } }, select: { id: true } },
      _count: { select: { orders: { where: { status: "DELIVERED" } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  const addresses = user.addresses.map((a) => ({ id: a.id, label: `${a.label} — ${a.area}`, covered: Boolean(a.zoneId) }));
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-extrabold">Meal plans</h2>
        <LinkButton href="/plans" size="sm" variant="outline">Start a new plan</LinkButton>
      </div>
      {subs.length === 0 ? (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-ink-line p-8 text-center">
          <p className="text-ink-soft">No plans yet. A weekly or monthly plan is the cheapest way to eat with us.</p>
          <LinkButton href="/plans" className="mt-4">Compare plans</LinkButton>
        </div>
      ) : (
        <ul className="mt-5 space-y-4">
          {subs.map((s) => {
            const done = s._count.orders;
            const pct = Math.min(100, Math.round((done / Math.max(1, s.mealsTotal)) * 100));
            return (
              <li key={s.id} className="rounded-2xl border-2 border-ink bg-paper-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/account/plans/${s.id}`} className="text-lg font-extrabold hover:underline">{s.plan.name}</Link>
                    <p className="text-sm text-ink-soft">
                      {formatDay(isoDate(s.startDate))} → {formatDay(isoDate(s.endDate))} · {s.days.join(", ")}
                      {s.vegOnly ? " · veg only" : ""} · {s.boxChoice === "CUSTOM" ? "your picks" : "chef's rotation"}
                    </p>
                    <p className="text-xs text-ink-mute">
                      {s.reference} · {rs(s.total)} · to {s.address ? `${s.address.label} (${s.address.area})` : "—"}
                    </p>
                    {(s.renewedFrom || s.renewals[0]) && (
                      <p className="text-xs text-ink-mute">
                        {s.renewedFrom && <>Renewal of <Link href={`/account/plans/${s.renewedFrom.id}`} className="underline">{s.renewedFrom.reference}</Link>. </>}
                        {s.renewals[0] && <>Renewed as <Link href={`/account/plans/${s.renewals[0].id}`} className="underline">{s.renewals[0].reference}</Link>.</>}
                      </p>
                    )}
                  </div>
                  <Badge tone={SUB_STATUS[s.status].tone}>{SUB_STATUS[s.status].label}</Badge>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={s.mealsTotal} aria-label="Lunches delivered">
                  <div className="h-full bg-saag" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-ink-mute">{done} of {s.mealsTotal} lunches delivered</p>
                {s.payments[0] && s.status === "PENDING_PAYMENT" && (
                  <LinkButton href={`/pay/${s.payments[0].id}`} size="sm" className="mt-3">Finish payment</LinkButton>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <LinkButton href={`/account/plans/${s.id}`} size="sm" variant="outline">History, swaps &amp; extra meals</LinkButton>
                  {!s.renewals[0] && s.plan.isActive && ["ACTIVE", "PAUSED", "COMPLETED"].includes(s.status) && (
                    <LinkButton href={`/account/plans/${s.id}#renew`} size="sm">Renew</LinkButton>
                  )}
                </div>
                <div className="mt-4">
                  <PlanActions id={s.id} status={s.status} addresses={addresses} currentAddressId={s.addressId} cancelPolicy={cancelPolicyFor(s.plan)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
