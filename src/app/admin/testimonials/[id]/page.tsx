import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Select, Checkbox } from "@/components/ui/Fields";
import { ImageField } from "@/components/admin/ImageField";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { deleteTestimonial, saveTestimonial } from "../actions";

export default async function TestimonialEdit({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("content");
  const { id } = await params;
  const t = id === "new" ? null : await db.testimonial.findUnique({ where: { id } });
  if (id !== "new" && !t) notFound();
  return (
    <>
      <PageHeader title={t ? t.name : "New testimonial"} back={{ href: "/admin/testimonials", label: "Testimonials" }} actions={t && <ConfirmAction action={deleteTestimonial.bind(null, t.id)} label="Delete" variant="danger" confirm="Delete this testimonial?" />} />
      <ActionForm action={saveTestimonial.bind(null, t?.id ?? null)} className="max-w-3xl">
        <>
          <Panel>
            <div className="grid gap-4 md:grid-cols-2">
              <Input name="name" label="Name (as they agreed to be shown)" defaultValue={t?.name} required />
              <Select name="rating" label="Their rating (optional)" defaultValue={t?.rating ? String(t.rating) : ""} placeholder="No rating" options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} / 5` }))} />
              <Input name="role" label="Role" defaultValue={t?.role ?? ""} />
              <Input name="company" label="Company / place" defaultValue={t?.company ?? ""} hint="Only with permission — no company logos" />
              <Textarea name="quote" label="Quote (their words)" defaultValue={t?.quote ?? ""} rows={4} className="md:col-span-2" required />
              <Textarea name="consentNote" label="Consent record" defaultValue={t?.consentNote ?? ""} rows={2} className="md:col-span-2" hint="How and when they agreed, e.g. 'WhatsApp message 3 Nov 2026, saved in shared drive'" />
              <div className="md:col-span-2">
                <ImageField name="avatar" label="Photo (only with permission)" defaultValue={t?.avatar} />
              </div>
              <Input name="sortOrder" type="number" label="Sort order" defaultValue={t?.sortOrder ?? 0} />
              <Checkbox name="published" label="Show on the website" defaultChecked={t?.published ?? false} className="pt-6" />
            </div>
            <SubmitButton className="mt-5">Save</SubmitButton>
          </Panel>
        </>
      </ActionForm>
    </>
  );
}
