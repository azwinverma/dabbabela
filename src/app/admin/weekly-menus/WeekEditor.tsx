"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/ActionForm";
import type { ActionResult } from "@/lib/action";
import type { DayInput } from "./actions";

type Box = { id: string; name: string; isVeg: boolean; price: string; isActive: boolean };
const LABEL: Record<string, string> = { SUN: "Sunday", MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday" };

export function WeekEditor({
  boxes,
  kitchens,
  initial,
  meta,
  dates,
  save,
}: {
  boxes: Box[];
  kitchens: { id: string; name: string }[];
  initial: DayInput[];
  meta: { title: string; note: string; kitchenId: string | null };
  dates: Record<string, string> | null;
  save: (meta: { title: string; note: string; kitchenId: string | null }, days: DayInput[]) => Promise<ActionResult>;
}) {
  const [days, setDays] = useState<DayInput[]>(initial);
  const [m, setM] = useState(meta);
  const [res, setRes] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const upd = (di: number, fn: (d: DayInput) => DayInput) => setDays((ds) => ds.map((d, i) => (i === di ? fn(d) : d)));

  return (
    <div>
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <label>
          <span className="label">Title</span>
          <input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} className="field" />
        </label>
        <label>
          <span className="label">Kitchen</span>
          <select value={m.kitchenId ?? ""} onChange={(e) => setM({ ...m, kitchenId: e.target.value || null })} className="field">
            <option value="">All kitchens</option>
            {kitchens.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Internal note</span>
          <input value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} className="field" />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {days.map((d, di) => (
          <section key={d.day} className={`rounded-xl border bg-white p-3 shadow-card ${d.isClosed ? "border-dashed border-ink-line opacity-75" : "border-ink-line/80"}`} aria-label={LABEL[d.day]}>
            <header className="mb-2 flex items-center justify-between">
              <h3 className="font-display font-bold">
                {LABEL[d.day]} {dates && <span className="text-xs font-medium text-ink-mute">{dates[d.day]}</span>}
              </h3>
              <label className="flex items-center gap-1.5 text-xs font-semibold">
                <input type="checkbox" checked={d.isClosed} onChange={(e) => upd(di, (x) => ({ ...x, isClosed: e.target.checked }))} className="accent-sindoor" />
                Closed
              </label>
            </header>
            {!d.isClosed && (
              <>
                <ul className="space-y-2">
                  {d.items.map((it, ii) => {
                    const b = byId.get(it.boxId);
                    return (
                      <li key={it.boxId} className="rounded-lg border border-ink-line/60 p-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex min-w-0 items-center gap-2">
                            <input type="radio" name={`primary-${d.day}`} checked={it.isPrimary} onChange={() => upd(di, (x) => ({ ...x, items: x.items.map((y, j) => ({ ...y, isPrimary: j === ii })) }))} className="accent-sindoor" aria-label={`Chef's pick: ${b?.name}`} />
                            <span className="truncate font-medium">{b?.name ?? "Unknown"}</span>
                            <span className={`text-[10px] font-bold uppercase ${b?.isVeg ? "text-saag" : "text-sindoor"}`}>{b?.isVeg ? "veg" : "non-veg"}</span>
                          </label>
                          <span className="flex shrink-0 gap-1">
                            <button type="button" disabled={ii === 0} onClick={() => upd(di, (x) => { const c = [...x.items]; [c[ii - 1], c[ii]] = [c[ii], c[ii - 1]]; return { ...x, items: c }; })} className="px-1 text-xs text-ink-mute disabled:opacity-30" aria-label="Move up">▲</button>
                            <button type="button" onClick={() => upd(di, (x) => { const items = x.items.filter((_, j) => j !== ii); if (items.length && !items.some((y) => y.isPrimary)) items[0] = { ...items[0], isPrimary: true }; return { ...x, items }; })} className="px-1 text-xs font-bold text-sindoor" aria-label={`Remove ${b?.name}`}>✕</button>
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                          <label>
                            <span className="text-ink-mute">Capacity</span>
                            <input value={it.capacity} onChange={(e) => upd(di, (x) => ({ ...x, items: x.items.map((y, j) => (j === ii ? { ...y, capacity: e.target.value } : y)) }))} placeholder="∞" inputMode="numeric" className="field py-1 text-xs" />
                          </label>
                          <label>
                            <span className="text-ink-mute">Price Rs</span>
                            <input value={it.priceOverride} onChange={(e) => upd(di, (x) => ({ ...x, items: x.items.map((y, j) => (j === ii ? { ...y, priceOverride: e.target.value } : y)) }))} placeholder={b?.price} inputMode="decimal" className="field py-1 text-xs" />
                          </label>
                          <label className="flex items-end gap-1.5 pb-1.5 font-semibold">
                            <input type="checkbox" checked={it.soldOut} onChange={(e) => upd(di, (x) => ({ ...x, items: x.items.map((y, j) => (j === ii ? { ...y, soldOut: e.target.checked } : y)) }))} className="accent-sindoor" />
                            Sold out
                          </label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    upd(di, (x) => ({ ...x, items: [...x.items, { boxId: id, isPrimary: x.items.length === 0, capacity: "", soldOut: false, priceOverride: "" }] }));
                  }}
                  className="field mt-2 text-sm"
                  aria-label={`Add a dabba on ${LABEL[d.day]}`}
                >
                  <option value="">+ Add a dabba…</option>
                  {boxes
                    .filter((b) => b.isActive && !d.items.some((i) => i.boxId === b.id))
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
                {d.items.length > 0 && !d.items.some((i) => byId.get(i.boxId)?.isVeg) && <p className="mt-1.5 text-xs font-medium text-besar-dark">No vegetarian option this day.</p>}
              </>
            )}
            <input value={d.note} onChange={(e) => upd(di, (x) => ({ ...x, note: e.target.value }))} placeholder={d.isClosed ? "Why closed? e.g. Saturday" : "Day note (shown on menu)"} className="field mt-2 py-1 text-xs" />
          </section>
        ))}
      </div>
      <div className="sticky bottom-0 mt-4 flex items-center gap-3 border-t border-ink-line/60 bg-[#F3EADB]/95 py-3 backdrop-blur">
        <button
          type="button"
          disabled={pending}
          className={buttonClass("primary", "sm")}
          onClick={() =>
            start(async () => {
              const r = await save(m, days);
              setRes(r);
              if (r.ok) router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save menu"}
        </button>
        <span className="text-xs text-ink-mute">The radio button marks the chef's pick — what rotation plans receive that day.</span>
      </div>
      {res?.message && <FormMessage ok={res.ok} message={res.message} />}
    </div>
  );
}
