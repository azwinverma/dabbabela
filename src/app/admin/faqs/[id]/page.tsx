import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Checkbox } from "@/components/ui/Fields";
import { saveFaq } from "../actions";

export default async function FaqEdit({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("content.view");
  const { id } = await params;
  const [f, cats] = await Promise.all([id === "new" ? null : db.faq.findUnique({ where: { id } }), db.faq.findMany({ distinct: ["category"], select: { category: true } })]);
  if (id !== "new" && !f) notFound();
  return (
    <>
      <PageHeader title={f ? "Edit question" : "New question"} back={{ href: "/admin/faqs", label: "FAQs" }} />
      <ActionForm action={saveFaq.bind(null, f?.id ?? null)} className="max-w-2xl space-y-6">
        <Panel>
          <div className="grid gap-4 md:grid-cols-2">
            <Input name="question" label="Question" defaultValue={f?.question} required className="md:col-span-2" />
            <Textarea name="answer" label="Answer" defaultValue={f?.answer ?? ""} rows={5} required className="md:col-span-2" />
            <Input name="questionNe" label="प्रश्न (Nepali)" defaultValue={f?.questionNe ?? ""} className="lang-ne md:col-span-2" />
            <Textarea name="answerNe" label="उत्तर (Nepali)" defaultValue={f?.answerNe ?? ""} rows={4} className="lang-ne md:col-span-2" />
            <Input name="category" label="Category" defaultValue={f?.category ?? "General"} list="faq-cats" />
            <datalist id="faq-cats">
              {cats.map((c) => (
                <option key={c.category} value={c.category} />
              ))}
            </datalist>
            <Input name="sortOrder" type="number" label="Sort order" defaultValue={f?.sortOrder ?? 0} />
            <Checkbox name="published" label="Published" defaultChecked={f?.published ?? true} />
          </div>
        </Panel>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
    </>
  );
}
