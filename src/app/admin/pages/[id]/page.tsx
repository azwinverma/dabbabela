import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Checkbox } from "@/components/ui/Fields";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { savePage, deletePage } from "../actions";

export default async function PageEdit({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("content");
  const { id } = await params;
  const p = id === "new" ? null : await db.page.findUnique({ where: { id } });
  if (id !== "new" && !p) notFound();
  return (
    <>
      <PageHeader
        title={p ? p.title : "New page"}
        back={{ href: "/admin/pages", label: "Pages" }}
        actions={
          p && (
            <>
              <Link href={`/info/${p.slug}`} target="_blank" className={buttonClass("outline", "sm")}>
                View
              </Link>
              <ConfirmAction action={deletePage.bind(null, p.id)} label="Delete" variant="danger" confirm="Delete this page?" />
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
        </div>
      </ActionForm>
    </>
  );
}
