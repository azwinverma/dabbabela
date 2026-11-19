import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDay, TZ } from "@/lib/dates";
import { rs } from "@/lib/money";
import { format } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { dashboardDict } from "@/lib/i18n/dashboard";
import { walletBalance } from "@/server/ledger";
import { awaitingFeedback, dashboardPlans, hasCustomerAction, mealWindows, STATUS_STEPS, statusStep, todayLunches, upcomingLunches, type MealWindow } from "@/server/customer-dashboard";
import { LinkButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ORDER_STATUS, SUB_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { OrderRow } from "./OrderRow";
import { MealActions } from "./MealActions";
import { AutoRefresh } from "./AutoRefresh";

const UPCOMING_DAYS = 14;
const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const MOVING = new Set(["CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY"]);

export default async function AccountHome({ searchParams }: { searchParams: Promise<{ welcome?: string; team?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/account");
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
  const t = accountDict(locale);
  const d = dashboardDict(locale);
  const [today, upcoming, plans, credit, pending, notes, rate] = await Promise.all([
    todayLunches(user.id),
    upcomingLunches(user.id, { days: UPCOMING_DAYS }),
    dashboardPlans(user.id),
    walletBalance(user.id),
    db.payment.findMany({ where: { userId: user.id, status: { in: ["PENDING", "FAILED"] }, method: { in: ["ESEWA", "KHALTI", "BANK_TRANSFER"] }, orders: { some: { status: "PENDING_PAYMENT" } } }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.notification.findMany({ where: { userId: user.id, readAt: null }, orderBy: { createdAt: "desc" }, take: 3 }),
    awaitingFeedback(user.id),
  ]);
  const windows = await mealWindows([...today, ...upcoming], settings);
  const live = today.some((o) => MOVING.has(o.status));

  const actionsFor = (o: (typeof upcoming)[number], w: MealWindow | undefined) =>
    w?.open && hasCustomerAction(o) ? (
      <div className="flex flex-wrap items-center gap-2">
        <MealActions orderId={o.id} kind={o.source === "SUBSCRIPTION" ? "plan" : "single"} status={o.status} open credited={o.paymentStatus === "REFUNDED"} labels={t.account} />
        <span className="text-xs text-ink-mute">{format(d.home.changesUntil, { time: w.cutoff })}</span>
      </div>
    ) : ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED"].includes(o.status) ? (
      <span className="text-xs font-semibold text-ink-mute">{t.account.locked}</span>
    ) : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      {live && <AutoRefresh seconds={60} />}
      <div className="space-y-8">
        {sp.welcome && (
          <div className="rounded-2xl border-2 border-ink bg-besar-light p-5">
            <p className="text-lg font-extrabold">Swagat chha! Your account is ready.</p>
            <p className="mt-1 text-sm text-ink-soft">Add where you want lunch — office, shop, college or home — then pick a day from the menu.</p>
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

        {/* Today */}
        <section aria-labelledby="today-h">
          <h2 id="today-h" className="text-2xl font-extrabold">{d.home.today}</h2>
          {today.length === 0 ? (
            <p className="mt-3 rounded-2xl border-2 border-dashed border-ink-line px-5 py-4 text-sm text-ink-soft">{d.home.todayNone}</p>
          ) : (
            <div className="mt-3 space-y-3">
              {today.map((o) => {
                const step = statusStep(o.status);
                const at = new Map<string, Date>();
                for (const e of o.events) at.set(e.toStatus, e.createdAt);
                const w = windows.get(o.id);
                return (
                  <article key={o.id} className="rounded-2xl border-2 border-ink bg-paper-card p-5" aria-labelledby={`today-${o.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 id={`today-${o.id}`} className="text-lg font-extrabold">
                          <Link href={`/account/orders/${o.id}`} className="hover:underline">
                            {o.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(", ")}
                          </Link>
                        </h3>
                        <p className="text-xs text-ink-mute">
                          #{o.number} · {o.slotLabel ?? "Lunch"}
                          {o.subscription ? ` · ${d.home.planMeal}` : ""}
                        </p>
                      </div>
                      <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
                    </div>

                    {step >= 0 ? (
                      <ol className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label={d.home.today}>
                        {STATUS_STEPS.map((s, i) => {
                          const reached = i <= step;
                          const current = i === step;
                          const stamp = at.get(s);
                          return (
                            <li key={s} aria-current={current ? "step" : undefined} className="flex flex-col items-start gap-1">
                              <span aria-hidden className={cn("h-2 w-full rounded-full", reached ? "bg-saag" : "bg-ink/10", current && "bg-sindoor")} />
                              <span className={cn("text-xs", reached ? "font-bold text-ink" : "text-ink-mute")}>{d.steps[s as keyof typeof d.steps]}</span>
                              {stamp && reached && <span className="text-[11px] text-ink-mute">{hhmm.format(stamp)}</span>}
                            </li>
                          );
                        })}
                      </ol>
                    ) : o.status === "FAILED_DELIVERY" ? (
                      <p className="mt-3 text-sm text-sindoor-dark">{d.home.failedHelp}</p>
                    ) : null}

                    {o.status === "OUT_FOR_DELIVERY" && o.deliveryOtp && (
                      <p className="mt-4 rounded-xl bg-besar px-4 py-2 text-sm font-bold">
                        {t.account.deliveryCode}: <span className="font-mono text-lg tracking-[0.2em]">{o.deliveryOtp}</span>
                        <span className="block text-xs font-normal">{t.account.deliveryCodeHint}</span>
                      </p>
                    )}
                    <div className="mt-3">{actionsFor(o, w)}</div>
                    <p className="mt-3 text-xs text-ink-mute">
                      {d.home.statusNote}
                      {live && MOVING.has(o.status) ? ` ${d.home.autoRefresh}` : ""}
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Upcoming */}
        <section aria-labelledby="upcoming-h">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="upcoming-h" className="text-2xl font-extrabold">{t.account.upcoming}</h2>
              <p className="text-xs text-ink-mute">{format(d.home.upcomingRange, { n: UPCOMING_DAYS })}</p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm font-semibold">
              <Link href="/account/orders/calendar" className="text-sindoor underline underline-offset-2">{d.home.calendar}</Link>
              <Link href="/account/orders" className="text-sindoor underline underline-offset-2">{d.home.allOrders}</Link>
            </div>
          </div>
          {upcoming.length === 0 ? (
            <div className="mt-4 rounded-2xl border-2 border-dashed border-ink-line p-8 text-center">
              <p className="text-ink-soft">{t.account.noUpcoming}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <LinkButton href="/menu">{t.account.seeMenu}</LinkButton>
                <LinkButton href="/plans" variant="outline">Plan my week</LinkButton>
              </div>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {upcoming.map((o) => (
                <OrderRow key={o.id} o={o} actions={actionsFor(o, windows.get(o.id))} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-5">
        <div className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-mute">{t.account.credit}</p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums">{rs(credit)}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 text-sm font-semibold">
            <Link href="/account/wallet" className="text-sindoor underline underline-offset-2">See history</Link>
            <Link href="/account/payments" className="text-sindoor underline underline-offset-2">{d.home.payments}</Link>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-mute">{t.account.planProgress}</p>
          {plans.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              {d.home.noPlan} <Link href="/plans" className="font-semibold text-sindoor underline">{d.home.comparePlans}</Link>
            </p>
          ) : (
            <ul className="mt-3 space-y-4">
              {plans.map((p) => {
                const pct = Math.min(100, Math.round((p.delivered / Math.max(1, p.mealsTotal)) * 100));
                return (
                  <li key={p.id}>
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/account/plans/${p.id}`} className="font-bold hover:underline">{p.name}</Link>
                      <Badge tone={SUB_STATUS[p.status].tone}>{SUB_STATUS[p.status].label}</Badge>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={p.delivered} aria-valuemin={0} aria-valuemax={p.mealsTotal} aria-label={`${p.delivered} / ${p.mealsTotal}`}>
                      <div className="h-full rounded-full bg-saag" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-ink-mute">
                      {p.status === "COMPLETED" ? format(d.home.ended, { date: formatDay(p.endDate) }) : format(d.home.delivered, { done: p.delivered, total: p.mealsTotal, date: formatDay(p.endDate) })}
                    </p>
                    {p.renewDue && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-besar-light px-3 py-2 text-xs">
                        <span className="flex-1">{format(d.home.renewHint, { date: formatDay(p.endDate) })}</span>
                        <LinkButton href={`/account/plans/${p.id}#renew`} size="sm" variant="besar">{d.home.renew}</LinkButton>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {rate.length > 0 && (
          <div className="rounded-2xl border-2 border-ink bg-paper-card p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-ink-mute">{d.home.rateTitle}</p>
            <ul className="mt-2 space-y-2 text-sm">
              {rate.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {formatDay(o.deliveryDate)} · {o.items[0]?.name ?? `#${o.number}`}
                  </span>
                  <Link href={`/account/orders/${o.id}#feedback`} className="shrink-0 font-semibold text-sindoor underline">{d.home.rate}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}

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
