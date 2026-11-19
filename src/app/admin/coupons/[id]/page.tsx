import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { rs, rupeesInput } from "@/lib/money";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, StatCard, Callout } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Checkbox } from "@/components/ui/Fields";
import { couponUsage } from "@/server/coupons";
import { getReferralSettings } from "@/server/marketing";
import { saveCoupon } from "../actions";

const ymd = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(d) : "");

export default async function CouponPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("pricing.view");
  const { id } = await params;
  const isNew = id === "new";
  const c = isNew ? null : await db.coupon.findUnique({ where: { id }, include: { redemptions: { orderBy: { createdAt: "desc" }, take: 50 } } });
  if (!isNew && !c) notFound();
  const [users, boxes, campaigns, referral, usage] = await Promise.all([
    c ? db.user.findMany({ where: { id: { in: c.redemptions.map((r) => r.userId) } }, select: { id: true, name: true } }) : [],
    db.lunchBox.findMany({ where: { OR: [{ isActive: true }, ...(c?.boxIds.length ? [{ id: { in: c.boxIds } }] : [])] }, select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" } }),
    db.campaign.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getReferralSettings(),
    c ? couponUsage([c.id]) : Promise.resolve(new Map()),
  ]);
  const u = c ? usage.get(c.id) : null;
  const isReferral = Boolean(c && c.id === referral.couponId);
  const canEdit = can(user, "pricing.edit") && !isReferral;
  return (
    <>
      <PageHeader title={isNew ? "New coupon" : c!.code} back={{ href: "/admin/coupons", label: "Coupons" }} />
      {isReferral && (
        <Callout tone="info" className="mb-4" title="Referral welcome coupon">
          Customers never type this code: it applies when a new customer enters a friend&apos;s referral code. Change the offer under{" "}
          <Link href="/admin/campaigns/referrals" className="font-semibold underline">
            Campaigns → Referrals
          </Link>
          .
        </Callout>
      )}
      {u && (
        <div className="mb-5 grid gap-3 sm:grid-cols-4">
          <StatCard label="Redemptions" value={u.redemptions} sub={`${u.customers} customer(s)${u.lastUsedAt ? ` · last ${formatStamp(u.lastUsedAt)}` : ""}`} />
          <StatCard label="Given away" value={rs(u.discount)} />
          <StatCard label="Orders" value={u.orders} sub="placed with the code" />
          <StatCard label="Recognised revenue" value={u.orders ? rs(u.revenue) : "no data"} sub="Delivered: total − VAT − refunds" tone="brand" />
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <ActionForm action={saveCoupon.bind(null, isNew ? null : c!.id)}>
          <fieldset disabled={!canEdit}>
            <Panel>
              <div className="grid gap-4 md:grid-cols-2">
                <Input name="code" label="Code" defaultValue={c?.code} className="font-mono" />
                <Input name="description" label="Description (shown to customer)" defaultValue={c?.description ?? ""} />
                <Select name="type" label="Type" defaultValue={c?.type ?? "PERCENT"} options={[{ value: "PERCENT", label: "Percent off" }, { value: "FLAT", label: "Rupees off" }]} />
                <Input name="value" label="Value (% or Rs)" defaultValue={c ? (c.type === "PERCENT" ? String(c.value) : rupeesInput(c.value)) : ""} hint="Leave blank / 0 for a free-delivery-only code" />
                <Select name="scope" label="Applies to" defaultValue={c?.scope ?? "ALL"} options={[{ value: "ALL", label: "Orders and plans" }, { value: "ORDERS", label: "Single orders" }, { value: "SUBSCRIPTIONS", label: "Meal plans" }]} />
                <Input name="minSubtotal" label="Minimum order (Rs)" defaultValue={c?.minSubtotal ? rupeesInput(c.minSubtotal) : ""} hint="For dabba-scoped codes: of the covered dabbas" />
                <Input name="maxDiscount" label="Max discount (Rs)" defaultValue={c?.maxDiscount != null ? rupeesInput(c.maxDiscount) : ""} />
                <Input name="usageLimit" type="number" min={1} label="Total uses" defaultValue={c?.usageLimit ?? ""} hint="Blank = unlimited" />
                <Input name="perUserLimit" type="number" min={1} label="Uses per customer" defaultValue={c ? (c.perUserLimit ?? "") : 1} hint="Blank = unlimited" />
                <Input name="startsAt" type="date" label="Starts" defaultValue={ymd(c?.startsAt)} />
                <Input name="endsAt" type="date" label="Ends" defaultValue={ymd(c?.endsAt)} />
                <Select name="campaignId" label="Campaign" defaultValue={c?.campaignId ?? ""} placeholder="None" options={campaigns.map((x) => ({ value: x.id, label: x.name }))} />
                <div className="md:col-span-2">
                  <p className="mb-1.5 text-sm font-semibold">Only these dabbas</p>
                  <p className="mb-2 text-xs text-ink-mute">Tick none for every dabba. Build-a-Dabba boxes are never covered by a dabba-scoped code.</p>
                  <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-lg border border-ink-line/60 p-2 sm:grid-cols-2">
                    {boxes.length === 0 && <p className="text-xs text-ink-mute">No dabbas yet.</p>}
                    {boxes.map((b) => (
                      <Checkbox key={b.id} name="boxIds" value={b.id} label={`${b.name}${b.isActive ? "" : " (inactive)"}`} defaultChecked={c?.boxIds.includes(b.id) ?? false} />
                    ))}
                  </div>
                </div>
                {c && c.usedCount > 0 && <Input name="reason" label="Reason for changing a used code" className="md:col-span-2" />}
                <Checkbox name="freeDelivery" label="Free delivery" hint="Delivery fee becomes 0 on every day of the order" defaultChecked={c?.freeDelivery ?? false} />
                <Checkbox name="firstOrderOnly" label="First order only" defaultChecked={c?.firstOrderOnly ?? false} />
                <Checkbox name="stackable" label="Stackable" hint="Can combine with other stackable codes. Checkout takes one code today." defaultChecked={c?.stackable ?? false} />
                <Checkbox name="isActive" label="Active" defaultChecked={c?.isActive ?? true} />
              </div>
              {canEdit && <SubmitButton className="mt-5">{isNew ? "Create coupon" : "Save coupon"}</SubmitButton>}
            </Panel>
          </fieldset>
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
                    <Td>
                      <Link href={`/admin/customers/${r.userId}`} className="hover:text-sindoor">
                        {users.find((x) => x.id === r.userId)?.name ?? "—"}
                      </Link>
                    </Td>
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
