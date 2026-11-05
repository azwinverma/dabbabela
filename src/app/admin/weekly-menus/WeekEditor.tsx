"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/ActionForm";
import type { ActionResult } from "@/lib/action";
import type { DayInput, MenuMeta } from "./actions";

type Box = { id: string; name: string; isVeg: boolean; price: string; isActive: boolean; isVisible: boolean; maxDailyQty: number | null };
const LABEL: Record<string, string> = { SUN: "Sunday", MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday" };
const KINDS = [
  { value: "STANDARD", label: "Standard week" },
  { value: "SEASONAL", label: "Seasonal (festival) week" },
  { value: "PROMO", label: "Promotional week" },
];

/** Move an item between days (drag-and-drop or the keyboard-friendly "Move to" menu). Returns null if it's already there. */
function moveItem(days: DayInput[], from: number, index: number, to: number): DayInput[] | null {
  if (from === to) return days;
  const it = days[from].items[index];
  if (!it || days[to].items.some((x) => x.boxId === it.boxId)) return null;
  return days.map((d, i) => {
    if (i === from) {
      const items = d.items.filter((_, j) => j !== index);
      if (items.length && !items.some((y) => y.isPrimary)) items[0] = { ...items[0], isPrimary: true };
      return { ...d, items };
    }
    if (i === to) return { ...d, isClosed: false, items: [...d.items, { ...it, isPrimary: d.items.length === 0 }] };
    return d;
  });
}

export function WeekEditor({
  boxes,
  kitchens,
  initial,
  meta,
  dates,
  save,
  canEdit = true,
}: {
  boxes: Box[];
  kitchens: { id: string; name: string }[];
  initial: DayInput[];
  meta: MenuMeta;
  dates: Record<string, string> | null;
  save: (meta: MenuMeta, days: DayInput[]) => Promise<ActionResult>;
  canEdit?: boolean;
}) {
  const [days, setDays] = useState<DayInput[]>(initial);
  const [m, setM] = useState(meta);
  const [res, setRes] = useState<ActionResult | null>(null);
  const [drag, setDrag] = useState<{ day: number; index: number } | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const upd = (di: number, fn: (d: DayInput) => DayInput) => setDays((ds) => ds.map((d, i) => (i === di ? fn(d) : d)));
  const updItem = (di: number, ii: number, patch: Partial<DayInput["items"][number]>) => upd(di, (x) => ({ ...x, items: x.items.map((y, j) => (j === ii ? { ...y, ...patch } : y)) }));
  const move = (from: number, index: number, to: number) => {
    const name = byId.get(days[from].items[index]?.boxId ?? "")?.name ?? "Dabba";
    const next = moveItem(days, from, index, to);
    if (!next) {
      setAnnounce(`${name} is already on ${LABEL[days[to].day]}`);
      return;
    }
    setDays(next);
    setAnnounce(`${name} moved to ${LABEL[days[to].day]}`);
  };

  return (
    <div>
      <fieldset disabled={!canEdit} className="mb-4 grid gap-3 md:grid-cols-4">
        <label>
          <span className="label">Title</span>
          <input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} className="field" />
        </label>
        <label>
          <span className="label">Kind</span>
          <select value={m.kind ?? "STANDARD"} onChange={(e) => setM({ ...m, kind: e.target.value })} className="field">
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
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
      </fieldset>
      <p className="mb-3 text-xs text-ink-mute">Drag a dabba onto another day, or use its “Move to” menu. The radio button marks the chef's pick — what rotation plans receive that day.</p>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <fieldset disabled={!canEdit} className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {days.map((d, di) => (
          <section
            key={d.day}
            className={`rounded-xl border bg-white p-3 shadow-card transition ${d.isClosed ? "border-dashed border-ink-line opacity-75" : "border-ink-line/80"} ${over === di && drag && drag.day !== di ? "ring-2 ring-sindoor" : ""}`}
            aria-label={LABEL[d.day]}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              setOver(di);
            }}
            onDragLeave={() => setOver((o) => (o === di ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (drag) move(drag.day, drag.index, di);
              setDrag(null);
              setOver(null);
            }}
          >
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
                      <li
                        key={it.boxId}
                        draggable={canEdit}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", it.boxId);
                          setDrag({ day: di, index: ii });
                        }}
                        onDragEnd={() => {
                          setDrag(null);
                          setOver(null);
                        }}
                        className={`cursor-grab rounded-lg border border-ink-line/60 p-2 text-sm active:cursor-grabbing ${drag?.day === di && drag.index === ii ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex min-w-0 items-center gap-2">
                            <span aria-hidden className="select-none text-ink-mute">⠿</span>
                            <input type="radio" name={`primary-${d.day}`} checked={it.isPrimary} onChange={() => upd(di, (x) => ({ ...x, items: x.items.map((y, j) => ({ ...y, isPrimary: j === ii })) }))} className="accent-sindoor" aria-label={`Chef's pick: ${b?.name}`} />
                            <span className="truncate font-medium">{b?.name ?? "Unknown"}</span>
                            <span className={`text-[10px] font-bold uppercase ${b?.isVeg ? "text-saag" : "text-sindoor"}`}>{b?.isVeg ? "veg" : "non-veg"}</span>
                            {b && !b.isVisible && <span className="text-[10px] font-bold uppercase text-ink-mute">hidden</span>}
                          </label>
                          <span className="flex shrink-0 gap-1">
                            <button type="button" disabled={ii === 0} onClick={() => upd(di, (x) => { const c = [...x.items]; [c[ii - 1], c[ii]] = [c[ii], c[ii - 1]]; return { ...x, items: c }; })} className="px-1 text-xs text-ink-mute disabled:opacity-30" aria-label={`Move ${b?.name} up`}>▲</button>
                            <button type="button" onClick={() => upd(di, (x) => { const items = x.items.filter((_, j) => j !== ii); if (items.length && !items.some((y) => y.isPrimary)) items[0] = { ...items[0], isPrimary: true }; return { ...x, items }; })} className="px-1 text-xs font-bold text-sindoor" aria-label={`Remove ${b?.name}`}>✕</button>
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                          <label>
                            <span className="text-ink-mute">Qty / day</span>
                            <input value={it.capacity} onChange={(e) => updItem(di, ii, { capacity: e.target.value })} placeholder={b?.maxDailyQty != null ? `≤${b.maxDailyQty}` : "∞"} inputMode="numeric" className="field py-1 text-xs" />
                          </label>
                          <label>
                            <span className="text-ink-mute">Price Rs</span>
                            <input value={it.priceOverride} onChange={(e) => updItem(di, ii, { priceOverride: e.target.value })} placeholder={b?.price} inputMode="decimal" className="field py-1 text-xs" />
                          </label>
                          <label className="flex items-end gap-1.5 pb-1.5 font-semibold">
                            <input type="checkbox" checked={it.soldOut} onChange={(e) => updItem(di, ii, { soldOut: e.target.checked })} className="accent-sindoor" />
                            Sold out
                          </label>
                          <label className="col-span-2">
                            <span className="text-ink-mute">If sold out, offer</span>
                            <select value={it.replacementBoxId ?? ""} onChange={(e) => updItem(di, ii, { replacementBoxId: e.target.value })} className="field py-1 text-xs">
                              <option value="">No replacement</option>
                              {d.items
                                .filter((y) => y.boxId !== it.boxId)
                                .map((y) => (
                                  <option key={y.boxId} value={y.boxId}>
                                    {byId.get(y.boxId)?.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            <span className="text-ink-mute">Move to</span>
                            <select value="" onChange={(e) => e.target.value !== "" && move(di, ii, Number(e.target.value))} className="field py-1 text-xs" aria-label={`Move ${b?.name} to another day`}>
                              <option value="">—</option>
                              {days.map((t, ti) =>
                                ti === di ? null : (
                                  <option key={t.day} value={ti}>
                                    {LABEL[t.day]}
                                  </option>
                                ),
                              )}
                            </select>
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
                    upd(di, (x) => ({ ...x, items: [...x.items, { boxId: id, isPrimary: x.items.length === 0, capacity: "", soldOut: false, priceOverride: "", replacementBoxId: "" }] }));
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
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-ink-mute">Cut-off on the day</span>
                  <input type="time" value={d.cutoffOverride ?? ""} onChange={(e) => upd(di, (x) => ({ ...x, cutoffOverride: e.target.value }))} className="field w-auto py-1 text-xs" aria-label={`Cut-off override for ${LABEL[d.day]}`} />
                  <span className="text-ink-mute">(blank = default)</span>
                </label>
              </>
            )}
            <input value={d.note} onChange={(e) => upd(di, (x) => ({ ...x, note: e.target.value }))} placeholder={d.isClosed ? "Why closed? e.g. Saturday" : "Day note (shown on menu)"} className="field mt-2 py-1 text-xs" />
          </section>
        ))}
      </fieldset>
      {canEdit && (
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
          <span className="text-xs text-ink-mute">Qty / day is capped by the dabba's own max per day.</span>
        </div>
      )}
      {res?.message && <FormMessage ok={res.ok} message={res.message} />}
    </div>
  );
}
