import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { addDays, isValidISODate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { PageHeader, Table, Th, Td, EmptyRow, StatCard, Callout } from "@/components/admin/ui";
import { CampaignTabs } from "./_components/CampaignTabs";
import { FilterForm, Field, DateRangeFields } from "@/components/admin/Filters";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { CAMPAIGN_STATUS_LABEL, CHANNEL_LABEL, campaignPerformance, campaignStatus, listCampaigns, type AttributionModel, type Channel } from "@/server/marketing";
import { SPEND_KEY } from "@/server/reports";
import { importLegacySpendAction } from "./actions";

export const metadata = { title: "Campaigns" };
const TONE = { RUNNING: "good", SCHEDULED: "info", ENDED: "neutral", PAUSED: "warn" } as const;
const ND = <span className="text-ink-mute">no data</span>;

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; model?: string }> }) {
  const user = await requirePermission("marketing.view");
  const sp = await searchParams;
  const today = todayKTM();
  const to = sp.to && isValidISODate(sp.to) ? sp.to : today;
  const from = sp.from && isValidISODate(sp.from) && sp.from <= to ? sp.from : addDays(to, -29);
  const model: AttributionModel = sp.model === "first" ? "first" : "last";
  const canEdit = can(user, "marketing.edit");
  const [campaigns, legacy] = await Promise.all([listCampaigns(user), db.setting.findUnique({ where: { key: SPEND_KEY } })]);
  const perf = await campaignPerformance(user, { from, to, model });
  const rows = campaigns.map((c) => ({ c, p: perf.get(c.id)! }));
  const totals = rows.reduce(
    (a, { p }) => ({ spend: a.spend + p.spend, orders: a.orders + p.orders, plans: a.plans + p.plans, newCustomers: a.newCustomers + p.newCustomers, revenue: p.revenue == null ? null : (a.revenue ?? 0) + p.revenue }),
    { spend: 0, orders: 0, plans: 0, newCustomers: 0, revenue: 0 as number | null },
  );
  const legacyMonths = Object.keys((legacy?.value as Record<string, unknown> | null) ?? {}).length;

  return (
    <>
      <PageHeader
        title="Campaigns & referrals"
        description="Campaigns with a UTM key, spend entries and the orders, plans and sign-ups they brought. Figures come from stored attribution only — nothing is estimated."
        actions={canEdit ? <Link href="/admin/campaigns/new" className={buttonClass("primary", "sm")}>New campaign</Link> : undefined}
      />
      <CampaignTabs current="campaigns" />
      <FilterForm basePath="/admin/campaigns" q={null} active={Boolean(sp.from || sp.to || sp.model)}>
        <DateRangeFields from={from} to={to} label="Period" />
        <Field label="Attribution" htmlFor="flt-model">
          <select id="flt-model" name="model" defaultValue={model} className="field w-auto">
            <option value="last">Last touch (checkout)</option>
            <option value="first">First touch (sign-up)</option>
          </select>
        </Field>
      </FilterForm>
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="Spend" value={rs(totals.spend)} sub={`${from} → ${to}`} />
        <StatCard label="Orders + plans" value={totals.orders + totals.plans} sub={`${totals.orders} orders · ${totals.plans} plans (booked)`} />
        <StatCard label="New customers" value={totals.newCustomers} sub="first booked order in the period" />
        <StatCard label="Recognised revenue" value={totals.revenue == null ? "needs analytics access" : rs(totals.revenue)} sub="Delivered: total − VAT − refunds" tone="brand" />
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Campaign</Th>
            <Th>Status</Th>
            <Th className="text-right">Spend</Th>
            <Th className="text-right">Sign-ups</Th>
            <Th className="text-right">Orders</Th>
            <Th className="text-right">Plans</Th>
            <Th className="text-right">New customers</Th>
            <Th className="text-right">Revenue</Th>
            <Th className="text-right">ROAS</Th>
            <Th className="text-right">CAC</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={10}>No campaigns yet. Create one and use its UTM key in your ad links (utm_campaign=…).</EmptyRow>}
          {rows.map(({ c, p }) => {
            const st = campaignStatus(c);
            const over = c.budget != null && p.spendToDate > c.budget;
            return (
              <tr key={c.id}>
                <Td>
                  <Link href={`/admin/campaigns/${c.id}`} className="font-semibold hover:text-sindoor">
                    {c.name}
                  </Link>
                  <div className="text-xs text-ink-mute">
                    {CHANNEL_LABEL[c.channel as Channel] ?? c.channel}
                    {c.utmCampaign ? <span className="font-mono"> · {c.utmCampaign}</span> : " · no UTM key"}
                  </div>
                </Td>
                <Td>
                  <Badge tone={TONE[st]}>{CAMPAIGN_STATUS_LABEL[st]}</Badge>
                  {over && <Badge tone="bad" className="ml-1">over budget</Badge>}
                </Td>
                <Td className="text-right tabular-nums">
                  {p.spend ? rs(p.spend) : ND}
                  {c.budget != null && <div className="text-xs text-ink-mute">{rs(p.spendToDate)} / {rs(c.budget)}</div>}
                </Td>
                <Td className="text-right tabular-nums">{p.signups == null ? ND : p.signups}</Td>
                <Td className="text-right tabular-nums">{p.hasData ? p.orders : ND}</Td>
                <Td className="text-right tabular-nums">{p.hasData ? p.plans : ND}</Td>
                <Td className="text-right tabular-nums">{p.hasData ? p.newCustomers : ND}</Td>
                <Td className="text-right tabular-nums">{p.revenue == null ? "—" : p.deliveredOrders ? rs(p.revenue) : ND}</Td>
                <Td className="text-right tabular-nums">{p.roas == null ? ND : `${p.roas.toFixed(2)}×`}</Td>
                <Td className="text-right tabular-nums">{p.cac == null ? ND : rs(p.cac)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Callout tone="info" className="mt-4" title="How attribution works">
        <b>Last touch</b>: an order counts when the customer&apos;s most recent consented campaign link before checkout had this UTM key (plan meals count for the plan&apos;s campaign); a sign-up counts by the last touch stored at sign-up.{" "}
        <b>First touch</b>: everything a customer does counts for the campaign of their very first visit. Orders and plans use the bookings basis (placed in the period, not pending or
        cancelled); revenue uses the recognised basis from Analytics (Delivered orders by delivery date, total − VAT − refunds). ROAS = revenue ÷ spend; CAC = spend ÷ new customers.
        Visitors who declined the cookie notice are never attributed.
      </Callout>
      {canEdit && legacyMonths > 0 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <span className="text-ink-mute">{legacyMonths} month(s) of spend recorded in the old Reports setting.</span>
          <ConfirmAction action={importLegacySpendAction} label="Import as spend entries" confirm="Create spend entries for each month (skips months already imported)?" />
        </div>
      )}
    </>
  );
}
