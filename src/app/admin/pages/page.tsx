import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatStamp } from "@/lib/dates";
import { listPages, HOME_SLUG } from "@/lib/cms/pages";
import { ensureCmsContent, SITE_PAGE_MAP } from "@/lib/cms/builtin";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, Tabs } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input } from "@/components/ui/Fields";
import { createCmsPageAction } from "./cms/actions";

const TONE: Record<string, "good" | "warn" | "neutral" | "bad"> = { PUBLISHED: "good", SCHEDULED: "warn", DRAFT: "neutral", ARCHIVED: "bad" };

export default async function PagesIndex({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("content.view");
  // Built-in pages from the brief (idempotent; creates nothing once done).
  await ensureCmsContent().catch(() => null);
  const tab = (await searchParams).tab ?? "builder";
  const canEdit = can(user, "content.edit");
  return (
    <>
      <PageHeader
        title="Pages"
        description="Page-builder pages (blocks, per language, draft → publish, scheduling, version history) and policy / info pages (markdown at /info/<slug>, with revision history)."
        actions={tab === "policies" && canEdit ? <Link href="/admin/pages/new" className={buttonClass("primary", "sm")}>New policy page</Link> : undefined}
      />
      <Tabs
        current={tab}
        tabs={[
          { key: "builder", label: "Page builder", href: "/admin/pages?tab=builder" },
          { key: "policies", label: "Policies & info pages", href: "/admin/pages?tab=policies" },
          { key: "map", label: "Where each page is managed", href: "/admin/pages?tab=map" },
        ]}
      />
      <div className="mt-4">{tab === "policies" ? <Policies /> : tab === "map" ? <SiteMap /> : <Builder canEdit={canEdit} />}</div>
    </>
  );
}

async function Builder({ canEdit }: { canEdit: boolean }) {
  const pages = await listPages();
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <Table>
        <thead>
          <tr>
            <Th>Page</Th>
            <Th>URL</Th>
            <Th>Status</Th>
            <Th>Languages</Th>
            <Th>Updated</Th>
          </tr>
        </thead>
        <tbody>
          {pages.length === 0 && <EmptyRow colSpan={5} />}
          {pages.map((p) => {
            const langs = ["en", "ne"].map((l) => {
              const vs = p.versions.filter((v) => v.locale === l);
              return { l, live: vs.some((v) => v.status === "PUBLISHED"), draft: vs.some((v) => v.status === "DRAFT"), scheduled: vs.some((v) => v.status === "SCHEDULED") };
            });
            return (
              <tr key={p.id}>
                <Td>
                  <Link href={`/admin/pages/cms/${p.id}`} className="font-semibold hover:text-sindoor">
                    {p.title}
                  </Link>
                  {p.noindex && <span className="ml-2 text-xs text-ink-mute">noindex</span>}
                </Td>
                <Td className="font-mono text-xs">{p.slug === HOME_SLUG ? "/ (home blocks)" : `/${p.slug}`}</Td>
                <Td>
                  <Badge tone={TONE[p.status] ?? "neutral"}>{p.status.toLowerCase()}</Badge>
                </Td>
                <Td className="space-x-1 text-xs">
                  {langs.map((x) => (
                    <span key={x.l}>
                      <Badge tone={x.live ? "good" : "neutral"}>{x.l.toUpperCase()}</Badge>
                      {x.draft && <Badge tone="warn">draft</Badge>}
                      {x.scheduled && <Badge tone="warn">scheduled</Badge>}
                    </span>
                  ))}
                </Td>
                <Td className="text-xs text-ink-mute">{formatStamp(p.updatedAt)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {canEdit && (
        <Panel title="New page">
          <ActionForm action={createCmsPageAction} className="space-y-3">
            <Input name="title" label="Title" required />
            <Input name="titleNe" label="शीर्षक (Nepali title)" className="lang-ne" />
            <Input name="slug" label="URL" hint="e.g. our-kitchen-team — empty = from the title. Built-in URLs (/menu, /plans …) can't be used." />
            <SubmitButton size="sm">Create page</SubmitButton>
          </ActionForm>
        </Panel>
      )}
    </div>
  );
}

async function Policies() {
  const pages = await db.page.findMany({ orderBy: { title: "asc" }, include: { _count: { select: { revisions: true } } } });
  return (
    <Table>
      <thead>
        <tr>
          <Th>Title</Th>
          <Th>URL</Th>
          <Th>Footer</Th>
          <Th>Status</Th>
          <Th>Revisions</Th>
          <Th>Updated</Th>
        </tr>
      </thead>
      <tbody>
        {pages.length === 0 && <EmptyRow colSpan={6} />}
        {pages.map((p) => (
          <tr key={p.id}>
            <Td>
              <Link href={`/admin/pages/${p.id}`} className="font-semibold hover:text-sindoor">
                {p.title}
              </Link>
            </Td>
            <Td>
              <Link href={`/info/${p.slug}`} target="_blank" className="font-mono text-xs text-akash hover:underline">
                /info/{p.slug}
              </Link>
            </Td>
            <Td>{p.showInFooter ? "Yes" : "—"}</Td>
            <Td>
              {p.published ? <Badge tone="good">Published</Badge> : <Badge tone="warn">Hidden</Badge>}
              {p.needsLegalReview && (
                <Badge tone="bad" className="ml-1.5">
                  Needs review
                </Badge>
              )}
            </Td>
            <Td className="text-xs">{p._count.revisions}</Td>
            <Td className="text-xs text-ink-mute">{formatStamp(p.updatedAt)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function SiteMap() {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Page</Th>
          <Th>URL</Th>
          <Th>Managed in</Th>
        </tr>
      </thead>
      <tbody>
        {SITE_PAGE_MAP.map((r) => (
          <tr key={r.page}>
            <Td className="font-semibold">{r.page}</Td>
            <Td>
              <Link href={r.url} target="_blank" className="font-mono text-xs text-akash hover:underline">
                {r.url}
              </Link>
            </Td>
            <Td>
              <Link href={r.href} className="hover:text-sindoor">
                {r.managedIn}
              </Link>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
