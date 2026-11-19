import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { WEEKDAYS, WEEKDAY_LABEL, WEEKDAY_NEPALI, formatDay } from "@/lib/dates";
import { ORDER_STATUS } from "@/lib/labels";
import { format } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { dashboardDict } from "@/lib/i18n/dashboard";
import { mealCalendar } from "@/server/customer-dashboard";
import { LinkButton } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const DOT: Record<string, string> = { good: "bg-saag", bad: "bg-sindoor", warn: "bg-besar", brand: "bg-sindoor", info: "bg-akash", neutral: "bg-ink-mute" };

export default async function MealCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/account/orders/calendar");
  const locale = await getLocale();
  const d = dashboardDict(locale).calendar;
  const cal = await mealCalendar(user.id, sp.month);
  const monthName = new Intl.DateTimeFormat(locale === "ne" ? "ne-NP" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${cal.ym}-01T00:00:00Z`));
  const dayName = (i: number) => (locale === "ne" ? WEEKDAY_NEPALI[WEEKDAYS[i]] : WEEKDAY_LABEL[WEEKDAYS[i]]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold">{d.title}</h2>
          <p className="mt-1 text-sm text-ink-soft">{d.intro}</p>
        </div>
        <Link href="/account/orders" className="text-sm font-semibold text-sindoor underline underline-offset-2">{d.list}</Link>
      </div>

      <nav className="mt-5 flex flex-wrap items-center justify-between gap-2" aria-label={d.title}>
        <Link href={`/account/orders/calendar?month=${cal.prev}`} className="rounded-full border-2 border-ink px-3 py-1 text-sm font-bold hover:bg-ink hover:text-paper">
          ← <span className="sr-only sm:not-sr-only">{d.prev}</span>
        </Link>
        <div className="text-center">
          <p className="text-lg font-extrabold" aria-live="polite">{monthName}</p>
          <p className="text-xs text-ink-mute">{cal.count ? format(d.count, { n: cal.count }) : d.empty}</p>
        </div>
        <Link href={`/account/orders/calendar?month=${cal.next}`} className="rounded-full border-2 border-ink px-3 py-1 text-sm font-bold hover:bg-ink hover:text-paper">
          <span className="sr-only sm:not-sr-only">{d.next}</span> →
        </Link>
      </nav>

      {/* Month grid (sm and up) */}
      <table className="mt-4 hidden w-full table-fixed border-collapse sm:table">
        <caption className="sr-only">{monthName}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((w, i) => (
              <th key={w} scope="col" className="pb-2 text-left text-xs font-bold uppercase tracking-wider text-ink-mute">{dayName(i)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cal.weeks.map((week) => (
            <tr key={week[0].date}>
              {week.map((c) => {
                const orders = cal.byDate.get(c.date) ?? [];
                return (
                  <td key={c.date} className={cn("h-24 border-2 border-ink-line p-1.5 align-top", !c.inMonth && "bg-ink/[0.03] text-ink-mute", c.isToday && "border-ink bg-besar-light")}>
                    <p className={cn("text-xs font-bold", c.isToday && "text-sindoor")} aria-current={c.isToday ? "date" : undefined}>{Number(c.date.slice(8))}</p>
                    <ul className="mt-1 space-y-1">
                      {orders.map((o) => (
                        <li key={o.id}>
                          <Link href={`/account/orders/${o.id}`} className="flex items-center gap-1 truncate rounded bg-white px-1 py-0.5 text-[11px] font-semibold ring-1 ring-ink-line hover:ring-ink" title={`${o.items.map((i) => i.name).join(", ")} · ${ORDER_STATUS[o.status].label}`}>
                            <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[ORDER_STATUS[o.status].tone])} />
                            <span className="truncate">{o.items[0]?.name ?? `#${o.number}`}</span>
                            <span className="sr-only"> · {ORDER_STATUS[o.status].label}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Agenda (phones) */}
      <ul className="mt-4 space-y-2 sm:hidden">
        {cal.weeks.flat().filter((c) => c.inMonth && cal.byDate.has(c.date)).map((c) => (
          <li key={c.date} className={cn("rounded-xl border-2 bg-white px-4 py-3", c.isToday ? "border-ink" : "border-ink-line")}>
            <p className="text-sm font-extrabold">{formatDay(c.date)}</p>
            <ul className="mt-1 space-y-1">
              {cal.byDate.get(c.date)!.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/account/orders/${o.id}`} className="min-w-0 truncate font-semibold hover:underline">
                    {o.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(", ")}
                  </Link>
                  <span className="shrink-0 text-xs text-ink-mute">{ORDER_STATUS[o.status].label}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {cal.count === 0 && (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-ink-line p-6 text-center">
          <p className="text-ink-soft">{d.empty}</p>
          <LinkButton href="/menu" className="mt-3" size="sm">See the menu</LinkButton>
        </div>
      )}
    </div>
  );
}
