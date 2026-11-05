import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { addDays, formatDay, todayKTM } from "@/lib/dates";
import { PageHeader, Panel, StatCard, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { cn } from "@/lib/utils";
import { MAX_WEEKS, productionCalendar } from "./query";

export const metadata = { title: "Production calendar" };

export default async function ProductionCalendarPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; from?: string; weeks?: string }> }) {
  const user = await requirePermission("kitchen.view");
  const sp = await searchParams;
  const cal = await productionCalendar(user, { from: sp.from, weeks: sp.weeks ? parseInt(sp.weeks, 10) : 2, kitchenId: sp.kitchen || null });
  const today = todayKTM();
  const single = cal.chosen.length === 1 ? cal.chosen[0] : null;
  const href = (from: string) => {
    const p = new URLSearchParams();
    if (sp.kitchen) p.set("kitchen", sp.kitchen);
    p.set("weeks", String(cal.weeks));
    p.set("from", from);
    return `/admin/production-calendar?${p}`;
  };
  const reqHref = (kitchenId: string, date: string) => `/admin/kitchen/requirements?kitchen=${kitchenId}&date=${date}`;
  const weekBlocks = Array.from({ length: cal.weeks }, (_, w) => cal.days.slice(w * 7, w * 7 + 7));
  const chip = "rounded-lg border border-ink-line bg-white px-3 py-2 text-sm font-semibold hover:border-ink";
  return (
    <div>
      <PageHeader
        title="Production calendar"
        description="Meals the kitchens are committed to cook, per day and dabba, from booked orders (plan meals are booked at purchase). Awaiting-payment meals are shown apart and not counted. Open a day for its ingredient requirements."
      />
      <div className="no-print mb-5 flex flex-wrap items-end gap-2">
        <form className="flex flex-wrap items-end gap-2">
          {cal.kitchens.length > 1 && (
            <label className="text-xs font-semibold text-ink-mute">
              Kitchen
              <select name="kitchen" defaultValue={sp.kitchen ?? ""} className="field mt-1 w-44">
                <option value="">All kitchens</option>
                {cal.kitchens.map((k) => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs font-semibold text-ink-mute">
            From week of
            <input type="date" name="from" defaultValue={cal.start} className="field mt-1 w-40" />
          </label>
          <label className="text-xs font-semibold text-ink-mute">
            Weeks
            <select name="weeks" defaultValue={String(cal.weeks)} className="field mt-1 w-24">
              {Array.from({ length: MAX_WEEKS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Show</button>
        </form>
        <div className="flex gap-1.5">
          <Link className={chip} href={href(addDays(cal.start, -7))} aria-label="Previous week">←</Link>
          <Link className={chip} href={href(today)}>This week</Link>
          <Link className={chip} href={href(addDays(cal.start, 7))} aria-label="Next week">→</Link>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Committed meals" value={cal.totals.meals} sub={`${formatDay(cal.start)} → ${formatDay(cal.end)}`} />
        <StatCard label="From meal plans" value={cal.totals.planMeals} sub={`${cal.totals.meals - cal.totals.planMeals} single / corporate`} />
        <StatCard label="Awaiting payment" value={cal.totals.pending} tone={cal.totals.pending ? "warn" : "default"} sub="not counted until paid" />
      </div>

      {weekBlocks.map((days) => (
        <Panel key={days[0]} title={`Week of ${formatDay(days[0], "long")}`} className="mb-5" bodyClass="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Dabba</Th>
                {days.map((d) => (
                  <Th key={d} className={cn("text-right", d === today && "text-sindoor")}>
                    {single ? (
                      <Link href={reqHref(single.id, d)} className="hover:underline" title="Ingredient requirements">{formatDay(d)}</Link>
                    ) : (
                      formatDay(d)
                    )}
                  </Th>
                ))}
                <Th className="text-right">Week</Th>
              </tr>
            </thead>
            <tbody>
              {cal.rows.filter((r) => days.some((d) => r.perDay[d])).map((r) => (
                <tr key={r.key}>
                  <Td className="font-medium">{r.name}</Td>
                  {days.map((d) => (
                    <Td key={d} className="text-right tabular-nums">{r.perDay[d] || <span className="text-ink-mute">·</span>}</Td>
                  ))}
                  <Td className="text-right font-semibold tabular-nums">{days.reduce((a, d) => a + (r.perDay[d] ?? 0), 0)}</Td>
                </tr>
              ))}
              {!cal.rows.some((r) => days.some((d) => r.perDay[d])) && <EmptyRow colSpan={9}>No committed meals this week.</EmptyRow>}
            </tbody>
            <tfoot>
              {cal.chosen.length > 1 &&
                cal.chosen.map((k) => (
                  <tr key={k.id} className="border-t border-ink-line/60 text-xs">
                    <Td className="text-ink-mute">{k.name}</Td>
                    {days.map((d) => {
                      const c = cal.cell(k.id, d);
                      return (
                        <Td key={d} className="text-right tabular-nums">
                          {c.meals ? <Link href={reqHref(k.id, d)} className="text-akash hover:underline" title="Ingredient requirements">{c.meals}</Link> : <span className="text-ink-mute">·</span>}
                        </Td>
                      );
                    })}
                    <Td className="text-right tabular-nums">{days.reduce((a, d) => a + cal.cell(k.id, d).meals, 0)}</Td>
                  </tr>
                ))}
              <tr className="border-t-2 border-ink font-semibold">
                <Td>Total committed</Td>
                {days.map((d) => (
                  <Td key={d} className="text-right tabular-nums">{cal.perDay[d].meals}</Td>
                ))}
                <Td className="text-right tabular-nums">{days.reduce((a, d) => a + cal.perDay[d].meals, 0)}</Td>
              </tr>
              <tr className="text-xs text-ink-mute">
                <Td>of which plan meals</Td>
                {days.map((d) => (
                  <Td key={d} className="text-right tabular-nums">{cal.perDay[d].planMeals || "·"}</Td>
                ))}
                <Td className="text-right tabular-nums">{days.reduce((a, d) => a + cal.perDay[d].planMeals, 0)}</Td>
              </tr>
              <tr className="text-xs text-ink-mute">
                <Td>Awaiting payment</Td>
                {days.map((d) => (
                  <Td key={d} className="text-right tabular-nums">{cal.perDay[d].pending || "·"}</Td>
                ))}
                <Td className="text-right tabular-nums">{days.reduce((a, d) => a + cal.perDay[d].pending, 0)}</Td>
              </tr>
            </tfoot>
          </Table>
        </Panel>
      ))}
      {!single && cal.chosen.length > 1 && <p className="text-xs text-ink-mute">Pick a kitchen (or click a kitchen&apos;s daily total) to open that day&apos;s ingredient requirements.</p>}
    </div>
  );
}
