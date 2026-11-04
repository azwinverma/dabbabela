import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { rupeesInput } from "@/lib/money";
import { isoDate } from "@/lib/dates";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Select, Checkbox } from "@/components/ui/Fields";
import { savePlan } from "../actions";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("plans.view");
  const { id } = await params;
  const isNew = id === "new";
  const p = isNew ? null : await db.mealPlan.findUnique({ where: { id } });
  if (!isNew && !p) notFound();
  return (
    <>
      <PageHeader title={isNew ? "New plan" : p!.name} back={{ href: "/admin/plans", label: "Plan catalogue" }} />
      <ActionForm action={savePlan.bind(null, isNew ? null : p!.id)} className="max-w-4xl space-y-6">
        <>
          <>
            <Panel title="Plan">
              <div className="grid gap-4 md:grid-cols-2">
                <Input name="name" label="Name" defaultValue={p?.name} required />
                <Input name="nameNe" label="नाम (Nepali)" defaultValue={p?.nameNe ?? ""} className="lang-ne" />
                <Select name="kind" label="Kind" defaultValue={p?.kind ?? "WEEKLY"} options={[{ value: "WEEKLY", label: "Weekly" }, { value: "MONTHLY", label: "Monthly" }, { value: "OFFICE", label: "Office / team" }, { value: "CUSTOM", label: "Custom" }]} />
                <Input name="slug" label="URL name" defaultValue={p?.slug ?? ""} hint="Blank = from name" />
                <Input name="tagline" label="Tagline" defaultValue={p?.tagline ?? ""} className="md:col-span-2" />
                <Textarea name="description" label="Description" rows={3} defaultValue={p?.description ?? ""} className="md:col-span-2" />
                <Textarea name="features" label="Features (one per line)" rows={4} defaultValue={p?.features.join("\n") ?? ""} />
                <Textarea name="policyNote" label="Pause / refund wording shown before purchase" rows={4} defaultValue={p?.policyNote ?? ""} />
              </div>
            </Panel>
            <Panel title="Rules & price">
              <div className="grid gap-4 md:grid-cols-4">
                <Input name="durationWeeks" type="number" min={1} max={26} label="Weeks" defaultValue={p?.durationWeeks ?? 1} />
                <Input name="minDaysPerWeek" type="number" min={1} max={7} label="Min days / week" defaultValue={p?.minDaysPerWeek ?? 3} />
                <Input name="pricePerMeal" label="Price per meal (Rs)" inputMode="decimal" defaultValue={p ? rupeesInput(p.pricePerMeal) : ""} />
                <Input name="compareAtPrice" label="Regular price (Rs)" inputMode="decimal" defaultValue={p?.compareAtPrice != null ? rupeesInput(p.compareAtPrice) : ""} />
                <Input name="maxPauseDays" type="number" min={0} label="Max pause days" defaultValue={p?.maxPauseDays ?? 10} />
                <Input name="effectiveFrom" type="date" label="On sale from" defaultValue={p?.effectiveFrom ? isoDate(p.effectiveFrom) : ""} />
                <Input name="effectiveTo" type="date" label="On sale until" defaultValue={p?.effectiveTo ? isoDate(p.effectiveTo) : ""} />
                <Input name="sortOrder" type="number" label="Sort order" defaultValue={p?.sortOrder ?? 0} />
              </div>
              <div className="mt-4 flex flex-wrap gap-6">
                <Checkbox name="includesDelivery" label="Delivery included" defaultChecked={p?.includesDelivery ?? true} />
                <Checkbox name="isPopular" label="Mark as popular" defaultChecked={p?.isPopular ?? false} />
                <Checkbox name="isCorporate" label="Team / corporate plan" defaultChecked={p?.isCorporate ?? false} />
                <Checkbox name="isActive" label="On sale" defaultChecked={p?.isActive ?? true} />
              </div>
            </Panel>
            <SubmitButton>{isNew ? "Create plan" : "Save plan"}</SubmitButton>
          </>
        </>
      </ActionForm>
    </>
  );
}
