import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { NAV_MENUS, navForAdmin } from "@/lib/cms/nav";
import { listRedirects } from "@/lib/cms/redirects";
import { COLOR_PRESETS, FONT_PRESETS, getBranding } from "@/lib/cms/branding";
import { HOME_SLUG, navCandidatePages } from "@/lib/cms/pages";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, Tabs, Callout } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Checkbox } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Badge";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { ImageField } from "@/components/admin/ImageField";
import { deleteNavAction, deleteRedirectAction, moveNavAction, saveBrandingAction, saveNavAction, saveRedirectAction, toggleNavAction } from "./actions";

export default async function SitePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("seo.view");
  const tab = (await searchParams).tab ?? "nav";
  return (
    <>
      <PageHeader title="Navigation, branding, SEO & redirects" description="Header and footer links per language, brand slots within the approved palette and fonts, redirects and search settings. Changes here are live immediately and audited." />
      <Tabs
        current={tab}
        tabs={[
          { key: "nav", label: "Navigation", href: "/admin/site?tab=nav" },
          { key: "branding", label: "Branding & contact", href: "/admin/site?tab=branding" },
          { key: "redirects", label: "Redirects", href: "/admin/site?tab=redirects" },
          { key: "seo", label: "SEO overview", href: "/admin/site?tab=seo" },
        ]}
      />
      <div className="mt-4">
        {tab === "branding" ? <Branding canEdit={can(user, "content.publish")} /> : tab === "redirects" ? <Redirects canEdit={can(user, "seo.edit")} /> : tab === "seo" ? <Seo /> : <Nav canEdit={can(user, "content.publish")} />}
      </div>
    </>
  );
}

