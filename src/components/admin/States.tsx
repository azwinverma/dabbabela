import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/labels";
import { Badge } from "@/components/ui/Badge";

export { EmptyState } from "./ui";

/** Grey placeholder bar. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded bg-ink/[0.07]", className)} />;
}

/** Loading placeholder for a page (use from a route's loading.tsx). */
export function LoadingState({ label = "Loading…", rows = 8 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="rounded-xl border border-ink-line/80 bg-white p-3 shadow-card">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex gap-4 border-b border-ink-line/30 py-2.5 last:border-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Error panel (use from error.tsx, or inline when a panel's query fails). */
export function ErrorState({ title = "Something went wrong", children, retry, homeHref = "/admin" }: { title?: string; children?: React.ReactNode; retry?: () => void; homeHref?: string }) {
  return (
    <div role="alert" className="rounded-xl border border-sindoor/25 bg-white px-6 py-10 text-center shadow-card">
      <AlertTriangle className="mx-auto h-6 w-6 text-sindoor" aria-hidden />
      <p className="mt-2 font-display text-base font-bold text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-mute">{children}</div>}
      <div className="mt-4 flex justify-center gap-2">
        {retry && (
          <button type="button" onClick={retry} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-ink-soft">
            Try again
          </button>
        )}
        <Link href={homeHref} className="rounded-lg border border-ink-line px-4 py-2 text-sm font-medium hover:border-ink">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

/**
 * Generic status badge from a lookup map (`labels.ts` maps are `{ label, tone }`).
 *   <StatusBadge status={t.status} map={TICKET_STATUS} />
 */
export function StatusBadge<S extends string>({ status, map, className }: { status: S; map: Partial<Record<S, { label: string; tone: Tone }>>; className?: string }) {
  const s = map[status];
  return (
    <Badge tone={s?.tone ?? "neutral"} className={className}>
      {s?.label ?? status.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}

/** Small dot + label, quieter than a pill (for dense tables). */
export function StatusDot({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  const dot: Record<Tone, string> = { neutral: "bg-ink-mute", info: "bg-akash", warn: "bg-besar", good: "bg-saag", bad: "bg-sindoor", brand: "bg-sindoor" };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-soft">
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", dot[tone])} />
      {children}
    </span>
  );
}
