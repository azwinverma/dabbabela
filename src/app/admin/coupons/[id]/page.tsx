import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { rs, rupeesInput } from "@/lib/money";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Checkbox } from "@/components/ui/Fields";
import { saveCoupon } from "../actions";

const ymd = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(d) : "");

export default async function CouponPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("pricing.view");
  const { id } = await params;
  const isNew = id === "new";
  const c = isNew ? null : await db.coupon.findUnique({ where: { id }, include: { redemptions: { orderBy: { createdAt: "desc" }, take: 50 } } });
  if (!isNew && !c) notFound();
  const users = c ? await db.user.findMany({ where: { id: { in: c.redemptions.map((r) => r.userId) } }, select: { id: true, name: true } }) : [];
  return (
    <>
      <PageHeader title={isNew ? "New coupon" : c!.code} back={{ href: "/admin/coupons", label: "Coupons" }} />
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <ActionForm action={saveCoupon.bind(null, isNew ? null : c!.id)}>
          <>
            <Panel>
              <div className="grid gap-4 md:grid-cols-2">
                <Input name="code" label="Code" defaultValue={c?.code} className="font-mono" />
                <Input name="description" label="Description (shown to customer)" defaultValue={c?.description ?? ""} />
                <Select name="type" label="Type" defaultValue={c?.type ?? "PERCENT"} options={[{ value: "PERCENT", label: "Percent off" }, { value: "FLAT", label: "Rupees off" }]} />
                <Input name="value" label="Value (% or Rs)" defaultValue={c ? (c.type === "PERCENT" ? String(c.value) : rupeesInput(c.value)) : ""} />
                <Select name="scope" label="Applies to" defaultValue={c?.scope ?? "ALL"} options={[{ value: "ALL", label: "Orders and plans" }, { value: "ORDERS", label: "Single orders" }, { value: "SUBSCRIPTIONS", label: "Meal plans" }]} />
                <Input name="minSubtotal" label="Minimum order (Rs)" defaultValue={c?.minSubtotal ? rupeesInput(c.minSubtotal) : ""} />
                <Input name="maxDiscount" label="Max discount (Rs)" defaultValue={c?.maxDiscount != null ? rupeesInput(c.maxDiscount) : ""} />
                <Input name="usageLimit" type="number" min={1} label="Total uses" defaultValue={c?.usageLimit ?? ""} hint="Blank = unlimited" />
                <Input name="perUserLimit" type="number" min={1} label="Uses per customer" defaultValue={c?.perUserLimit ?? 1} />
                <Input name="startsAt" type="date" label="Starts" defaultValue={ymd(c?.startsAt)} />
                <Input name="endsAt" type="date" label="Ends" defaultValue={ymd(c?.endsAt)} />
                {c && c.usedCount > 0 && <Input name="reason" label="Reason for changing a used code" className="md:col-span-2" />}
                <Checkbox name="firstOrderOnly" label="First order only" defaultChecked={c?.firstOrderOnly ?? false} />
                <Checkbox name="isActive" label="Active" defaultChecked={c?.isActive ?? true} />
              </div>
              <SubmitButton className="mt-5">{isNew ? "Create coupon" : "Save coupon"}</SubmitButton>
            </Panel>
          </>
        </ActionForm>
        {c && (
          <Panel title={`Redemptions (${c.usedCount})`} bodyClass="p-0">
            <Table className="rounded-none border-0 shadow-none">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Customer</Th>
                  <Th className="text-right">Discount</Th>
                </tr>
              </thead>
              <tbody>
                {c.redemptions.length === 0 && <EmptyRow colSpan={3}>Not used yet.</EmptyRow>}
                {c.redemptions.map((r) => (
                  <tr key={r.id}>
                    <Td className="text-xs">{formatStamp(r.createdAt)}</Td>
                    <Td>{users.find((u) => u.id === r.userId)?.name ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{rs(r.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )}
      </div>
    </>
  );
}
