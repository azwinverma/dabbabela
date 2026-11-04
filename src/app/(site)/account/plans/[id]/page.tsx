import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDay, formatStamp, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { SUB_STATUS } from "@/lib/labels";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { Badge } from "@/components/ui/Badge";
import { OrderRow } from "../../OrderRow";
import { MealActions } from "../../MealActions";
import { changeable } from "../../_lib/meals";
import { PlanActions } from "../PlanActions";

export default async function PlanDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/account/plans/${id}`);
  const sub = await db.subscription.findFirst({
    where: { id, userId: user.id },
    include: {
      plan: true,
      orders: { include: { items: { select: { name: true, quantity: true } } }, orderBy: { deliveryDate: "asc" } },
      changes: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!sub) notFound();
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
  const t = accountDict(locale).account;
  const open = await changeable(sub.orders, settings);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/account/plans" className="text-sm font-semibold text-ink-soft underline">← Plans</Link>
        <h2 className="text-2xl font-extrabold">{sub.plan.name}</h2>
        <Badge tone={SUB_STATUS[sub.status].tone}>{SUB_STATUS[sub.status].label}</Badge>
      </div>
      <p className="text-sm text-ink-soft">
        {sub.reference} · {formatDay(isoDate(sub.startDate))} → {formatDay(isoDate(sub.endDate))} · {sub.mealsTotal} lunches · paid {rs(sub.total)}
      </p>
      {sub.plan.policyNote && <p className="rounded-lg bg-besar-light px-3 py-2 text-sm">{sub.plan.policyNote}</p>}
      <PlanActions id={sub.id} status={sub.status} addresses={user.addresses.map((a) => ({ id: a.id, label: `${a.label} — ${a.area}`, covered: Boolean(a.zoneId) }))} currentAddressId={sub.addressId} />
      <section>
        <h3 className="text-lg font-extrabold">Lunches</h3>
        <ul className="mt-3 space-y-2">
          {sub.orders.map((o) => (
            <OrderRow key={o.id} o={o} actions={open.get(o.id) ? <MealActions orderId={o.id} kind="plan" status={o.status} open credited={o.paymentStatus === "REFUNDED"} labels={t} /> : null} />
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-lg font-extrabold">Changes</h3>
        {sub.changes.length === 0 ? (
          <p className="mt-2 text-sm text-ink-mute">No changes yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {sub.changes.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-3">
                <span className="font-semibold">{c.type.toLowerCase()}</span>
                {c.date && <span>{formatDay(isoDate(c.date))}</span>}
                {c.detail && <span className="text-ink-soft">{c.detail}</span>}
                <span className="text-xs text-ink-mute">{formatStamp(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
