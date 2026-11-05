import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { addDays, formatDay } from "@/lib/dates";
import { rs } from "@/lib/money";
import { cn } from "@/lib/utils";
import { isPastDay, riderDate, riderDayWindow, riderRouteDays, riderRoutes } from "@/server/dispatch";

export const dynamic = "force-dynamic";

export default async function RiderHome({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requirePermission("rider.view");
  const sp = await searchParams;
  const w = riderDayWindow();
  const date = riderDate(sp.date, w.today);
  const past = isPastDay(date, w.today);
  const [routes, counts] = await Promise.all([riderRoutes(user, date), riderRouteDays(user)]);
  const strip: string[] = [];
  for (let d = addDays(w.today, -3); d <= addDays(w.today, 5); d = addDays(d, 1)) strip.push(d);
  const isRider = user.role === "DELIVERY_AGENT";
  const title = date === w.today ? "Today's routes" : past ? "Past routes" : "Upcoming routes";

  return (
    <div>
      <nav aria-label="Pick a day" className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {strip.map((d) => {
          const n = counts.get(d) ?? 0;
          return (
            <Link
              key={d}
              href={d === w.today ? "/rider" : `/rider?date=${d}`}
              aria-current={d === date ? "date" : undefined}
              className={cn("flex min-w-[3.5rem] shrink-0 flex-col items-center rounded-xl border-2 px-2 py-1.5 text-xs font-bold", d === date ? "border-ink bg-ink text-paper" : "border-ink-line bg-white", isPastDay(d, w.today) && d !== date && "opacity-70")}
            >
              <span>{d === w.today ? "Today" : formatDay(d).split(" ")[0]}</span>
              <span className="text-base">{d.slice(8)}</span>
              <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full", n ? (d === date ? "bg-paper" : "bg-sindoor") : "bg-transparent")} aria-label={n ? `${n} route(s)` : undefined} />
            </Link>
          );
        })}
      </nav>
      <form className="mb-4 flex items-center gap-2 text-sm">
        <input type="date" name="date" defaultValue={date} min={w.from} max={w.to} className="field h-10 flex-1" aria-label="Another day" />
        <button className="h-10 rounded-xl bg-ink px-4 font-bold text-paper">Open</button>
      </form>

      <h1 className="font-display text-2xl font-extrabold">{title}</h1>
      <p className="mb-5 text-sm text-ink-mute">{formatDay(date, "full")}{past ? " · read-only" : ""}</p>
      <ul className="space-y-3">
        {routes.map((r) => {
          const done = r.assignments.filter((a) => ["DELIVERED", "FAILED_DELIVERY", "CANCELLED"].includes(a.order.status)).length;
          return (
            <li key={r.id}>
              <Link href={`/rider/route/${r.id}`} className="block rounded-2xl border-2 border-ink bg-white p-4 shadow-sticker active:translate-y-0.5 active:shadow-none">
                <div className="flex items-center justify-between">
                  <span className="font-display text-xl font-bold">{r.name}</span>
                  <span className="rounded-full bg-ink px-3 py-1 text-xs font-bold uppercase text-paper">{r.status === "PLANNED" ? "waiting" : r.status.toLowerCase()}</span>
                </div>
                <p className="mt-1 text-sm text-ink-mute">
                  {r.slot?.label ?? "Any slot"} · {done}/{r.assignments.length} stops done{!isRider ? ` · ${r.rider?.name ?? "no rider"}` : ""}
                </p>
                {r.cashCollected > 0 && <p className="mt-1 text-sm font-semibold">{past ? "Cash collected" : "Cash on you"}: {rs(r.cashCollected)}</p>}
              </Link>
            </li>
          );
        })}
      </ul>
      {!routes.length && (
        <p className="rounded-2xl border-2 border-dashed border-ink-line p-8 text-center text-ink-mute">
          {past ? "No routes on this day." : date === w.today ? "No routes for you today yet. Dispatch will assign one." : "Nothing planned for this day yet."}
        </p>
      )}
    </div>
  );
}
