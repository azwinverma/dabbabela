"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/ui/Button";
import { hrefWith, sameView, serializeView } from "@/app/admin/_kit/params";
import { deleteViewAction, saveViewAction } from "@/app/admin/_kit/actions";
import { Dialog } from "./Dialog";

/**
 * Saved filters for a list page (private to the signed-in staff member).
 * The page loads views server-side with `listSavedViews(user.id, module)` and passes them in with the current params.
 *
 *   <SavedViews module="audit" basePath="/admin/audit" current={flatParams(sp)} views={views} />
 */
export function SavedViews({ module, basePath, current, views }: { module: string; basePath: string; current: Record<string, string>; views: { id: string; name: string; query: Record<string, string> }[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const hasFilters = Object.keys(serializeView(current)).length > 0;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Saved views" role="group">
      <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-mute">
        <Bookmark className="h-3.5 w-3.5" aria-hidden /> Views
      </span>
      <Link href={basePath} aria-current={!hasFilters ? "page" : undefined} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", !hasFilters ? "border-ink bg-ink text-paper" : "border-ink-line bg-white hover:border-ink")}>
        All
      </Link>
      {views.map((v) => {
        const active = sameView(v.query, current);
        return (
          <span key={v.id} className={cn("inline-flex items-center rounded-full border text-xs font-medium", active ? "border-ink bg-ink text-paper" : "border-ink-line bg-white")}>
            <Link href={hrefWith(basePath, v.query)} aria-current={active ? "page" : undefined} className="py-1 pl-2.5 pr-1 hover:underline">
              {v.name}
            </Link>
            <button
              type="button"
              aria-label={`Delete view ${v.name}`}
              disabled={pending}
              className={cn("mr-1 rounded-full p-0.5", active ? "hover:bg-white/15" : "text-ink-mute hover:bg-ink/5 hover:text-ink")}
              onClick={() => {
                if (!window.confirm(`Delete the view “${v.name}”?`)) return;
                start(async () => {
                  await deleteViewAction(v.id, basePath);
                  router.refresh();
                });
              }}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        );
      })}
      {hasFilters && !views.some((v) => sameView(v.query, current)) && (
        <button type="button" onClick={() => (setName(""), setError(null), setOpen(true))} className="rounded-full border border-dashed border-ink-line px-2.5 py-1 text-xs font-medium text-ink-mute hover:border-ink hover:text-ink" aria-haspopup="dialog">
          + Save current filters
        </button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Save view" description="Only you see saved views. They keep the filters and sort order, not the page number.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await saveViewAction(module, basePath, name, current);
              if (!res.ok) return setError(res.message ?? "Couldn't save");
              setOpen(false);
              router.refresh();
            });
          }}
          className="space-y-3"
        >
          <div>
            <label htmlFor="saved-view-name" className="mb-1 block text-xs font-semibold text-ink-soft">
              Name
            </label>
            <input id="saved-view-name" autoFocus required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className="field" placeholder="e.g. Refund approvals this month" aria-describedby="saved-view-error" />
          </div>
          <p id="saved-view-error" role="alert" className={cn("text-sm text-sindoor-dark", !error && "sr-only")}>
            {error ?? ""}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("outline", "sm")} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" disabled={pending || !name.trim()} className={buttonClass("dark", "sm")}>
              {pending ? "Saving…" : "Save view"}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
