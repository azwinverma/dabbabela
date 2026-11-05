import Link from "next/link";
import { cn } from "@/lib/utils";
import { addDays, todayKTM, isValidISODate } from "@/lib/dates";

/** KPI tile with its formula shown on hover/focus and printed below on print. */
export function Kpi({ label, value, formula, sub, tone = "default", href }: { label: string; value: React.ReactNode; formula?: string; sub?: React.ReactNode; tone?: "default" | "good" | "warn" | "bad"; href?: string }) {
  return (
    <div
      className={cn(
        "group relative rounded-xl border p-4 shadow-card",
        tone === "default" && "border-ink-line/80 bg-white",
        tone === "good" && "border-saag/30 bg-saag-light",
        tone === "warn" && "border-besar/50 bg-besar-light",
        tone === "bad" && "border-sindoor/30 bg-sindoor-light",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-mute">{label}</p>
        {formula && (
          <span tabIndex={0} aria-label={`How "${label}" is calculated: ${formula}`} className="grid h-4 w-4 shrink-0 cursor-help place-items-center rounded-full border border-ink-line text-[10px] font-bold text-ink-mute outline-none focus:ring-2 focus:ring-besar">
            i
          </span>
        )}
      </div>
      <p className="mt-1.5 font-display text-2xl font-bold tabular-nums text-ink">
        {href ? (
          <Link href={href} className="hover:underline focus-visible:underline" title="Show the records behind this number">
            {value}
          </Link>
        ) : (
          value
        )}
      </p>
      {sub && <p className="mt-0.5 text-xs text-ink-mute">{sub}</p>}
      {formula && (
        <p role="tooltip" className="pointer-events-none absolute left-2 right-2 top-full z-20 mt-1 hidden rounded-lg bg-ink px-3 py-2 text-xs leading-snug text-paper shadow-lg group-focus-within:block group-hover:block print:static print:mt-2 print:block print:bg-transparent print:p-0 print:text-ink-mute">
          {formula} <span className="opacity-70">· Live from the database.</span>
        </p>
      )}
    </div>
  );
}

export function pct(n: number | null | undefined, digits = 0) {
  return n == null ? "—" : `${(n * 100).toFixed(digits)}%`;
}

/** Read ?from=&to= (ISO) with a default window ending today. */
export function readRange(sp: Record<string, string | undefined>, defaultDays = 30) {
  const today = todayKTM();
  const to = sp.to && isValidISODate(sp.to) ? sp.to : today;
  const from = sp.from && isValidISODate(sp.from) && sp.from <= to ? sp.from : addDays(to, -(defaultDays - 1));
  return { from, to };
}

export function RangeForm({ from, to, children, presets = true }: { from: string; to: string; children?: React.ReactNode; presets?: boolean }) {
  const today = todayKTM();
  const quick = [
    ["Today", today, today],
    ["7 days", addDays(today, -6), today],
    ["30 days", addDays(today, -29), today],
    ["This month", `${today.slice(0, 7)}-01`, today],
  ] as const;
  return (
    <form className="mb-5 flex flex-wrap items-end gap-2 print:hidden">
      <label className="text-xs font-semibold text-ink-soft">
        From
        <input type="date" name="from" defaultValue={from} className="field mt-1 w-40" />
      </label>
      <label className="text-xs font-semibold text-ink-soft">
        To
        <input type="date" name="to" defaultValue={to} className="field mt-1 w-40" />
      </label>
      {children}
      <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Apply</button>
      {presets && (
        <span className="flex flex-wrap gap-1 text-xs">
          {quick.map(([l, f, t]) => (
            <a key={l} href={`?from=${f}&to=${t}`} className="rounded-full border border-ink-line bg-white px-2.5 py-1 font-semibold text-ink-soft hover:border-ink">
              {l}
            </a>
          ))}
        </span>
      )}
    </form>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-ink-line bg-white/60 px-4 py-8 text-center text-sm text-ink-mute">{children}</p>;
}


/** "+12% vs previous" chip. null = no previous data (never shown as 0%). */
export function Growth({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-mute">no prior data</span>;
  const up = value >= 0;
  return <span className={cn("font-semibold tabular-nums", up ? "text-saag" : "text-sindoor")}>{`${up ? "▲" : "▼"} ${Math.abs(value * 100).toFixed(0)}%`}</span>;
}

/** Money value, or an honest "No data recorded" for a source with no rows. */
export function MaybeMoney({ value, fmt, none = "No data recorded" }: { value: number | null | undefined; fmt: (n: number) => string; none?: string }) {
  return value == null ? <span className="text-sm font-normal italic text-ink-mute">{none}</span> : <>{fmt(value)}</>;
}
