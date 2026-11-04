import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { SECTION_MAP } from "@/lib/cms";
import { getSectionForEdit } from "@/lib/cms-store";
import { formatStamp } from "@/lib/dates";
import { isLocale, type Locale } from "@/lib/i18n";
import { PageHeader, Panel, Tabs, Callout } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { SectionEditor } from "../SectionEditor";
import { discardDraftAction, rollbackAction, saveSectionAction } from "../actions";

function preview(v: unknown): string {
  if (Array.isArray(v)) return `${v.length} item(s): ${v.map((r) => (r && typeof r === "object" ? Object.values(r)[0] : r)).filter(Boolean).slice(0, 4).join(" · ")}`;
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (v === undefined || v === null || v === "") return "—";
  return String(v);
}

export default async function SectionPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ locale?: string }> }) {
  await requirePermission("content.view");
  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  const def = SECTION_MAP[key];
  if (!def) notFound();
  const sp = await searchParams;
  const locale: Locale = isLocale(sp.locale) ? sp.locale : "en";
  const [state, en] = await Promise.all([getSectionForEdit(key, locale), locale === "ne" ? getSectionForEdit(key, "en") : Promise.resolve(null)]);
  const editing = state.draft ?? state.published;
  const changed = state.draft ? def.fields.filter((fl) => JSON.stringify(state.draft![fl.name] ?? "") !== JSON.stringify(state.published[fl.name] ?? "")) : [];

  return (
    <>
      <PageHeader title={def.label} back={{ href: "/admin/content", label: "Page sections" }} description={def.description} />
      <Tabs
        current={locale}
        tabs={[
          { key: "en", label: "English", href: `/admin/content/${encodeURIComponent(key)}?locale=en` },
          { key: "ne", label: "नेपाली", href: `/admin/content/${encodeURIComponent(key)}?locale=ne` },
        ]}
      />
      {locale === "ne" && <Callout tone="info" className="mb-4">Grey text shows the English. Leave a field empty and the site shows the English version there. Write natural Nepali — no machine translation.</Callout>}
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <ActionForm action={saveSectionAction.bind(null, key, locale)}>
          <Panel title={state.draft ? "Editing draft" : `Editing live content${state.version ? ` (v${state.version})` : " (defaults)"}`}>
            <div className={locale === "ne" ? "lang-ne" : undefined}>
              <SectionEditor key={`${locale}-${state.version}-${state.draft ? "d" : "p"}`} fields={def.fields} initial={editing} placeholders={en?.published} />
            </div>
            <div className="mt-6 flex flex-wrap gap-2 border-t border-ink-line/60 pt-4">
              <SubmitButton name="intent" value="draft" variant="outline" size="sm">
                Save draft
              </SubmitButton>
              <SubmitButton name="intent" value="publish" size="sm" pendingText="Publishing…" confirm="Publish these changes to the live site?">
                Publish
              </SubmitButton>
            </div>
          </Panel>
        </ActionForm>
        <div className="space-y-6">
          {state.draft && (
            <Panel title="Draft vs live" actions={<ConfirmAction action={discardDraftAction.bind(null, key, locale)} label="Discard draft" variant="ghost" confirm="Throw away the unpublished changes?" />}>
              {changed.length === 0 ? (
                <p className="text-sm text-ink-mute">The draft matches what's live.</p>
              ) : (
                <dl className="space-y-3 text-sm">
                  {changed.map((fl) => (
                    <div key={fl.name}>
                      <dt className="label">{fl.label}</dt>
                      <dd className="rounded-md bg-sindoor-light/60 px-2 py-1 text-xs line-through decoration-sindoor/50">{preview(state.published[fl.name])}</dd>
                      <dd className="mt-1 rounded-md bg-saag-light px-2 py-1 text-xs">{preview(state.draft![fl.name])}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Panel>
          )}
          <Panel title="Published versions">
            {state.revisions.length === 0 ? (
              <p className="text-sm text-ink-mute">Not published yet — the site shows the built-in default copy{locale === "ne" ? " (English)" : ""}.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {state.revisions.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink-line/60 px-3 py-1.5">
                    <span>
                      <b>v{r.version}</b> <span className="text-xs text-ink-mute">{r.action.toLowerCase()} · {formatStamp(r.createdAt)}</span>
                      {r.version === state.version && <span className="ml-1.5 text-xs font-semibold text-saag">live</span>}
                    </span>
                    {r.version !== state.version && <ConfirmAction action={rollbackAction.bind(null, key, locale, r.id)} label="Roll back" variant="ghost" confirm={`Make version ${r.version} live again?`} />}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
