import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { hrefWith, pageCount, sortHref, PER_PAGE_OPTIONS, type ListState, type SortDir } from "@/app/admin/_kit/params";

/**
 * URL-driven data table (server component friendly: no hooks). Sorting and paging are links, so state lives in
 * the URL, survives refresh, works without JS and can be saved as a SavedView.
 *
 *   const state = parseListParams(sp, { sortable: ["createdAt", "total"], sort: "createdAt" });
 *   <DataTable basePath="/admin/x" params={flatParams(sp)} state={state} total={total} rows={rows}
 *     rowKey={(r) => r.id} columns={[{ key: "createdAt", header: "When", sortable: true, cell: (r) => … }]} />
 */
export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  /** Direction on first click (default "desc"). */
  defaultDir?: SortDir;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
};

export type Density = "compact" | "comfortable";

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  basePath,
  params = {},
  state,
  total,
  density = "compact",
  empty = "Nothing matches these filters.",
  caption,
  rowClassName,
  minWidth = 640,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  basePath: string;
  params?: Record<string, string | undefined>;
  state?: ListState;
  /** Total matching rows; enables the pager. */
  total?: number;
  density?: Density;
  empty?: React.ReactNode;
  /** Screen-reader caption (visually hidden). */
  caption?: string;
  rowClassName?: (row: T) => string | undefined;
  minWidth?: number;
}) {
  const pad = density === "compact" ? "px-3 py-2" : "px-3 py-3";
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-ink-line/80 bg-white shadow-card">
        <table className="w-full text-left text-sm" style={{ minWidth }}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => {
                const active = state?.sort === c.key;
                const ariaSort = active ? (state!.dir === "asc" ? "ascending" : "descending") : c.sortable ? "none" : undefined;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn("sticky top-0 border-b border-ink-line/70 bg-paper/60 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-mute", ALIGN[c.align ?? "left"], c.headerClassName)}
                  >
                    {c.sortable && state ? (
                      <Link
                        href={sortHref(basePath, params, state, c.key, c.defaultDir)}
                        className={cn("inline-flex items-center gap-1 rounded hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-akash", active && "text-ink")}
                        scroll={false}
                      >
                        {c.header}
                        {active ? state.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />}
                        <span className="sr-only">{active ? `, sorted ${state.dir === "asc" ? "ascending" : "descending"}` : ", sortable"}</span>
                      </Link>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-12 text-center text-sm text-ink-mute">
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={rowKey(r)} className={cn("align-top hover:bg-paper/30", rowClassName?.(r))}>
                {columns.map((c) => (
                  <td key={c.key} className={cn("border-b border-ink-line/40", pad, ALIGN[c.align ?? "left"], c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state && total !== undefined && <TablePager basePath={basePath} params={params} state={state} total={total} />}
    </div>
  );
}

/** "Showing 51–100 of 340" + page-size links + previous/next. */
export function TablePager({ basePath, params, state, total }: { basePath: string; params: Record<string, string | undefined>; state: Pick<ListState, "page" | "per">; total: number }) {
  const pages = pageCount(total, state.per);
  const from = total === 0 ? 0 : (state.page - 1) * state.per + 1;
  const to = Math.min(total, state.page * state.per);
  const link = "rounded-lg border border-ink-line bg-white px-3 py-1.5 font-medium hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-akash";
  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-ink-mute" aria-live="polite">
        {total === 0 ? "No results" : `Showing ${from.toLocaleString("en-IN")}–${to.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1 text-xs text-ink-mute">
          Rows:
          {PER_PAGE_OPTIONS.map((n) => (
            <Link key={n} href={hrefWith(basePath, params, { per: n })} aria-current={state.per === n ? "true" : undefined} className={cn("rounded px-1.5 py-0.5", state.per === n ? "bg-ink text-paper" : "hover:bg-ink/5")}>
              {n}
            </Link>
          ))}
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-2">
            {state.page > 1 ? (
              <Link className={link} href={hrefWith(basePath, params, { page: state.page - 1 })} rel="prev">
                Previous
              </Link>
            ) : (
              <span className={cn(link, "pointer-events-none opacity-40")} aria-disabled="true">
                Previous
              </span>
            )}
            <span className="tabular-nums text-ink-mute">
              {state.page} / {pages}
            </span>
            {state.page < pages ? (
              <Link className={link} href={hrefWith(basePath, params, { page: state.page + 1 })} rel="next">
                Next
              </Link>
            ) : (
              <span className={cn(link, "pointer-events-none opacity-40")} aria-disabled="true">
                Next
              </span>
            )}
          </span>
        )}
      </div>
    </nav>
  );
}
