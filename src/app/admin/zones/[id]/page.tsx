import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { rupeesInput } from "@/lib/money";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Select, Checkbox } from "@/components/ui/Fields";
import { bandLines, parseZoneRules } from "@/server/coverage";
import { saveZone } from "../actions";

export default async function ZonePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("rules.view");
  const { id } = await params;
  const isNew = id === "new";
  const [z, kitchens, slots] = await Promise.all([
    isNew ? null : db.deliveryZone.findUnique({ where: { id } }),
    db.kitchen.findMany({ orderBy: { name: "asc" } }),
    db.deliverySlot.findMany({ where: { isActive: true }, orderBy: [{ kitchenId: "asc" }, { sortOrder: "asc" }], include: { kitchen: { select: { name: true } } } }),
  ]);
  if (!isNew && !z) notFound();
  const rules = parseZoneRules(z?.distanceRules);
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
            <h3 className="mt-6 font-display text-sm font-bold">Distance fee bands (optional)</h3>
            <p className="mb-3 text-xs text-ink-mute">Used only when the address has a map pin and the zone has an origin: the straight-line distance picks the band. Without a pin the flat fee above applies. Past the last band the address counts as outside this zone&apos;s radius.</p>
            <div className="grid gap-4 md:grid-cols-3">
              <Input name="originLat" label="Origin latitude" inputMode="decimal" defaultValue={rules.origin?.lat ?? ""} placeholder="27.6939" />
              <Input name="originLng" label="Origin longitude" inputMode="decimal" defaultValue={rules.origin?.lng ?? ""} placeholder="85.3157" />
              <Textarea name="bands" label="Bands: km, Rs (one per line)" rows={4} defaultValue={bandLines(rules.bands)} hint={'e.g. "3, 0" then "6, 50" then "10, 90"'} />
            </div>
            <h3 className="mt-6 font-display text-sm font-bold">Time windows</h3>
            <p className="mb-2 text-xs text-ink-mute">Tick the serving kitchen&apos;s slots this zone gets. None ticked = every slot of the kitchen.</p>
            <div className="flex flex-wrap gap-3">
              {slots.map((s) => (
                <Checkbox key={s.id} name="slotIds" value={s.id} label={`${s.label} · ${s.kitchen.name}`} defaultChecked={rules.slotIds.includes(s.id)} />
              ))}
              {!slots.length && <p className="text-sm text-ink-mute">No active slots yet.</p>}
            </div>
            <SubmitButton className="mt-5">{isNew ? "Create zone" : "Save zone"}</SubmitButton>
          </Panel>
        </>
      </ActionForm>
    </>
  );
}
