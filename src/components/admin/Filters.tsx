import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * GET filter form for list pages. Every control is labelled; "Clear" resets to `basePath`.
 * Keeps sort/per (hidden inputs) so filtering doesn't lose them; paging resets to 1 automatically.
 *
 *   <FilterForm basePath="/admin/x" keep={{ sort: state.sort, dir: state.dir }} q={sp.q}>
 *     <StatusSelect name="status" value={sp.status} options={[{ value: "OPEN", label: "Open" }]} />
 *     <DateRangeFields from={range.from} to={range.to} />
 *   </FilterForm>
 */
export function FilterForm({
  basePath,
  children,
  q,
  qLabel = "Search",
  placeholder = "Search…",
  keep = {},
  active,
  id = "flt",
}: {
  basePath: string;
  children?: React.ReactNode;
  /** Free-text value; omit (undefined and no placeholder wanted) by passing `q={null}`. */
  q?: string | null;
  qLabel?: string;
  placeholder?: string;
  keep?: Record<string, string | undefined>;
  /** Show "Clear" (default: when q is set). */
  active?: boolean;
  /** Prefix for control ids (set when a page has two filter forms). */
  id?: string;
}) {
  return (
    <form action={basePath} method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-ink-line/70 bg-white/70 p-3">
      {q !== null && (
        <Field label={qLabel} htmlFor={`${id}-q`}>
          <input id={`${id}-q`} name="q" type="search" defaultValue={q ?? ""} placeholder={placeholder} className="field w-56" />
        </Field>
      )}
      {children}
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="flex gap-2">
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-akash">Apply</button>
        {(active ?? Boolean(q)) && (
          <Link href={basePath} className="inline-flex h-[38px] items-center rounded-lg px-3 text-sm font-medium text-ink-mute hover:bg-ink/5 hover:text-ink">
            Clear
          </Link>
        )}
      </div>
    </form>
  );
}

/** Small visible label above a control (keeps filter bars accessible without placeholders-as-labels). */
export function Field({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">
        {label}
      </label>
      {children}
    </div>
  );
}

export function DateRangeFields({ from, to, fromName = "from", toName = "to", label = "Date" }: { from?: string; to?: string; fromName?: string; toName?: string; label?: string }) {
  const id = `flt-${fromName}`;
  return (
    <>
      <Field label={`${label} from`} htmlFor={`${id}-f`}>
        <input id={`${id}-f`} type="date" name={fromName} defaultValue={from ?? ""} max={to} className="field w-auto" />
      </Field>
      <Field label="to" htmlFor={`${id}-t`}>
        <input id={`${id}-t`} type="date" name={toName} defaultValue={to ?? ""} min={from} className="field w-auto" />
      </Field>
    </>
  );
}

export function StatusSelect({ name = "status", label = "Status", value, options, anyLabel = "Any" }: { name?: string; label?: string; value?: string; options: { value: string; label: string }[]; anyLabel?: string }) {
  const id = `flt-${name}`;
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} name={name} defaultValue={value ?? ""} className="field w-auto">
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TextFilter({ name, label, value, placeholder, className = "w-40" }: { name: string; label: string; value?: string; placeholder?: string; className?: string }) {
  const id = `flt-${name}`;
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} name={name} defaultValue={value ?? ""} placeholder={placeholder} className={cn("field", className)} />
    </Field>
  );
}
