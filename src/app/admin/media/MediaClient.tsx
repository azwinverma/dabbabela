"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function Uploader() {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [credit, setCredit] = useState("");
  const [placeholder, setPlaceholder] = useState(false);
  async function handle(files: FileList) {
    const list = Array.from(files);
    let ok = 0;
    const errors: string[] = [];
    for (const [i, f] of list.entries()) {
      setStatus(`Uploading ${i + 1} of ${list.length}…`);
      const fd = new FormData();
      fd.append("file", f);
      if (credit) fd.append("credit", credit);
      if (placeholder) fd.append("placeholder", "true");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (res.ok) ok++;
      else errors.push(`${f.name}: ${(await res.json().catch(() => ({}))).error ?? "failed"}`);
    }
    setStatus(errors.length ? `${ok} uploaded. ${errors.join("; ")}` : `${ok} uploaded.`);
    if (ref.current) ref.current.value = "";
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {status && <span className="text-xs text-ink-mute" role="status">{status}</span>}
      <input value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="Credit / licence (e.g. Shot in-house)" className="field h-9 w-64 py-1 text-xs" aria-label="Credit or licence for these uploads" />
      <label className="flex items-center gap-1.5 text-xs font-semibold">
        <input type="checkbox" checked={placeholder} onChange={(e) => setPlaceholder(e.target.checked)} className="accent-sindoor" />
        Placeholder
      </label>
      <button type="button" onClick={() => ref.current?.click()} className="h-9 rounded-xl border-2 border-ink bg-sindoor px-3 text-sm font-semibold text-paper-card shadow-sticker-sm">
        Upload images
      </button>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="hidden" onChange={(e) => e.target.files?.length && handle(e.target.files)} />
    </div>
  );
}

export function CopyUrl({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-xs font-semibold text-akash hover:underline"
      onClick={async () => {
        const full = url.startsWith("/") ? window.location.origin + url : url;
        await navigator.clipboard.writeText(full).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : "Copy URL"}
    </button>
  );
}
