import Link from "next/link";

/**
 * Lightweight server-rendered SVG charts (WP-02). No client JS: every bar is a link to the filtered records
 * behind it (drill-down). Flat brand colours only — no gradients.
 */

export type LinkDatum = { label: string; value: number; href?: string; title?: string };

/** Vertical bars, one link per bar. */
export function LinkBars({ data, height = 180, format = String, color = "#8B2923", ariaLabel = "Bar chart" }: { data: LinkDatum[]; height?: number; format?: (n: number) => string; color?: string; ariaLabel?: string }) {
  const max = Math.max(1, ...data.map((d) => Math.max(0, d.value)));
  const vh = height / 3;
  const w = 100 / Math.max(1, data.length);
  const every = data.length > 14 ? Math.ceil(data.length / 10) : 1;
  return (
    <div>
      <svg viewBox={`0 0 100 ${vh}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={ariaLabel}>
        {data.map((d, i) => {
          const h = (Math.max(0, d.value) / max) * (vh - 2);
          const bar = (
            <rect x={i * w + w * 0.15} y={vh - h} width={w * 0.7} height={Math.max(h, 0.4)} rx="0.6" fill={color} opacity={d.value ? 1 : 0.25} className={d.href ? "hover:opacity-80" : undefined}>
              <title>{d.title ?? `${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
          return d.href ? (
            <a key={i} href={d.href} aria-label={`${d.label}: ${format(d.value)}`}>
              {/* full-height hit area so tiny bars are still clickable */}
              <rect x={i * w} y={0} width={w} height={vh} fill="transparent" />
              {bar}
            </a>
          ) : (
            <g key={i}>{bar}</g>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-ink-mute">
        {data.map((d, i) => (
          <span key={i} className="flex-1 truncate text-center" style={{ visibility: i % every ? "hidden" : "visible" }}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal ranked bars; each row links to its records. */
export function LinkRank({ rows, format = String, empty = "No data recorded for this range.", tone = "besar" }: { rows: (LinkDatum & { sub?: string })[]; format?: (n: number) => string; empty?: string; tone?: "besar" | "saag" | "sindoor" | "akash" }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-mute">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const fill = { besar: "bg-besar", saag: "bg-saag", sindoor: "bg-sindoor", akash: "bg-akash" }[tone];
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="mb-1 flex justify-between gap-2 text-sm">
              <span className="truncate font-medium">{r.label}</span>
              <span className="shrink-0 tabular-nums text-ink-mute">
                {format(r.value)}
                {r.sub && <span className="ml-1 text-xs">· {r.sub}</span>}
              </span>
            </div>
            <div className="h-2 rounded-full bg-paper-deep">
              <div className={`h-2 rounded-full ${fill}`} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
            </div>
          </>
        );
        return (
          <li key={r.label}>
            {r.href ? (
              <Link href={r.href} className="block rounded-md outline-none hover:bg-paper/60 focus-visible:ring-2 focus-visible:ring-besar">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Small horizontal stacked bar for shares (e.g. pipeline by status). */
export function StackBar({ parts }: { parts: { label: string; value: number; color: string; href?: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return <div className="h-3 rounded-full bg-paper-deep" aria-hidden />;
  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-paper-deep" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
      {parts
        .filter((p) => p.value)
        .map((p) =>
          p.href ? (
            <a key={p.label} href={p.href} title={`${p.label}: ${p.value}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
          ) : (
            <span key={p.label} title={`${p.label}: ${p.value}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
          ),
        )}
    </div>
  );
}
