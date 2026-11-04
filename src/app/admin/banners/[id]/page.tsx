import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Checkbox } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { deleteBanner, saveBanner } from "../actions";

const ymd = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(d) : "");

export default async function BannerEdit({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("marketing.view");
  const { id } = await params;
  const b = id === "new" ? null : await db.banner.findUnique({ where: { id } });
  if (id !== "new" && !b) notFound();
  return (
    <>
      <PageHeader title={b ? "Edit banner" : "New banner"} back={{ href: "/admin/banners", label: "Banners" }} actions={b && <ConfirmAction action={deleteBanner.bind(null, b.id)} label="Delete" variant="danger" confirm="Delete this banner?" />} />
      <ActionForm action={saveBanner.bind(null, b?.id ?? null)} className="max-w-3xl">
        <>
          <Panel>
            <div className="grid gap-4 md:grid-cols-2">
              <Input name="text" label="Text" defaultValue={b?.text} className="md:col-span-2" />
              <Input name="textNe" label="नेपाली" defaultValue={b?.textNe ?? ""} className="lang-ne md:col-span-2" />
              <Input name="link" label="Link" defaultValue={b?.link ?? ""} placeholder="/plans" />
              <Input name="linkLabel" label="Link label" defaultValue={b?.linkLabel ?? ""} placeholder="See plans" />
              <Select name="placement" label="Where" defaultValue={b?.placement ?? "TOP"} options={[{ value: "TOP", label: "Top bar (every page)" }, { value: "HOME", label: "Home page" }, { value: "MENU", label: "Menu page" }, { value: "CHECKOUT", label: "Checkout" }]} />
              <Select name="tone" label="Colour" defaultValue={b?.tone ?? "turmeric"} options={["turmeric", "achar", "saag", "charcoal"].map((v) => ({ value: v, label: v }))} />
              <Input name="startsAt" type="date" label="Starts (Kathmandu)" defaultValue={ymd(b?.startsAt)} />
              <Input name="endsAt" type="date" label="Ends" defaultValue={ymd(b?.endsAt)} />
              <Input name="sortOrder" type="number" label="Order" defaultValue={b?.sortOrder ?? 0} />
              <Checkbox name="isActive" label="Active" defaultChecked={b?.isActive ?? true} className="pt-6" />
            </div>
            <SubmitButton className="mt-5">Save banner</SubmitButton>
          </Panel>
        </>
      </ActionForm>
    </>
  );
}
