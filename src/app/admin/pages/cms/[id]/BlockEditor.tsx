"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/ActionForm";
import type { ActionResult } from "@/lib/action";
import { BLOCK_DEFS, BLOCK_MAP, blockFromDefaults, newBlockId, validateBlocks, type Block } from "@/lib/cms/blocks";
import { FieldInput } from "../../../content/SectionEditor";

type Save = (blocksJson: string, intent: "draft" | "publish" | "schedule", publishAt?: string) => Promise<ActionResult>;

function summary(b: Block) {
  const d = b.data as Record<string, unknown>;
  const s = d.title ?? d.heading ?? d.text ?? d.caption ?? d.alt ?? "";
  return typeof s === "string" ? s.slice(0, 70) : "";
}

/** Add / reorder / hide / edit blocks for one locale. Validation runs here for quick feedback and again on the server. */
export function BlockEditor({ initial, save, canPublish, previewHref }: { initial: Block[]; save: Save; canPublish: boolean; previewHref: string }) {
  const [blocks, setBlocks] = useState<Block[]>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [addType, setAddType] = useState(BLOCK_DEFS[0]!.type);
  const [when, setWhen] = useState("");
  const [res, setRes] = useState<ActionResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const update = (fn: (b: Block[]) => Block[]) => {
    setBlocks(fn);
    setDirty(true);
  };
  const move = (i: number, by: number) =>
    update((b) => {
      const j = i + by;
      if (j < 0 || j >= b.length) return b;
      const c = [...b];
      [c[i], c[j]] = [c[j]!, c[i]!];
      return c;
    });
  const check = validateBlocks(blocks);
  const errorsAt = new Map(check.ok ? [] : check.errors.map((e) => [e.index, e.message]));

  const submit = (intent: "draft" | "publish" | "schedule") =>
    start(async () => {
      const r = await save(JSON.stringify(blocks), intent, intent === "schedule" ? when : undefined);
      setRes(r);
      if (r.ok) {
        setDirty(false);
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <ol className="space-y-2">
        {blocks.length === 0 && <li className="rounded-lg border border-dashed border-ink-line px-4 py-8 text-center text-sm text-ink-mute">No blocks yet — add one below.</li>}
        {blocks.map((b, i) => {
          const def = BLOCK_MAP[b.type];
          const err = errorsAt.get(i);
          return (
            <li key={b.id} className={`rounded-lg border ${err ? "border-sindoor" : b.visible ? "border-ink-line/70" : "border-dashed border-ink-line"} bg-white`}>
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="w-5 text-xs tabular-nums text-ink-mute">{i + 1}</span>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
                  <span className="font-semibold">{def?.label ?? b.type}</span>
                  <span className={`ml-2 truncate text-xs ${b.visible ? "text-ink-mute" : "text-ink-mute line-through"}`}>{summary(b)}</span>
                </button>
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" className="accent-sindoor" checked={b.visible} onChange={(e) => update((x) => x.map((y, j) => (j === i ? { ...y, visible: e.target.checked } : y)))} />
                  Show
                </label>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded px-1.5 text-xs disabled:opacity-30" aria-label={`Move block ${i + 1} up`}>
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="rounded px-1.5 text-xs disabled:opacity-30" aria-label={`Move block ${i + 1} down`}>
                  ↓
                </button>
                <button type="button" onClick={() => update((x) => [...x.slice(0, i + 1), { ...structuredClone(b), id: newBlockId() }, ...x.slice(i + 1)])} className="rounded px-1.5 text-xs" aria-label={`Duplicate block ${i + 1}`}>
                  ⧉
                </button>
                <button
                  type="button"
                  onClick={() => window.confirm("Remove this block?") && update((x) => x.filter((_, j) => j !== i))}
                  className="rounded px-1.5 text-xs font-semibold text-sindoor"
                  aria-label={`Remove block ${i + 1}`}
                >
                  ✕
                </button>
              </div>
              {err && <p className="px-3 pb-2 text-xs font-medium text-sindoor">{err}</p>}
              {open === b.id && def && (
                <div className="space-y-4 border-t border-ink-line/60 bg-paper/40 p-4">
                  <p className="text-xs text-ink-mute">{def.description}</p>
                  {def.fields.map((fl) => (
                    <div key={fl.name}>
                      {fl.type === "list" || fl.type === "image" ? (
                        <span className="label">{fl.label}</span>
                      ) : (
                        <label htmlFor={`${b.id}-${fl.name}`} className="label">
                          {fl.label}
                        </label>
                      )}
                      <FieldInput
                        id={`${b.id}-${fl.name}`}
                        field={fl}
                        value={(b.data as Record<string, unknown>)[fl.name]}
                        onChange={(v) => update((x) => x.map((y, j) => (j === i ? { ...y, data: { ...y.data, [fl.name]: v } } : y)))}
                      />
                      {fl.help && <p className="mt-1 text-xs text-ink-mute">{fl.help}</p>}
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-ink-line/70 bg-paper/50 p-3">
        <label className="min-w-[220px] flex-1">
          <span className="label">Add a block</span>
          <select className="field" value={addType} onChange={(e) => setAddType(e.target.value)}>
            {BLOCK_DEFS.map((d) => (
              <option key={d.type} value={d.type}>
                {d.label} — {d.description.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={buttonClass("outline", "sm")}
          onClick={() => {
            const nb = blockFromDefaults(addType);
            update((x) => [...x, nb]);
            setOpen(nb.id);
          }}
        >
          + Add
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-ink-line/60 pt-4">
        <button type="button" disabled={pending} onClick={() => submit("draft")} className={buttonClass("dark", "sm")}>
          {pending ? "Saving…" : "Save draft"}
        </button>
        {canPublish && (
          <>
            <button type="button" disabled={pending || !check.ok} onClick={() => submit("publish")} className={buttonClass("primary", "sm")}>
              Save &amp; publish now
            </button>
            <span className="flex items-center gap-1.5">
              <input type="datetime-local" className="field h-9 w-auto py-1 text-sm" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Publish at (Kathmandu time)" />
              <button type="button" disabled={pending || !when || !check.ok} onClick={() => submit("schedule")} className={buttonClass("outline", "sm")}>
                Schedule
              </button>
            </span>
          </>
        )}
        <a href={previewHref} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
          Preview draft ↗
        </a>
        {dirty && <span className="text-xs font-semibold text-besar-dark">Unsaved changes</span>}
      </div>
      {!canPublish && <p className="text-xs text-ink-mute">You can save drafts. Someone with the publish permission puts them live.</p>}
      {res?.message && <FormMessage ok={res.ok} message={res.message} />}
    </div>
  );
}
