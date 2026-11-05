"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminSearchAction } from "@/app/admin/_kit/actions";
import type { SearchHit, SearchGroup } from "@/app/admin/_kit/search";

const GROUP_LABEL: Record<SearchGroup, string> = { orders: "Orders", customers: "Customers", dabbas: "Dabbas", companies: "Companies" };

/**
 * Global admin search (⌘K / Ctrl+K, or "/" outside inputs). Results come from a server action that filters by
 * the user's permissions and kitchen scope. ARIA combobox + listbox; ↑/↓ move, Enter opens, Esc closes.
 */
const OPEN_EVENT = "admin:search";

/** Button that opens the (single) palette. Render as many as you like. */
export function SearchTrigger({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        "flex items-center gap-2 rounded-lg border text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-besar",
        compact ? "border-transparent p-1.5 hover:bg-ink/5" : "w-full border-white/10 bg-white/5 px-3 py-2 text-paper/60 hover:bg-white/10 hover:text-paper",
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      {compact ? <span className="sr-only">Search</span> : <span className="flex-1 text-left">Search…</span>}
      {!compact && <kbd className="rounded border border-white/15 px-1.5 text-[10px] font-semibold">⌘K</kbd>}
    </button>
  );
}

/** Mount once (AdminShell does). Owns the dialog and the keyboard shortcut. */
export function CommandPalette() {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const listId = useId();
  const titleId = useId();
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      inputRef.current?.select();
    }
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setSearched("");
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(() => {
      start(async () => {
        const res = await adminSearchAction(term);
        if (n !== seq.current) return; // a newer query is in flight
        setHits(res);
        setActive(0);
        setSearched(term);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const go = (h: SearchHit | undefined) => {
    if (!h) return;
    setOpen(false);
    router.push(h.href);
  };

  const groups = (Object.keys(GROUP_LABEL) as SearchGroup[]).map((g) => ({ g, items: hits.filter((h) => h.group === g) })).filter((x) => x.items.length);
  const ordered = groups.flatMap((x) => x.items);
  const optId = (i: number) => `${listId}-o${i}`;

  return (
    <>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        {...({ closedby: "any" } as Record<string, string>)}
        onClose={() => setOpen(false)}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget && !("closedBy" in HTMLDialogElement.prototype)) e.currentTarget.close();
        }}
        className="fixed inset-x-0 top-[12vh] m-0 mx-auto w-[min(94vw,640px)] max-w-none rounded-xl border border-ink-line/80 bg-white p-0 text-ink shadow-card [overscroll-behavior:contain] backdrop:overflow-hidden backdrop:bg-ink/40 backdrop:[overscroll-behavior:contain]"
      >
        <h2 id={titleId} className="sr-only">
          Search the control room
        </h2>
        <div className="flex items-center gap-2 border-b border-ink-line/60 px-4">
          <Search className="h-4 w-4 text-ink-mute" aria-hidden />
          <input
            ref={inputRef}
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Order number or code, customer, dabba, company…"
            role="combobox"
            aria-expanded={ordered.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={ordered.length ? optId(active) : undefined}
            aria-label="Search"
            maxLength={80}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-mute"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (ordered.length ? (a + 1) % ordered.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (ordered.length ? (a - 1 + ordered.length) % ordered.length : 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(ordered[active]);
              }
            }}
          />
          <kbd className="rounded border border-ink-line px-1.5 text-[10px] font-semibold text-ink-mute">Esc</kbd>
        </div>
        <div className="max-h-[56vh] overflow-y-auto p-2">
          <ul id={listId} role="listbox" aria-label="Results" className="space-y-2">
            {groups.map(({ g, items }) => (
              <li key={g} role="presentation">
                <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-mute" aria-hidden>
                  {GROUP_LABEL[g]}
                </p>
                <ul role="group" aria-label={GROUP_LABEL[g]}>
                  {items.map((h) => {
                    const i = ordered.indexOf(h);
                    return (
                      <li
                        key={`${h.group}-${h.id}`}
                        id={optId(i)}
                        role="option"
                        aria-selected={i === active}
                        onMouseMove={() => setActive(i)}
                        onClick={() => go(h)}
                        className={cn("cursor-pointer rounded-lg px-3 py-2", i === active ? "bg-paper" : "hover:bg-paper/50")}
                      >
                        <span className="block truncate text-sm font-medium text-ink">{h.title}</span>
                        {h.subtitle && <span className="block truncate text-xs text-ink-mute">{h.subtitle}</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          <p className="px-3 py-6 text-center text-sm text-ink-mute" aria-live="polite">
            {q.trim().length < 2 ? "Type at least 2 characters." : pending && !ordered.length ? "Searching…" : searched && !ordered.length ? `No matches for “${searched}” that you can see.` : ""}
          </p>
        </div>
      </dialog>
    </>
  );
}
