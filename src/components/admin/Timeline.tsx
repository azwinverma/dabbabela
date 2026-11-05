import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatStamp } from "@/lib/dates";
import type { Tone } from "@/lib/labels";

/**
 * Activity timeline (order history, audit trail of one record, ticket thread).
 *   <Timeline items={[{ id, at: row.createdAt, title: "Status → Delivered", actor: "Ram", body: reason, tone: "good" }]} />
 */
export type TimelineItem = { id: string; at: Date | string; title: React.ReactNode; actor?: React.ReactNode; body?: React.ReactNode; tone?: Tone; href?: string };

const DOT: Record<Tone, string> = { neutral: "bg-ink-line", info: "bg-akash", warn: "bg-besar", good: "bg-saag", bad: "bg-sindoor", brand: "bg-sindoor" };

export function Timeline({ items, empty = "No activity yet." }: { items: TimelineItem[]; empty?: React.ReactNode }) {
  if (!items.length) return <p className="py-4 text-sm text-ink-mute">{empty}</p>;
  return (
    <ol className="relative space-y-4 border-l border-ink-line/70 pl-5">
      {items.map((it) => (
        <li key={it.id} className="relative">
          <span aria-hidden className={cn("absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white", DOT[it.tone ?? "neutral"])} />
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold text-ink">{it.href ? <Link href={it.href} className="hover:underline">{it.title}</Link> : it.title}</span>
            {it.actor && <span className="text-ink-mute">by {it.actor}</span>}
            <time dateTime={new Date(it.at).toISOString()} className="ml-auto text-xs tabular-nums text-ink-mute">
              {formatStamp(it.at)}
            </time>
          </div>
          {it.body && <div className="mt-0.5 text-sm text-ink-soft">{it.body}</div>}
        </li>
      ))}
    </ol>
  );
}
