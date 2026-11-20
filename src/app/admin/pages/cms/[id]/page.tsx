import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatStamp } from "@/lib/dates";
import { isLocale, type Locale } from "@/lib/i18n";
import { HOME_SLUG, liveVersion, pageWithVersions } from "@/lib/cms/pages";
import { renderableBlocks, validateBlocks, type Block } from "@/lib/cms/blocks";
import { PageHeader, Panel, Tabs, Callout, Table, Th, Td } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Checkbox } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { ImageField } from "@/components/admin/ImageField";
import { BlockEditor } from "./BlockEditor";
import {
  cancelScheduleAction,
  deletePageAction,
  discardDraftAction,
  republishPageAction,
  restoreVersionAction,
  saveBlocksAction,
  savePageMetaAction,
  savePageSeoAction,
  unpublishPageAction,
} from "../actions";

const STATUS_TONE: Record<string, "good" | "warn" | "neutral" | "bad"> = { PUBLISHED: "good", SCHEDULED: "warn", DRAFT: "neutral", SUPERSEDED: "neutral", ARCHIVED: "bad" };

export default async function CmsPageEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ locale?: string }> }) {
  const user = await requirePermission("content.view");
  const { id } = await params;
  const sp = await searchParams;
  const locale: Locale = isLocale(sp.locale) ? sp.locale : "en";
  const page = await pageWithVersions(id);
  if (!page) notFound();
  const versions = page.versions.filter((v) => v.locale === locale);
  const draft = versions.find((v) => v.status === "DRAFT");
  const live = await liveVersion(page.id, locale);
  const enLive = locale === "ne" ? await liveVersion(page.id, "en") : null;
  const startFrom: Block[] = draft ? renderableBlocksAll(draft.blocks) : live ? renderableBlocksAll(live.blocks) : enLive ? renderableBlocksAll(enLive.blocks) : [];
  const canEdit = can(user, "content.edit");
  const canPublish = can(user, "content.publish");
  const canSeo = can(user, "seo.edit");
  const isHome = page.slug === HOME_SLUG;
  const publicUrl = isHome ? "/" : `/${page.slug}`;
  const scheduled = versions.filter((v) => v.status === "SCHEDULED");

  return (
    <>
      <PageHeader
        title={page.title}
        back={{ href: "/admin/pages", label: "Pages" }}
        description={
          <>
            <span className="font-mono">{publicUrl}</span> · <Badge tone={STATUS_TONE[page.status] ?? "neutral"}>{page.status.toLowerCase()}</Badge>
            {isHome && " · these blocks appear on the home page where “Page-builder blocks” sits in Page sections → Home page order"}
          </>
        }
        actions={
          <>
            <Link href={`/preview/${page.id}?locale=${locale}`} target="_blank" className={buttonClass("outline", "sm")}>
              Preview (desktop / mobile)
            </Link>
            {page.status === "PUBLISHED" && (
              <Link href={publicUrl} target="_blank" className={buttonClass("outline", "sm")}>
                View live
              </Link>
            )}
            {canPublish && page.status === "PUBLISHED" && <ConfirmAction action={unpublishPageAction.bind(null, page.id)} label="Unpublish" confirm="Take this page off the site? Its versions are kept." />}
            {canPublish && page.status === "ARCHIVED" && <ConfirmAction action={republishPageAction.bind(null, page.id)} label="Put back online" />}
            {canPublish && !isHome && page.status !== "PUBLISHED" && page.status !== "SCHEDULED" && (
              <ConfirmAction action={deletePageAction.bind(null, page.id)} label="Delete" variant="danger" confirm="Delete this page and all its versions?" />
            )}
          </>
        }
      />
      <Tabs
        current={locale}
        tabs={[
          { key: "en", label: "English", href: `/admin/pages/cms/${page.id}?locale=en` },
          { key: "ne", label: "नेपाली", href: `/admin/pages/cms/${page.id}?locale=ne` },
        ]}
      />
      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {locale === "ne" && !live && (
            <Callout tone="info" title="Nepali uses English until published">
              Visitors reading in Nepali see the English version until a Nepali version is published. The editor starts from the English blocks.
            </Callout>
          )}
          {draft && <Callout tone="warn" title={`Unpublished draft (v${draft.version})`}>Edited {formatStamp(draft.createdAt)} — not live yet.</Callout>}
          {scheduled.map((s) => (
            <Callout key={s.id} tone="info" title={`v${s.version} scheduled for ${s.publishAt ? formatStamp(s.publishAt) : "?"}`}>
              It goes live automatically at that time.{" "}
              {canPublish && <ConfirmAction action={cancelScheduleAction.bind(null, page.id, s.id)} label="Cancel schedule" className="ml-2" />}
            </Callout>
          ))}
          <Panel title={`Blocks · ${locale === "en" ? "English" : "नेपाली"}`}>
            {canEdit ? (
              <BlockEditor
                key={`${locale}-${draft?.id ?? live?.id ?? "new"}-${draft?.version ?? 0}`}
                initial={startFrom}
                canPublish={canPublish}
                previewHref={`/preview/${page.id}?locale=${locale}`}
                save={saveBlocksAction.bind(null, page.id, locale)}
              />
            ) : (
              <p className="text-sm text-ink-mute">You can view this page but not edit it.</p>
            )}
            {draft && canEdit && (
              <div className="mt-3">
                <ConfirmAction action={discardDraftAction.bind(null, page.id, locale)} label="Discard draft" confirm="Throw away the unpublished changes?" />
              </div>
            )}
          </Panel>
          <Panel title="Version history" bodyClass="p-0">
            <Table className="rounded-none border-0 shadow-none">
              <thead>
                <tr>
                  <Th>Version</Th>
                  <Th>Status</Th>
                  <Th>When</Th>
                  <Th>Blocks</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {versions.length === 0 && (
                  <tr>
                    <Td colSpan={5} className="text-center text-ink-mute">
                      No versions in this language yet.
                    </Td>
                  </tr>
                )}
                {versions.map((v) => {
                  const ok = validateBlocks(v.blocks).ok;
                  return (
                    <tr key={v.id}>
                      <Td className="font-semibold">
                        v{v.version} {live?.id === v.id && <Badge tone="good">live</Badge>}
                      </Td>
                      <Td>
                        <Badge tone={STATUS_TONE[v.status] ?? "neutral"}>{v.status.toLowerCase()}</Badge>
                      </Td>
                      <Td className="text-xs text-ink-mute">{formatStamp(v.publishedAt ?? v.publishAt ?? v.createdAt)}</Td>
                      <Td className="text-xs">{Array.isArray(v.blocks) ? v.blocks.length : 0}</Td>
                      <Td className="whitespace-nowrap text-right">
                        <Link href={`/preview/${page.id}?v=${v.id}&locale=${locale}`} target="_blank" className="mr-2 text-xs font-semibold text-akash hover:underline">
                          Preview
                        </Link>
                        {canPublish && v.status !== "DRAFT" && live?.id !== v.id && ok && (
                          <ConfirmAction action={restoreVersionAction.bind(null, page.id, v.id)} label="Restore" confirm={`Publish a copy of v${v.version} now?`} />
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Page details">
            <ActionForm action={savePageMetaAction.bind(null, page.id)} className="space-y-3">
              <Input name="title" label="Title" defaultValue={page.title} required disabled={!canEdit} />
              <Input name="titleNe" label="शीर्षक (Nepali title)" defaultValue={page.titleNe ?? ""} className="lang-ne" disabled={!canEdit} />
              <Input name="slug" label="URL" defaultValue={page.slug} hint={isHome ? "Fixed for the home blocks page" : "Changing the URL of a live page adds a redirect from the old one"} disabled={!canEdit || isHome} />
              <Checkbox name="showInNav" label="Suggest in navigation editor" defaultChecked={page.showInNav} disabled={!canEdit} />
              {canEdit && <SubmitButton size="sm">Save details</SubmitButton>}
            </ActionForm>
          </Panel>
          <Panel title="Search engines & sharing">
            <ActionForm action={savePageSeoAction.bind(null, page.id)} className="space-y-3">
              <Input name="seoTitle" label="SEO title" defaultValue={page.seoTitle ?? ""} hint="Up to ~60 characters. Empty = page title." disabled={!canSeo} />
              <Textarea name="seoDescription" label="SEO description" defaultValue={page.seoDescription ?? ""} rows={3} hint="Up to ~155 characters." disabled={!canSeo} />
              {canSeo ? <ImageField name="ogImage" label="Share image (OG)" defaultValue={page.ogImage ?? ""} hint="From the media library. Empty = the hero photo or the site default." /> : null}
              <Input name="canonicalUrl" label="Canonical URL" defaultValue={page.canonicalUrl ?? ""} hint={`Empty = /${page.slug}`} disabled={!canSeo} />
              <Checkbox name="noindex" label="Hide from search engines (noindex, left out of the sitemap)" defaultChecked={page.noindex} disabled={!canSeo} />
              {canSeo ? <SubmitButton size="sm">Save SEO</SubmitButton> : <p className="text-xs text-ink-mute">SEO settings need the SEO edit permission.</p>}
            </ActionForm>
          </Panel>
        </div>
      </div>
    </>
  );
}

/** For the editor, keep hidden blocks too (renderableBlocks drops them). */
function renderableBlocksAll(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  const visible = renderableBlocks(raw.map((b) => (b && typeof b === "object" ? { ...b, visible: true } : b)));
  const hidden = new Set(raw.filter((b) => b && typeof b === "object" && (b as { visible?: boolean }).visible === false).map((b) => (b as { id?: string }).id));
  return visible.map((b) => (hidden.has(b.id) ? { ...b, visible: false } : b));
}
