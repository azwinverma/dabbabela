import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { SECTIONS } from "@/lib/cms";
import { getHomeLayout } from "@/lib/cms-store";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { HomeLayoutEditor } from "./HomeLayoutEditor";
import { saveLayoutAction } from "./actions";

export default async function ContentPage() {
  await requirePermission("content.view");
  const [rows, layout] = await Promise.all([db.contentSection.findMany({ select: { key: true, locale: true, version: true, publishedAt: true, draft: true } }), getHomeLayout()]);
  const groups = [...new Set(SECTIONS.map((s) => s.group))];
  const status = (key: string, locale: string) => rows.find((r) => r.key === key && r.locale === locale);
  return (
    <>
      <PageHeader title="Page sections" description="Every block of website copy, in English and Nepali. Edits are saved as drafts, published when ready, and every published version can be rolled back." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {groups.map((g) => (
            <Panel key={g} title={g} bodyClass="p-0">
              <ul className="divide-y divide-ink-line/50">
                {SECTIONS.filter((s) => s.group === g).map((s) => {
                  const en = status(s.key, "en");
                  const ne = status(s.key, "ne");
                  return (
                    <li key={s.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <Link href={`/admin/content/${encodeURIComponent(s.key)}`} className="font-semibold hover:text-sindoor">
                          {s.label}
                        </Link>
                        <p className="text-xs text-ink-mute">{s.description}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <Badge tone={en?.publishedAt ? "good" : "neutral"}>EN {en?.publishedAt ? `v${en.version}` : "default"}</Badge>
                        {en?.draft != null && <Badge tone="warn">EN draft</Badge>}
                        <Badge tone={ne?.publishedAt ? "good" : "neutral"}>NE {ne?.publishedAt ? `v${ne.version}` : "uses EN"}</Badge>
                        {ne?.draft != null && <Badge tone="warn">NE draft</Badge>}
                        {en?.publishedAt && <span className="text-ink-mute">{formatStamp(en.publishedAt)}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>
        <Panel title="Home page order">
          <p className="mb-3 text-sm text-ink-mute">Reorder or hide blocks on the home page. Hidden blocks keep their content.</p>
          <HomeLayoutEditor initial={layout} labels={Object.fromEntries(SECTIONS.map((s) => [s.key, s.label]))} save={saveLayoutAction} />
        </Panel>
      </div>
    </>
  );
}
