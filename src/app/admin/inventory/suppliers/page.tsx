import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Checkbox } from "@/components/ui/Fields";
import { InvTabs } from "@/components/admin/ops/InvTabs";
import { saveSupplierAction } from "../actions";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  await requirePermission("inventory");
  const suppliers = await db.supplier.findMany({ include: { _count: { select: { ingredients: true, purchases: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  return (
    <div>
      <PageHeader title="Suppliers" description="Who you buy from. Open a supplier to edit; inactive suppliers stay on old purchase orders." />
      <InvTabs current="suppliers" />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          {suppliers.map((s) => (
            <details key={s.id} className={`rounded-xl border border-ink-line/80 bg-white shadow-card ${s.isActive ? "" : "opacity-60"}`}>
              <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3">
                <span className="font-semibold">{s.name}</span>
                <span className="text-xs text-ink-mute">{s._count.ingredients} items · {s._count.purchases} POs{s.phone ? ` · ${s.phone}` : ""}</span>
              </summary>
              <div className="border-t border-ink-line/60 p-4"><SupplierForm s={s} /></div>
            </details>
          ))}
        </div>
        <Panel title="Add supplier"><SupplierForm /></Panel>
      </div>
    </div>
  );
}

function SupplierForm({ s }: { s?: { id: string; name: string; contact: string | null; phone: string | null; email: string | null; address: string | null; panVat: string | null; notes: string | null; isActive: boolean } }) {
  return (
    <ActionForm action={saveSupplierAction.bind(null, s?.id ?? null)} className="grid gap-3 sm:grid-cols-2" resetOnSuccess={!s}>
      <Input name="name" label="Name" defaultValue={s?.name} required className="sm:col-span-2" />
      <Input name="contact" label="Contact person" defaultValue={s?.contact ?? ""} />
      <Input name="phone" label="Phone" defaultValue={s?.phone ?? ""} />
      <Input name="email" label="Email" type="email" defaultValue={s?.email ?? ""} />
      <Input name="panVat" label="PAN / VAT" defaultValue={s?.panVat ?? ""} />
      <Input name="address" label="Address" defaultValue={s?.address ?? ""} className="sm:col-span-2" />
      <Textarea name="notes" label="Notes" rows={2} defaultValue={s?.notes ?? ""} className="sm:col-span-2" />
      {s && <Checkbox name="isActive" label="Active" defaultChecked={s.isActive} />}
      <div className="sm:col-span-2"><SubmitButton size="sm">{s ? "Save" : "Add supplier"}</SubmitButton></div>
    </ActionForm>
  );
}
