import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Checkbox } from "@/components/ui/Fields";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { Badge } from "@/components/ui/Badge";
import { can } from "@/lib/permissions";
import { formatStamp } from "@/lib/dates";
import { policyRevisions } from "@/lib/cms/policies";
import { savePage, deletePage, restorePageRevision } from "../actions";

export default async function PageEdit({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("content.view");
  const { id } = await params;
  const p = id === "new" ? null : await db.page.findUnique({ where: { id } });
  if (id !== "new" && !p) notFound();
  const revisions = p ? await policyRevisions(p.id) : [];
  const canPublish = can(user, "content.publish");
  const names = new Map((await db.user.findMany({ where: { id: { in: revisions.map((r) => r.actorId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <>
      <PageHeader
        title={p ? p.title : "New page"}
        back={{ href: "/admin/pages?tab=policies", label: "Policies & info pages" }}
        actions={
          p && (
            <>
              <Link href={`/info/${p.slug}`} target="_blank" className={buttonClass("outline", "sm")}>
                View
              </Link>
              {canPublish && <ConfirmAction action={deletePage.bind(null, p.id)} label="Delete" variant="danger" confirm="Delete this page?" />}
            </>
          )
        }
      />
      <ActionForm action={savePage.bind(null, p?.id ?? null)} className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Panel>
          <div className="space-y-4">
            <Input name="title" label="Title" defaultValue={p?.title} required />
            <Textarea name="body" label="Body (Markdown)" hint="## Heading, - list item, **bold**, [link](https://…). Raw HTML is shown as text." defaultValue={p?.body ?? ""} rows={18} className="font-mono" />
            <Input name="titleNe" label="शीर्षक (Nepali title)" defaultValue={p?.titleNe ?? ""} className="lang-ne" />
            <Textarea name="bodyNe" label="Nepali body (optional — English is shown when empty)" defaultValue={p?.bodyNe ?? ""} rows={10} className="lang-ne font-mono" />
          </div>
        </Panel>
        <div className="space-y-6">
          <Panel title="Publishing">
            <div className="space-y-3">
              <Input name="slug" label="Slug" defaultValue={p?.slug} hint="Auto from title if empty" />
              <Checkbox name="published" label="Published" defaultChecked={p?.published ?? true} />
              <Checkbox name="showInFooter" label="Link in footer" defaultChecked={p?.showInFooter ?? true} />
              <Checkbox name="needsLegalReview" label="Needs legal review" hint="Shows a 'draft policy' notice until a lawyer signs off" defaultChecked={p?.needsLegalReview ?? true} />
            </div>
          </Panel>
          <Panel title="Search engines">
            <div className="space-y-3">
              <Input name="seoTitle" label="SEO title" defaultValue={p?.seoTitle ?? ""} />
              <Textarea name="seoDescription" label="SEO description" defaultValue={p?.seoDescription ?? ""} rows={3} />
            </div>
          </Panel>
          <SubmitButton>Save page</SubmitButton>
          {!canPublish && <p className="text-xs text-ink-mute">You can edit unpublished pages. Changing a published page needs the content publish permission.</p>}
        </div>
      </ActionForm>
      {p && (
        <Panel title="Revision history" className="mt-6" bodyClass="p-0">
          <ul className="divide-y divide-ink-line/50">
            {revisions.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-mute">No revisions yet — the first save records one.</li>}
            {revisions.map((r, i) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {r.title} {i === 0 && <Badge tone="good">current</Badge>}
                  </p>
                  <p className="text-xs text-ink-mute">
                    {formatStamp(r.createdAt)} · {r.actorId ? (names.get(r.actorId) ?? "staff") : "system"} · {r.body.length.toLocaleString()} characters
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-akash">Show text</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-paper p-3 font-mono text-xs">{r.body}</pre>
                  </details>
                </div>
                {canPublish && i > 0 && <ConfirmAction action={restorePageRevision.bind(null, p.id, r.id)} label="Restore" confirm="Replace the current text with this revision? (The current text stays in the history.)" />}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
