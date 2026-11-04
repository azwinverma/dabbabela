import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Callout, EmptyState, Pagination } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { CopyUrl, Uploader } from "./MediaClient";
import { deleteMedia, saveMediaMeta } from "./actions";

const PER = 24;

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ page?: string; filter?: string }> }) {
  await requirePermission("media");
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where = sp.filter === "placeholder" ? { isPlaceholder: true } : sp.filter === "nocredit" ? { credit: null } : {};
  const [items, total] = await Promise.all([db.mediaAsset.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }), db.mediaAsset.count({ where })]);
  return (
    <>
      <PageHeader title="Media library" description="JPG, PNG, WEBP or AVIF up to 5 MB, stored in Vercel Blob." actions={<Uploader />} />
      <Callout tone="info" className="mb-4">
        Use your own food photography or images you have a licence for, and record the credit. Mark stand-ins as <b>placeholder</b> so they're replaced before launch.
      </Callout>
      <div className="mb-4 flex gap-3 text-sm">
        {[["", "All"], ["placeholder", "Placeholders"], ["nocredit", "Missing credit"]].map(([k, l]) => (
          <a key={k} href={k ? `/admin/media?filter=${k}` : "/admin/media"} className={(sp.filter ?? "") === k ? "font-semibold text-ink underline" : "text-ink-mute hover:text-ink"}>
            {l}
          </a>
        ))}
      </div>
      {items.length === 0 ? (
        <EmptyState title="No images here">Upload real photos of your dabbas and kitchen.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {items.map((m) => (
            <div key={m.id} className="overflow-hidden rounded-xl border border-ink-line/80 bg-white shadow-card">
              <div className="relative aspect-[4/3] bg-paper">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt={m.alt ?? ""} className="h-full w-full object-cover" loading="lazy" />
                {m.isPlaceholder && <Badge tone="warn" className="absolute left-2 top-2">placeholder</Badge>}
              </div>
              <div className="space-y-2 p-3">
                <p className="truncate text-xs font-semibold" title={m.name}>
                  {m.name}
                </p>
                <p className="text-[11px] text-ink-mute">
                  {Math.round(m.size / 1024)} KB · {formatStamp(m.createdAt)}
                </p>
                <ActionForm action={saveMediaMeta.bind(null, m.id)} className="space-y-1.5">
                  <input name="alt" defaultValue={m.alt ?? ""} placeholder="Alt text (what's in the photo)" className="field py-1 text-xs" aria-label="Alt text" />
                  <input name="credit" defaultValue={m.credit ?? ""} placeholder="Credit / licence" className="field py-1 text-xs" aria-label="Credit" />
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" name="isPlaceholder" defaultChecked={m.isPlaceholder} className="accent-sindoor" /> Placeholder
                  </label>
                  <div className="flex items-center justify-between">
                    <CopyUrl url={m.url} />
                    <SubmitButton size="sm" variant="ghost">
                      Save
                    </SubmitButton>
                  </div>
                </ActionForm>
                <div className="text-right">
                  <ConfirmAction action={deleteMedia.bind(null, m.id)} label="Delete" variant="ghost" confirm="Delete this file? (Blocked if it's still used somewhere.)" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(total / PER)} params={{ filter: sp.filter }} basePath="/admin/media" />
    </>
  );
}
