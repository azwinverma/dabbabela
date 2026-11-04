import Link from "next/link";
import { addDays, formatDay, todayKTM } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** GET form: kitchen + date (+ extra hidden params) with prev/today/next shortcuts. */
export function DayPicker({ path, date, kitchenId, kitchens, extra = {}, children }: { path: string; date: string; kitchenId?: string; kitchens: { id: string; name: string }[]; extra?: Record<string, string | undefined>; children?: React.ReactNode }) {
  const q = (d: string) => {
    const p = new URLSearchParams();
    if (kitchenId) p.set("kitchen", kitchenId);
    Object.entries(extra).forEach(([k, v]) => v && p.set(k, v));
    p.set("date", d);
    return `${path}?${p}`;
  };
  const today = todayKTM();
  const chip = "rounded-lg border border-ink-line bg-white px-3 py-2 text-sm font-semibold hover:border-ink";
  return (
    <div className="no-print mb-5 flex flex-wrap items-end gap-2">
      <form className="flex flex-wrap items-end gap-2">
        {kitchens.length > 1 && (
          <label className="text-xs font-semibold text-ink-mute">
            Kitchen
            <select name="kitchen" defaultValue={kitchenId} className="field mt-1 w-44">
              {kitchens.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {kitchens.length === 1 && <input type="hidden" name="kitchen" value={kitchenId} />}
        {Object.entries(extra).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
        <label className="text-xs font-semibold text-ink-mute">
          Date
          <input type="date" name="date" defaultValue={date} className="field mt-1 w-40" />
        </label>
        {children}
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Go</button>
      </form>
      <div className="flex gap-1.5">
        <Link className={chip} href={q(addDays(date, -1))} aria-label="Previous day">←</Link>
        <Link className={cn(chip, date === today && "border-ink bg-ink text-paper")} href={q(today)}>Today</Link>
        <Link className={cn(chip, date === addDays(today, 1) && "border-ink bg-ink text-paper")} href={q(addDays(today, 1))}>Tomorrow</Link>
        <Link className={chip} href={q(addDays(date, 1))} aria-label="Next day">→</Link>
      </div>
      <p className="ml-auto self-center text-sm font-semibold text-ink">{formatDay(date, "full")}</p>
    </div>
  );
}
