import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Checkbox } from "@/components/ui/Fields";
import { ImageField } from "@/components/admin/ImageField";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { savePost, deletePost } from "../actions";

export default async function PostEdit({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("content");
  const { id } = await params;
  const p = id === "new" ? null : await db.post.findUnique({ where: { id } });
  if (id !== "new" && !p) notFound();
  return (
    <>
      <PageHeader
        title={p ? p.title : "New post"}
        back={{ href: "/admin/blog", label: "Journal" }}
        actions={
          p && (
            <>
              {p.published && (
                <Link href={`/journal/${p.slug}`} target="_blank" className={buttonClass("outline", "sm")}>
                  View
                </Link>
              )}
              <ConfirmAction action={deletePost.bind(null, p.id)} label="Delete" variant="danger" confirm="Delete this post?" />
            </>
          )
        }
      />
      <ActionForm action={savePost.bind(null, p?.id ?? null)} className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Panel>
          <div className="space-y-4">
            <Input name="title" label="Title" defaultValue={p?.title} required />
            <Textarea name="excerpt" label="Excerpt" hint="One or two lines for the journal list and link previews" defaultValue={p?.excerpt ?? ""} rows={2} />
            <Textarea name="body" label="Body (Markdown)" defaultValue={p?.body ?? ""} rows={24} className="font-mono" />
            <Input name="titleNe" label="शीर्षक (Nepali title, optional)" defaultValue={p?.titleNe ?? ""} className="lang-ne" />
            <Textarea name="bodyNe" label="Nepali body (optional)" defaultValue={p?.bodyNe ?? ""} rows={8} className="lang-ne font-mono" />
          </div>
        </Panel>
        <div className="space-y-6">
          <Panel title="Publishing">
            <div className="space-y-3">
              <Checkbox name="published" label="Published" defaultChecked={p?.published ?? false} />
              <Input name="slug" label="Slug" defaultValue={p?.slug} hint="Auto from title if empty" />
              <Input name="author" label="Author" defaultValue={p?.author ?? user.name} />
              <Input name="tags" label="Tags" hint="Comma separated" defaultValue={p?.tags.join(", ")} />
            </div>
          </Panel>
          <Panel title="Cover">
            <ImageField name="coverImage" label="Cover image" defaultValue={p?.coverImage} />
          </Panel>
          <SubmitButton>Save post</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
