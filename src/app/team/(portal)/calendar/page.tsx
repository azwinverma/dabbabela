import { requireCompanyAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { addDays, formatDay, todayKTM, weekdayOf, weekStartOf } from "@/lib/dates";
import { getClosures } from "@/server/calendar";
import { getOffersForDates, rotationPick } from "@/server/menu";
import { cn } from "@/lib/utils";

export const metadata = { title: "Calendar" };

export default async function TeamCalendar() {
  const { company } = await requireCompanyAdmin();
  const s = await getSettings();
  const start = weekStartOf(todayKTM());
  const days = Array.from({ length: 28 }, (_, i) => addDays(start, i));
  const [closures, offers] = await Promise.all([getClosures(days[0], days[27]), getOffersForDates(days)]);
  const cutoff = company.cutoffOverride || s.orderCutoff;
  const today = todayKTM();
  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-bold">Team calendar</h1>
      <p className="mb-4 text-sm text-ink-mute">
        Next four weeks: closures, holidays and the chef&apos;s pick each day. Orders and skips close at <b>{cutoff}</b> on the day{company.cutoffOverride ? " (your company's own cut-off)" : ""}.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((d) => {
          const closed = closures.get(d);
          const delivery = s.deliveryDays.includes(weekdayOf(d));
          const pick = !closed && delivery ? rotationPick(offers.get(d), false) : null;
          return (
            <div key={d} className={cn("min-h-24 rounded-lg border p-2 text-xs", d < today ? "opacity-50" : "", closed ? "border-sindoor/40 bg-sindoor-light" : !delivery ? "border-ink-line/50 bg-paper-deep/50" : "border-ink-line bg-white", d === today && "ring-2 ring-besar")}>
              <p className="font-semibold">{formatDay(d)}</p>
              {closed ? <p className="mt-1 font-semibold text-sindoor">Closed — {closed}</p> : !delivery ? <p className="mt-1 text-ink-mute">No delivery</p> : pick ? <p className="mt-1">{pick.box.name}</p> : <p className="mt-1 text-ink-mute">Menu not set</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
