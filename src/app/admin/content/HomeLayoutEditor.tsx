"use client";

import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/ActionForm";
import type { ActionResult } from "@/lib/action";

type Block = { key: string; visible: boolean };

export function HomeLayoutEditor({ initial, labels, save }: { initial: Block[]; labels: Record<string, string>; save: (b: Block[]) => Promise<ActionResult> }) {
  const [blocks, setBlocks] = useState(initial);
  const [res, setRes] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const move = (i: number, by: number) =>
    setBlocks((b) => {
      const j = i + by;
      if (j < 0 || j >= b.length) return b;
      const c = [...b];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  return (
    <div>
      <ol className="space-y-1.5">
        {blocks.map((b, i) => (
          <li key={b.key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${b.visible ? "border-ink-line/70 bg-white" : "border-dashed border-ink-line bg-paper/50 text-ink-mute"}`}>
            <span className="w-5 text-xs tabular-nums text-ink-mute">{i + 1}</span>
            <span className="flex-1 font-medium">{labels[b.key] ?? b.key}</span>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={b.visible} onChange={(e) => setBlocks((x) => x.map((y, j) => (j === i ? { ...y, visible: e.target.checked } : y)))} className="accent-sindoor" />
              Show
            </label>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded px-1.5 text-xs disabled:opacity-30" aria-label={`Move ${labels[b.key]} up`}>
              ↑
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="rounded px-1.5 text-xs disabled:opacity-30" aria-label={`Move ${labels[b.key]} down`}>
              ↓
            </button>
          </li>
        ))}
      </ol>
      <button type="button" disabled={pending} onClick={() => start(async () => setRes(await save(blocks)))} className={buttonClass("dark", "sm", "mt-3")}>
        {pending ? "Saving…" : "Save layout"}
      </button>
      {res?.message && <FormMessage ok={res.ok} message={res.message} />}
    </div>
  );
}
