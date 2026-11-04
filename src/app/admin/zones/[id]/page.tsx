import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { rupeesInput } from "@/lib/money";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Select, Checkbox } from "@/components/ui/Fields";
import { saveZone } from "../actions";

export default async function ZonePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("rules");
  const { id } = await params;
  const isNew = id === "new";
  const [z, kitchens] = await Promise.all([isNew ? null : db.deliveryZone.findUnique({ where: { id } }), db.kitchen.findMany({ orderBy: { name: "asc" } })]);
  if (!isNew && !z) notFound();
  return (
    <>
      <PageHeader title={isNew ? "New zone" : z!.name} back={{ href: "/admin/zones", label: "Delivery zones" }} />
      <ActionForm action={saveZone.bind(null, isNew ? null : z!.id)} className="max-w-3xl">
        <>
          <Panel>
            <div className="grid gap-4 md:grid-cols-2">
              <Input name="name" label="Zone name" defaultValue={z?.name} />
              <Select name="kitchenId" label="Served by kitchen" defaultValue={z?.kitchenId ?? kitchens[0]?.id} options={kitchens.map((k) => ({ value: k.id, label: `${k.name}${k.isActive ? "" : " (closed)"}` }))} />
              <Input name="city" label="City" defaultValue={z?.city ?? "Kathmandu"} />
              <Input name="etaNote" label="Delivery window note" defaultValue={z?.etaNote ?? ""} placeholder="12:00 – 1:15 PM" />
              <Textarea name="areas" label="Localities (one per line)" rows={7} defaultValue={z?.areas.join("\n") ?? ""} hint="Exactly as customers write them, e.g. New Baneshwor, Shantinagar" />
              <Textarea name="wards" label="Ward codes (optional)" rows={7} defaultValue={z?.wards.join("\n") ?? ""} hint="Municipality short name + ward: KMC-10, LMC-2" />
              <Input name="fee" label="Delivery fee per day (Rs)" inputMode="decimal" defaultValue={rupeesInput(z?.fee ?? 0)} />
              <Input name="freeAbove" label="Free delivery above (Rs)" inputMode="decimal" defaultValue={z?.freeAbove != null ? rupeesInput(z.freeAbove) : ""} hint="Blank = use the global setting" />
              <Input name="minOrder" label="Minimum order per day (Rs)" inputMode="decimal" defaultValue={z?.minOrder ? rupeesInput(z.minOrder) : ""} />
              <Input name="sortOrder" type="number" label="Sort order" defaultValue={z?.sortOrder ?? 0} />
              <Checkbox name="isActive" label="Taking orders" defaultChecked={z?.isActive ?? true} />
            </div>
            <SubmitButton className="mt-5">{isNew ? "Create zone" : "Save zone"}</SubmitButton>
          </Panel>
        </>
      </ActionForm>
    </>
  );
}
