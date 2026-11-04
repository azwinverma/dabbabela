"use client";

import { useRef, useState } from "react";

/** Image input: upload to /api/upload (Vercel Blob) or paste a URL. Submits as a hidden field. */
export function ImageField({ name, label = "Image", defaultValue = "", hint }: { name: string; label?: string; defaultValue?: string | null; hint?: string }) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setUrl(json.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={url} />
      <div className="flex items-start gap-3">
        <div className="grid h-20 w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-ink-line bg-paper">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[11px] text-ink-mute">No image</span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or upload" className="field" />
          <div className="flex gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="rounded-md border border-ink-line bg-white px-2.5 py-1 text-xs font-semibold hover:border-ink">
              {busy ? "Uploading…" : "Upload"}
            </button>
            {url && (
              <button type="button" onClick={() => setUrl("")} className="rounded-md px-2.5 py-1 text-xs font-semibold text-sindoor hover:bg-sindoor-light">
                Remove
              </button>
            )}
          </div>
          {hint && <p className="text-xs text-ink-mute">{hint}</p>}
          {err && <p className="text-xs font-medium text-sindoor">{err}</p>}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
    </div>
  );
}
