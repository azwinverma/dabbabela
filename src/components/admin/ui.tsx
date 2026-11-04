import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { ORDER_STATUS, PAYMENT_STATUS, SUB_STATUS, LEAD_STATUS } from "@/lib/labels";
import type { LeadStatus, OrderStatus, PaymentStatus, SubscriptionStatus } from "@prisma/client";

export function PageHeader({ title, description, actions, back }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-xs font-semibold text-ink-mute hover:text-ink">
            ← {back.label}
          </Link>
        )}
        <h1 className="font-display text-2xl font-bold text-ink md:text-[1.7rem]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-mute">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, bodyClass }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn("rounded-xl border border-ink-line/80 bg-white shadow-card", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-ink-line/60 px-4 py-3">
          <h2 className="font-display text-[0.95rem] font-bold text-ink">{title}</h2>
          {actions}
        </div>
      )}
      <div className={cn("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, sub, tone = "default", href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "default" | "brand" | "good" | "warn"; href?: string }) {
  const inner = (
    <div
      className={cn(
        "h-full rounded-xl border p-4 shadow-card transition",
        tone === "default" && "border-ink-line/80 bg-white",
        tone === "brand" && "border-ink bg-sindoor text-white",
        tone === "good" && "border-saag/30 bg-saag-light",
        tone === "warn" && "border-besar/50 bg-besar-light",
        href && "hover:-translate-y-0.5",
      )}
    >
      <p className={cn("text-xs font-semibold uppercase tracking-wide", tone === "brand" ? "text-white/75" : "text-ink-mute")}>{label}</p>
      <p className="mt-1.5 font-display text-2xl font-bold">{value}</p>
      {sub && <p className={cn("mt-1 text-xs", tone === "brand" ? "text-white/80" : "text-ink-mute")}>{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border border-ink-line/80 bg-white shadow-card", className)}>
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("border-b border-ink-line/70 bg-paper/60 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-mute", className)}>{children}</th>;
}
export function Td({ children, className, colSpan, title }: { children?: React.ReactNode; className?: string; colSpan?: number; title?: string }) {
  return (
    <td colSpan={colSpan} title={title} className={cn("border-b border-ink-line/40 px-3 py-2.5 align-middle", className)}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, children = "Nothing here yet." }: { colSpan: number; children?: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-ink-mute">
        {children}
      </td>
    </tr>
  );
}

export function OrderBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const s = PAYMENT_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
export function SubBadge({ status }: { status: SubscriptionStatus }) {
  const s = SUB_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
export function LeadBadge({ status }: { status: LeadStatus }) {
  const s = LEAD_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Link-based pagination that keeps current query params. */
export function Pagination({ page, pages, params, basePath }: { page: number; pages: number; params: Record<string, string | undefined>; basePath: string }) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && k !== "page" && q.set(k, v));
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-ink-mute">
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link className="rounded-lg border border-ink-line bg-white px-3 py-1.5 font-medium hover:border-ink" href={href(page - 1)}>
            Previous
          </Link>
        )}
        {page < pages && (
          <Link className="rounded-lg border border-ink-line bg-white px-3 py-1.5 font-medium hover:border-ink" href={href(page + 1)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}

/** GET filter bar. Children are extra <select>/<input> controls. */
export function FilterBar({ children, q, placeholder = "Search…", action }: { children?: React.ReactNode; q?: string; placeholder?: string; action?: string }) {
  return (
    <form action={action} className="mb-4 flex flex-wrap items-end gap-2">
      <input name="q" defaultValue={q} placeholder={placeholder} className="field max-w-xs" />
      {children}
      <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Filter</button>
    </form>
  );
}

export function Tabs({ tabs, current }: { tabs: { href: string; label: string; key: string; count?: number }[]; current: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-ink-line/70 scrollbar-none">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold",
            current === t.key ? "border-sindoor text-ink" : "border-transparent text-ink-mute hover:text-ink",
          )}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 rounded-full bg-ink/5 px-1.5 text-xs">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function KV({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-mute">{k}</dt>
          <dd className="min-w-0 break-words font-medium text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Simple SVG bar chart (no chart library). */
export function BarChart({ data, height = 180, format = (n: number) => String(n), color = "#8B2923" }: { data: { label: string; value: number }[]; height?: number; format?: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  return (
    <div>
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Bar chart">
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 3 - 2);
          return (
            <rect key={i} x={i * w + w * 0.15} y={height / 3 - h} width={w * 0.7} height={Math.max(h, 0.4)} rx="0.6" fill={color} opacity={d.value ? 1 : 0.25}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-ink-mute">
        {data.map((d, i) => (
          <span key={i} className="flex-1 truncate text-center" style={{ visibility: data.length > 14 && i % Math.ceil(data.length / 10) !== 0 ? "hidden" : "visible" }}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars for rankings. */
export function RankBars({ rows, format = (n: number) => String(n) }: { rows: { label: string; value: number; sub?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-mute">No data yet.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="truncate font-medium">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink-mute">
              {format(r.value)}
              {r.sub && <span className="ml-1 text-xs">· {r.sub}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-paper-deep">
            <div className="h-2 rounded-full bg-besar" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Coloured note box. */
export function Callout({ tone = "info", title, children, className }: { tone?: "info" | "warn" | "bad" | "good"; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "info" && "border-akash/25 bg-akash-light text-ink",
        tone === "warn" && "border-besar/50 bg-besar-light text-ink",
        tone === "bad" && "border-sindoor/30 bg-sindoor-light text-sindoor-dark",
        tone === "good" && "border-saag/30 bg-saag-light text-saag-dark",
        className,
      )}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
    </div>
  );
}

/** Empty state for whole panels/pages. */
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-line bg-white/60 px-6 py-12 text-center">
      <p className="font-display text-base font-bold text-ink">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-ink-mute">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Small yes/no pill. */
export function YesNo({ value, yes = "Yes", no = "No" }: { value: boolean; yes?: string; no?: string }) {
  return <Badge tone={value ? "good" : "neutral"}>{value ? yes : no}</Badge>;
}
