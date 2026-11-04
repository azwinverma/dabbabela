import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateOnly, formatDay, isoDate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { format } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { walletBalance } from "@/server/ledger";
import { LinkButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SUB_STATUS } from "@/lib/labels";
import { OrderRow } from "./OrderRow";
import { MealActions } from "./MealActions";
import { changeable } from "./_lib/meals";

export default async function AccountHome({ searchParams }: { searchParams: Promise<{ welcome?: string; team?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/account");
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
  const t = accountDict(locale);
  const today = todayKTM();
  const [upcoming, plans, credit, pending, notes] = await Promise.all([
    db.order.findMany({
      where: { userId: user.id, deliveryDate: { gte: dateOnly(today) }, status: { notIn: ["CANCELLED"] } },
      include: { items: { select: { name: true, quantity: true } } },
      orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }],
      take: 14,
    }),
    db.subscription.findMany({
      where: { userId: user.id, status: { in: ["ACTIVE", "PAUSED", "PENDING_PAYMENT"] } },
      include: { plan: { select: { name: true } }, _count: { select: { orders: { where: { status: "DELIVERED" } } } } },
      orderBy: { startDate: "asc" },
    }),
    walletBalance(user.id),
    db.payment.findMany({ where: { userId: user.id, status: { in: ["PENDING", "FAILED"] }, method: { in: ["ESEWA", "KHALTI", "BANK_TRANSFER"] }, orders: { some: { status: "PENDING_PAYMENT" } } }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.notification.findMany({ where: { userId: user.id, readAt: null }, orderBy: { createdAt: "desc" }, take: 3 }),
  ]);
  const open = await changeable(upcoming, settings, user.membership?.status === "ACTIVE" ? user.membership.company.cutoffOverride : null);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div className="space-y-8">
        {sp.welcome && (
          <div className="rounded-2xl border-2 border-ink bg-besar-light p-5">
            <p className="text-lg font-extrabold">Swagat chha! Your account is ready.</p>
            <p className="mt-1 text-sm text-ink-soft">
              Add where you want lunch — office, shop, college or home — then pick a day from the menu.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <LinkButton href="/account/addresses" size="sm">Add an address</LinkButton>
              <LinkButton href="/menu" size="sm" variant="outline">{t.account.seeMenu}</LinkButton>
            </div>
          </div>
        )}
        {sp.team === "forbidden" && <p className="rounded-lg border border-sindoor/30 bg-sindoor-light px-3 py-2 text-sm font-medium text-sindoor-dark">The team portal is only for company admins.</p>}

        {pending.length > 0 && (
          <div className="rounded-2xl border-2 border-sindoor bg-sindoor-light/60 p-4">
            <p className="font-bold text-sindoor-dark">Payment needed</p>
            <ul className="mt-2 space-y-2">
              {pending.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {p.reference} · {rs(p.amount)}
                  </span>
                  <LinkButton href={`/pay/${p.id}`} size="sm">{t.account.payNow}</LinkButton>
                </li>
              ))}
            </ul>
          </div>
        )}

        <section aria-labelledby="upcoming-h">
          <div className="flex items-end justify-between gap-3">
            <h2 id="upcoming-h" className="text-2xl font-extrabold">{t.account.upcoming}</h2>
            <p className="text-xs text-ink-mute">{format(t.account.changesClose, { time: settings.orderCutoff })}</p>
          </div>
          {upcoming.length === 0 ? (
            <div className="mt-4 rounded-2xl border-2 border-dashed border-ink-line p-8 text-center">
              <p className="text-ink-soft">{t.account.noUpcoming}</p>
              <div className="mt-4 flex justify-center gap-2">
                <LinkButton href="/menu">{t.account.seeMenu}</LinkButton>
                <LinkButton href="/plans" variant="outline">Plan my week</LinkButton>
              </div>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {upcoming.map((o) => (
                <OrderRow
                  key={o.id}
                  o={o}
                  actions={
                    open.get(o.id) ? (
                      <MealActions orderId={o.id} kind={o.source === "SUBSCRIPTION" ? "plan" : "single"} status={o.status} open credited={o.paymentStatus === "REFUNDED"} labels={t.account} />
                    ) : ["CONFIRMED", "PREPARING", "PACKED"].includes(o.status) ? (
                      <span className="text-xs font-semibold text-ink-mute">{t.account.locked}</span>
                    ) : o.status === "OUT_FOR_DELIVERY" && o.deliveryOtp ? (
                      <span className="text-sm font-bold">
                        {t.account.deliveryCode}: <span className="font-mono text-sindoor">{o.deliveryOtp}</span>
                      </span>
                    ) : null
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-5">
        <div className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-mute">{t.account.credit}</p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums">{rs(credit)}</p>
          <Link href="/account/wallet" className="mt-1 inline-block text-sm font-semibold text-sindoor underline underline-offset-2">
            See history
          </Link>
        </div>

        <div className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-mute">{t.account.planProgress}</p>
          {plans.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              No active plan. <Link href="/plans" className="font-semibold text-sindoor underline">Compare plans</Link>
            </p>
          ) : (
            <ul className="mt-3 space-y-4">
              {plans.map((p) => {
                const done = p._count.orders;
                const pct = Math.min(100, Math.round((done / Math.max(1, p.mealsTotal)) * 100));
                return (
                  <li key={p.id}>
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/account/plans/${p.id}`} className="font-bold hover:underline">{p.plan.name}</Link>
                      <Badge tone={SUB_STATUS[p.status].tone}>{SUB_STATUS[p.status].label}</Badge>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={p.mealsTotal} aria-label={`${done} of ${p.mealsTotal} lunches delivered`}>
                      <div className="h-full rounded-full bg-saag" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-ink-mute">
                      {done} of {p.mealsTotal} delivered · ends {formatDay(isoDate(p.endDate))}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {notes.length > 0 && (
          <div className="rounded-2xl border-2 border-ink bg-paper-card p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-ink-mute">New for you</p>
            <ul className="mt-2 space-y-2 text-sm">
              {notes.map((n) => (
                <li key={n.id}>
                  <p className="font-semibold">{n.title}</p>
                  {n.body && <p className="text-ink-soft">{n.body}</p>}
                </li>
              ))}
            </ul>
            <Link href="/account/notifications" className="mt-2 inline-block text-sm font-semibold text-sindoor underline">All notifications</Link>
          </div>
        )}

        {user.addresses.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-ink p-5 text-sm">
            <p className="font-bold">Where should we bring lunch?</p>
            <p className="mt-1 text-ink-soft">Save your office, shop, college or home address once.</p>
            <LinkButton href="/account/addresses" size="sm" className="mt-3">Add address</LinkButton>
          </div>
        )}
      </aside>
    </div>
  );
}