async function Nav({ canEdit }: { canEdit: boolean }) {
  const [rows, candidates] = await Promise.all([navForAdmin(), navCandidatePages().then((p) => p.filter((x) => x.showInNav))]);
  return (
    <div className="space-y-6">
      {!canEdit && <Callout tone="info">Navigation changes go live immediately, so they need the content publish permission.</Callout>}
      {candidates.length > 0 && (
        <p className="text-xs text-ink-mute">
          Pages suggested for navigation: {candidates.map((c) => <code key={c.slug} className="mr-2">/{c.slug}</code>)}
        </p>
      )}
      {NAV_MENUS.map((m) => {
        const items = rows.filter((r) => r.menu === m.key);
        const top = items.filter((r) => !r.parentId);
        const ordered = top.flatMap((t) => [t, ...items.filter((c) => c.parentId === t.id)]);
        return (
          <Panel key={m.key} title={m.label} bodyClass="p-0">
            <ul className="divide-y divide-ink-line/50">
              {ordered.length === 0 && <li className="px-4 py-4 text-sm text-ink-mute">No links yet — the site shows its built-in links for this menu until you add one.</li>}
              {ordered.map((r) => (
                <li key={r.id} className={`px-4 py-3 ${r.parentId ? "pl-10" : ""} ${r.visible ? "" : "bg-paper/50"}`}>
                  <details>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
                      <span className={`font-semibold ${r.visible ? "" : "text-ink-mute line-through"}`}>{r.label}</span>
                      {r.labelNe && <span className="lang-ne text-xs text-ink-mute">{r.labelNe}</span>}
                      <span className="font-mono text-xs text-akash">{r.href}</span>
                      {!r.visible && <Badge tone="warn">hidden</Badge>}
                      {canEdit && (
                        <span className="ml-auto flex items-center gap-1">
                          <ConfirmAction action={moveNavAction.bind(null, r.id, -1)} label="↑" />
                          <ConfirmAction action={moveNavAction.bind(null, r.id, 1)} label="↓" />
                          <ConfirmAction action={toggleNavAction.bind(null, r.id, !r.visible)} label={r.visible ? "Hide" : "Show"} />
                          <ConfirmAction action={deleteNavAction.bind(null, r.id)} label="Remove" variant="danger" confirm={`Remove “${r.label}”?`} />
                        </span>
                      )}
                    </summary>
                    {canEdit && (
                      <ActionForm action={saveNavAction.bind(null, r.id)} className="mt-3 grid gap-3 md:grid-cols-5">
                        <input type="hidden" name="menu" value={m.key} />
                        <Input name="label" label="Label (English)" defaultValue={r.label} required />
                        <Input name="labelNe" label="Label (नेपाली)" defaultValue={r.labelNe ?? ""} className="lang-ne" />
                        <Input name="href" label="Link" defaultValue={r.href} required />
                        <Select name="parentId" label="Under" defaultValue={r.parentId ?? ""} placeholder="— top level —" options={top.filter((t) => t.id !== r.id).map((t) => ({ value: t.id, label: t.label }))} />
                        <div className="flex items-end gap-3">
                          <Checkbox name="visible" label="Visible" defaultChecked={r.visible} />
                          <SubmitButton size="sm">Save</SubmitButton>
                        </div>
                      </ActionForm>
                    )}
                  </details>
                </li>
              ))}
            </ul>
            {canEdit && (
              <ActionForm action={saveNavAction.bind(null, null)} resetOnSuccess className="grid gap-3 border-t border-ink-line/60 bg-paper/40 p-4 md:grid-cols-5">
                <input type="hidden" name="menu" value={m.key} />
                <Input name="label" label="New link label" required />
                <Input name="labelNe" label="नेपाली" className="lang-ne" />
                <Input name="href" label="Link" placeholder="/our-story" required />
                <Select name="parentId" label="Under" defaultValue="" placeholder="— top level —" options={top.map((t) => ({ value: t.id, label: t.label }))} />
                <div className="flex items-end">
                  <SubmitButton size="sm">Add link</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

async function Branding({ canEdit }: { canEdit: boolean }) {
  const [b, s] = await Promise.all([getBranding(), getSettings()]);
  return (
    <ActionForm action={saveBrandingAction} className="grid gap-6 lg:grid-cols-2">
      <Panel title="Logos & favicon">
        <div className="space-y-4">
          <ImageField name="logoUrl" label="Header logo" defaultValue={b.logoUrl} hint="Empty = the bundled Dabba Bela mark. Use the supplied logo files only (brand guidelines §2)." />
          <ImageField name="logoLightUrl" label="Footer logo (on dark)" defaultValue={b.logoLightUrl} hint="Empty = the bundled inverted mark." />
          <ImageField name="faviconUrl" label="Favicon" defaultValue={b.faviconUrl} hint="Square PNG or SVG. Empty = the bundled icon." />
        </div>
      </Panel>
      <Panel title="Colours & type (approved presets only)">
        <div className="space-y-4">
          <Select name="colorPreset" label="Colour preset" defaultValue={b.colorPreset} hint="Sets the announcement bar and footer colour from the approved palette." options={Object.entries(COLOR_PRESETS).map(([value, v]) => ({ value, label: v.label }))} />
          <Select name="fontPreset" label="Typography preset" defaultValue={b.fontPreset} hint="Bundled fonts only (Plus Jakarta Sans, DM Sans; Nepali always Noto Sans Devanagari)." options={Object.entries(FONT_PRESETS).map(([value, v]) => ({ value, label: v.label }))} />
          <p className="text-xs text-ink-mute">
            Announcement bar text: <Link className="underline" href="/admin/content/announcement">Page sections → Announcement bar</Link> (timed promos: <Link className="underline" href="/admin/banners">Banners</Link>). Footer text:{" "}
            <Link className="underline" href="/admin/content/footer">Page sections → Footer</Link>. Default SEO title, description and share image: <Link className="underline" href="/admin/settings">Settings</Link>.
          </p>
        </div>
      </Panel>
      <Panel title="Contact, hours & socials" className="lg:col-span-2">
        <div className="grid gap-4 md:grid-cols-2">
          <Input name="phone" label="Phone" defaultValue={s.phone} />
          <Input name="whatsapp" label="WhatsApp" defaultValue={s.whatsapp} />
          <Input name="email" label="Email" type="email" defaultValue={s.email} />
          <Input name="address" label="Address" defaultValue={s.address} />
          <Input name="hours" label="Operating hours" defaultValue={s.hours} hint="Shown in the footer, e.g. Sun – Fri · 7:00 AM – 3:00 PM" />
          <Input name="facebook" label="Facebook URL" defaultValue={s.facebook} placeholder="https://facebook.com/…" />
          <Input name="instagram" label="Instagram URL" defaultValue={s.instagram} placeholder="https://instagram.com/…" />
          <Input name="tiktok" label="TikTok URL" defaultValue={s.tiktok} placeholder="https://tiktok.com/@…" />
        </div>
        <div className="mt-4">{canEdit ? <SubmitButton>Save branding</SubmitButton> : <p className="text-sm text-ink-mute">Branding changes need the content publish permission.</p>}</div>
      </Panel>
    </ActionForm>
  );
}

async function Redirects({ canEdit }: { canEdit: boolean }) {
  const rows = await listRedirects();
  return (
    <div className="space-y-6">
      <Callout tone="info">Redirects apply to paths no built-in page or published page answers (e.g. old links). Built-in pages always win.</Callout>
      <Table>
        <thead>
          <tr>
            <Th>From</Th>
            <Th>To</Th>
            <Th>Type</Th>
            <Th>Hits</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={5}>No redirects.</EmptyRow>}
          {rows.map((r) => (
            <tr key={r.id}>
              <Td className="font-mono text-xs">{r.from}</Td>
              <Td className="font-mono text-xs">{r.to}</Td>
              <Td>{r.permanent ? "308 permanent" : "307 temporary"}</Td>
              <Td className="tabular-nums">{r.hits}</Td>
              <Td className="text-right">{canEdit && <ConfirmAction action={deleteRedirectAction.bind(null, r.id)} label="Remove" variant="danger" confirm={`Remove ${r.from} → ${r.to}?`} />}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {canEdit && (
        <Panel title="Add a redirect">
          <ActionForm action={saveRedirectAction.bind(null, null)} resetOnSuccess className="grid gap-3 md:grid-cols-4">
            <Input name="from" label="From path" placeholder="/old-page" required />
            <Input name="to" label="To" placeholder="/our-story or https://…" required />
            <Select name="kind" label="Type" defaultValue="permanent" options={[{ value: "permanent", label: "308 permanent" }, { value: "temporary", label: "307 temporary" }]} />
            <div className="flex items-end">
              <SubmitButton size="sm">Add redirect</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      )}
    </div>
  );
}

async function Seo() {
  const [pages, policies] = await Promise.all([
    db.cmsPage.findMany({ where: { NOT: { slug: HOME_SLUG } }, orderBy: { slug: "asc" } }),
    db.page.findMany({ orderBy: { slug: "asc" } }),
  ]);
  const row = (k: string, url: string, href: string, title: string | null, desc: string | null, extra: React.ReactNode) => (
    <tr key={k}>
      <Td>
        <Link href={href} className="font-mono text-xs hover:text-sindoor">
          {url}
        </Link>
      </Td>
      <Td className="text-xs">{title || <span className="text-ink-mute">page title</span>}</Td>
      <Td className="max-w-md text-xs">{desc || <Badge tone="warn">missing</Badge>}</Td>
      <Td>{extra}</Td>
    </tr>
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-mute">
        Sitemap: <a className="underline" href="/sitemap.xml" target="_blank" rel="noreferrer">/sitemap.xml</a> (published page-builder pages without noindex, policies, dabbas, plans, journal). Structured data: home (FoodEstablishment), page-builder pages (WebPage, breadcrumbs, FAQPage when they show FAQs).
      </p>
      <Table>
        <thead>
          <tr>
            <Th>Page</Th>
            <Th>SEO title</Th>
            <Th>Description</Th>
            <Th>Indexing</Th>
          </tr>
        </thead>
        <tbody>
          {pages.map((p) =>
            row(p.id, `/${p.slug}`, `/admin/pages/cms/${p.id}`, p.seoTitle, p.seoDescription, (
              <>
                {p.noindex ? <Badge tone="warn">noindex</Badge> : <Badge tone="good">indexed</Badge>}
                {p.canonicalUrl && <span className="ml-1 text-xs text-ink-mute">canonical {p.canonicalUrl}</span>}
              </>
            )),
          )}
          {policies.map((p) => row(p.id, `/info/${p.slug}`, `/admin/pages/${p.id}`, p.seoTitle, p.seoDescription, p.published ? <Badge tone="good">indexed</Badge> : <Badge tone="neutral">hidden</Badge>))}
        </tbody>
      </Table>
    </div>
  );
}
