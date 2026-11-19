import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { rs } from "@/lib/money";
import { formatStamp } from "@/lib/dates";
import { PageHeader } from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { FilterForm, Field } from "@/components/admin/Filters";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { couponUsage } from "@/server/coupons";
import { getReferralSettings } from "@/server/marketing";
import { flatParams, one, pageWindow, parseEnum, parseListParams, type SearchParamsRecord } from "../_kit/params";
import { toggleCoupon } from "./actions";

export const metadata = { title: "Coupons" };
const BASE = "/admin/coupons";
const SORTS = ["createdAt", "code", "usedCount"] as const;
const STATES = ["live", "scheduled", "expired", "disabled"] as const;

export default async function CouponsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requirePermission("pricing.view");
  const sp = await searchParams;
  const params = flatParams(sp);
  const state = parseListParams(sp, { sortable: SORTS, sort: "createdAt", per: 50 });
  const q = one(sp, "q")?.toUpperCase();
  const status = parseEnum(sp, "status", STATES);
  const campaign = one(sp, "campaign");
  const now = new Date();
  const and: Prisma.CouponWhereInput[] = [];
  if (q) and.push({ OR: [{ code: { contains: q } }, { description: { contains: q, mode: "insensitive" } }] });
  if (status === "disabled") and.push({ isActive: false });
  if (status === "live") and.push({ isActive: true, OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] });
  if (status === "scheduled") and.push({ isActive: true, startsAt: { gt: now } });
  if (status === "expired") and.push({ endsAt: { lt: now } });
  if (campaign) and.push({ campaignId: campaign === "none" ? null : campaign });
  const where: Prisma.CouponWhereInput = and.length ? { AND: and } : {};
  const [rows, total, campaigns, referral] = await Promise.all([
    db.coupon.findMany({ where, orderBy: { [state.sort]: state.dir }, ...pageWindow(state), include: { campaign: { select: { id: true, name: true } } } }),
    db.coupon.count({ where }),
    db.campaign.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getReferralSettings(),
  ]);
  const usage = await couponUsage(rows.map((r) => r.id));
  const canEdit = can(user, "pricing.edit");
  type Row = (typeof rows)[number];

  const columns: Column<Row>[] = [
    {
      key: "code",
      header: "Code",
      sortable: true,
      defaultDir: "asc",
      cell: (c) => (
        <>
          <Link href={`${BASE}/${c.id}`} className="font-mono font-bold hover:text-sindoor">
            {c.code}
          </Link>
          {c.id === referral.couponId && <Badge tone="info" className="ml-1.5">referral</Badge>}
          <div className="text-xs text-ink-mute">{c.description}</div>
        </>
      ),
    },
    {
      key: "offer",
      header: "Offer",
      className: "text-sm",
      cell: (c) => (
        <>
          {c.value > 0 ? (c.type === "PERCENT" ? `${c.value}%` : rs(c.value)) : null}
          {c.value > 0 && c.maxDiscount != null && <span className="text-xs text-ink-mute"> (max {rs(c.maxDiscount)})</span>}
          {c.freeDelivery && <Badge tone="good" className="ml-1.5">free delivery</Badge>}
          {c.firstOrderOnly && <Badge className="ml-1.5">first order</Badge>}
          {c.boxIds.length > 0 && <Badge className="ml-1.5">{c.boxIds.length} dabba{c.boxIds.length > 1 ? "s" : ""}</Badge>}
          {c.stackable && <Badge className="ml-1.5">stackable</Badge>}
        </>
      ),
    },
    {
      key: "rules",
      header: "Rules",
      className: "text-xs",
      cell: (c) => (
        <>
          {c.scope === "ALL" ? "orders + plans" : c.scope === "ORDERS" ? "single orders" : "meal plans"}
          {c.minSubtotal ? ` · min ${rs(c.minSubtotal)}` : ""}
          {c.perUserLimit != null ? ` · ${c.perUserLimit}/customer` : " · unlimited/customer"}
        </>
      ),
    },
    {
      key: "window",
      header: "Window",
      className: "text-xs text-ink-mute",
      cell: (c) => (
        <>
          {c.startsAt ? formatStamp(c.startsAt) : "now"} → {c.endsAt ? formatStamp(c.endsAt) : "no end"}
          {c.endsAt && c.endsAt < now && <Badge tone="neutral" className="ml-1">expired</Badge>}
          {c.startsAt && c.startsAt > now && <Badge tone="info" className="ml-1">scheduled</Badge>}
        </>
      ),
    },
    { key: "campaign", header: "Campaign", className: "text-xs", cell: (c) => (c.campaign ? <Link href={`/admin/campaigns/${c.campaign.id}`} className="hover:text-sindoor">{c.campaign.name}</Link> : <span className="text-ink-mute">—</span>) },
    {
      key: "usedCount",
      header: "Used",
      sortable: true,
      align: "right",
      className: "tabular-nums",
      cell: (c) => (
        <>
          {c.usedCount}
          {c.usageLimit != null && ` / ${c.usageLimit}`}
          <div className="text-xs text-ink-mute">{usage.get(c.id)?.customers ?? 0} customers</div>
        </>
      ),
    },
    { key: "given", header: "Given away", align: "right", className: "tabular-nums", cell: (c) => rs(usage.get(c.id)?.discount ?? 0) },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (c) =>
        canEdit && c.id !== referral.couponId ? <ConfirmAction action={toggleCoupon.bind(null, c.id, !c.isActive)} label={c.isActive ? "Disable" : "Enable"} variant="ghost" /> : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Coupons"
        description="Percent or rupee codes, free delivery, dabba-scoped offers, first-order and per-customer limits. Usage limits are enforced with a guarded counter and a per-customer lock, so simultaneous checkouts can't over-use a code. One code per order; codes only combine when every one is marked stackable."
        actions={canEdit ? <Link href={`${BASE}/new`} className={buttonClass("primary", "sm")}>New coupon</Link> : undefined}
      />
      <FilterForm basePath={BASE} q={one(sp, "q") ?? ""} placeholder="Code or description" keep={{ sort: params.sort, dir: params.dir, per: params.per }} active={Boolean(q || status || campaign)}>
        <Field label="Status" htmlFor="flt-status">
          <select id="flt-status" name="status" defaultValue={status ?? ""} className="field w-auto">
            <option value="">Any</option>
            <option value="live">Live now</option>
            <option value="scheduled">Scheduled</option>
            <option value="expired">Expired</option>
            <option value="disabled">Disabled</option>
          </select>
        </Field>
        <Field label="Campaign" htmlFor="flt-campaign">
          <select id="flt-campaign" name="campaign" defaultValue={campaign ?? ""} className="field w-auto">
            <option value="">Any</option>
            <option value="none">No campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </FilterForm>
      <DataTable
        basePath={BASE}
        params={params}
        state={state}
        total={total}
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        caption="Coupons"
        empty="No coupons match."
        rowClassName={(c) => (c.isActive && !(c.endsAt && c.endsAt < now) ? undefined : "opacity-60")}
        minWidth={900}
      />
    </>
  );
}
