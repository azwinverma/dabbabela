"use client";

import { useState } from "react";
import type { Field } from "@/lib/cms";

type Data = Record<string, any>;

function blank(fields: Field[]): Data {
  return Object.fromEntries(fields.map((f) => [f.name, f.type === "boolean" ? false : f.type === "number" ? 0 : f.type === "list" ? [] : ""]));
}

function ImageInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-md border border-dashed border-ink-line bg-paper">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] text-ink-mute">None</span>}
      </div>
      <div className="flex-1 space-y-1.5">
        <input className="field" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… or upload" />
        <div className="flex gap-2">
          <label className="cursor-pointer rounded-md border border-ink-line bg-white px-2.5 py-1 text-xs font-semibold hover:border-ink">
            {busy ? "Uploading…" : "Upload"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                setErr("");
                const fd = new FormData();
                fd.append("file", file);
                const res = await fetch("/api/upload", { method: "POST", body: fd });
                const json = await res.json().catch(() => ({}));
                setBusy(false);
                if (res.ok) onChange(json.url);
                else setErr(json.error || "Upload failed");
              }}
            />
          </label>
          {value && (
            <button type="button" className="text-xs font-semibold text-sindoor" onClick={() => onChange("")}>
              Remove
            </button>
          )}
        </div>
        {err && <p className="text-xs text-sindoor">{err}</p>}
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange, placeholder, id }: { field: Field; value: any; onChange: (v: any) => void; placeholder?: string; id?: string }) {
  switch (field.type) {
    case "textarea":
      return <textarea id={id} className="field" rows={3} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "markdown":
      return <textarea id={id} className="field font-mono text-[13px]" rows={10} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input id={id} type="checkbox" className="h-4 w-4 accent-sindoor" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {value ? "On" : "Off"}
        </label>
      );
    case "number":
      return <input id={id} type="number" className="field" value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} />;
    case "image":
      return <ImageInput value={value ?? ""} onChange={onChange} />;
    case "list":
      return <ListInput field={field} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    default:
      return <input id={id} className="field" type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? (field.type === "url" ? "/menu or https://…" : undefined)} />;
  }
}

function ListInput({ field, value, onChange }: { field: Field; value: Data[]; onChange: (v: Data[]) => void }) {
  const sub = field.fields ?? [];
  const move = (i: number, d: number) => {
    const next = [...value];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {value.map((row, i) => (
        <div key={i} className="rounded-lg border border-ink-line/70 bg-paper/50 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-bold uppercase tracking-wide text-ink-mute">
              {field.itemLabel ?? "Item"} {i + 1}
            </span>
            <span className="flex gap-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded px-1.5 py-0.5 hover:bg-white disabled:opacity-30" aria-label="Move up">
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="rounded px-1.5 py-0.5 hover:bg-white disabled:opacity-30" aria-label="Move down">
                ↓
              </button>
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded px-1.5 py-0.5 font-semibold text-sindoor hover:bg-white">
                Remove
              </button>
            </span>
          </div>
          <div className={sub.length > 1 && sub.every((s) => s.type === "text") ? "grid gap-3 md:grid-cols-2" : "space-y-3"}>
            {sub.map((sf) => (
              <div key={sf.name}>
                <span className="label">{sf.label}</span>
                <FieldInput field={sf} value={row[sf.name]} onChange={(v) => onChange(value.map((r, j) => (j === i ? { ...r, [sf.name]: v } : r)))} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, blank(sub)])} className="rounded-lg border border-dashed border-ink-line px-3 py-2 text-sm font-semibold text-ink-soft hover:border-ink hover:text-ink">
        + Add {(field.itemLabel ?? "item").toLowerCase()}
      </button>
    </div>
  );
}

/** `placeholders` (optional) shows the English value inside empty Nepali fields. */
export function SectionEditor({ fields, initial, placeholders }: { fields: Field[]; initial: Data; placeholders?: Data }) {
  const [data, setData] = useState<Data>(initial);
  return (
    <div className="space-y-5">
      <input type="hidden" name="data" value={JSON.stringify(data)} />
      {fields.map((f) => (
        <div key={f.name}>
          {/* Simple fields get a real <label>; lists and images have their own controls. */}
          {f.type === "list" || f.type === "image" ? (
            <span className="label">{f.label}</span>
          ) : (
            <label htmlFor={`cms-${f.name}`} className="label">
              {f.label}
            </label>
          )}
          <FieldInput id={`cms-${f.name}`} field={f} value={data[f.name]} placeholder={placeholders && typeof placeholders[f.name] === "string" ? String(placeholders[f.name]).slice(0, 140) : undefined} onChange={(v) => setData((d) => ({ ...d, [f.name]: v }))} />
          {f.help && <p className="mt-1 text-xs text-ink-mute">{f.help}</p>}
          {placeholders && f.type === "list" && <p className="mt-1 text-xs text-ink-mute">Leave empty to show the English list.</p>}
          {f.type === "markdown" && <p className="mt-1 text-xs text-ink-mute">Markdown: blank line between paragraphs, ## for headings, *word* for the marker style, - for lists.</p>}
        </div>
      ))}
    </div>
  );
}
