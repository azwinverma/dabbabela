/** Customer-side loading skeleton (server-safe; used from loading.tsx files under src/app/(site)). */
export function SiteLoading({ label = "Loading…", rows = 4, aside = false }: { label?: string; rows?: number; aside?: boolean }) {
  const bar = "block animate-pulse rounded-lg bg-ink/[0.07]";
  return (
    <div role="status" aria-live="polite" className={aside ? "grid gap-8 lg:grid-cols-[1fr_320px]" : ""}>
      <span className="sr-only">{label}</span>
      <div className="space-y-3">
        <span aria-hidden className={`${bar} h-8 w-56`} />
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} aria-hidden className={`${bar} h-16 w-full rounded-xl`} />
        ))}
      </div>
      {aside && (
        <div className="hidden space-y-4 lg:block">
          <span aria-hidden className={`${bar} h-28 w-full rounded-2xl`} />
          <span aria-hidden className={`${bar} h-40 w-full rounded-2xl`} />
        </div>
      )}
    </div>
  );
}
