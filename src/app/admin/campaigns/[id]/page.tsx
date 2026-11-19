import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { addDays, isValidISODate, isoDate, todayKTM } from "@/lib/dates";
import { rs, rupeesInput } from "@/lib/money";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, StatCard, Callout } from "@/components/admin/ui";
import { FilterForm, Field, DateRangeFields } from "@/components/admin/Filters";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Checkbox, Textarea } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Badge";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import {
  CAMPAIGN_STATUS_LABEL,
  CHANNELS,
  CHANNEL_LABEL,
  campaignDetail,
  campaignPerformance,
  campaignStatus,
  campaignTemplates,
  deliveryStatus,
  type AttributionModel,
} from "@/server/marketing";
import { addSpendAction, deleteSpendAction, deleteTemplateAction, saveCampaignAction, saveTemplateAction } from "../actions";

const ymd = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(d) : "");
const ND = "no data";

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string; model?: string }> }) {
  const user = await requirePermission("marketing.view");
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === "new";
  const c = isNew ? null : await campaignDetail(user, id);
  if (!isNew && !c) notFound();
  const canEdit = can(user, "marketing.edit");
  const today = todayKTM();
  const to = sp.to && isValidISODate(sp.to) ? sp.to : c?.endsAt && ymd(c.endsAt) < today ? ymd(c.endsAt) : today;
  const from = sp.from && isValidISODate(sp.from) && sp.from <= to ? sp.from : c?.startsAt && ymd(c.startsAt) <= to ? ymd(c.startsAt) : addDays(to, -29);
  const model: AttributionModel = sp.model === "first" ? "first" : "last";
  const [perfMap, templates, status] = c ? await Promise.all([campaignPerformance(user, { from, to, model, campaignIds: [c.id] }), campaignTemplates(user, c.id), deliveryStatus()]) : [null, [], null];
  const p = c ? perfMap?.get(c.id) : undefined;
  const st = c ? campaignStatus(c) : null;

  return (
    <>
      <PageHeader title={isNew ? "New campaign" : c!.name} back={{ href: "/admin/campaigns", label: "Campaigns" }} description={st ? `${CAMPAIGN_STATUS_LABEL[st]} · ${CHANNEL_LABEL[c!.channel as keyof typeof CHANNEL_LABEL] ?? c!.channel}` : undefined} />
      {c && p && (
        <>
          <FilterForm basePath={`/admin/campaigns/${c.id}`} q={null} active={Boolean(sp.from || sp.to || sp.model)}>
            <DateRangeFields from={from} to={to} label="Period" />
            <Field label="Attribution" htmlFor="flt-model">
              <select id="flt-model" name="model" defaultValue={model} className="field w-auto">
                <option value="last">Last touch</option>
                <option value="first">First touch</option>
              </select>
            </Field>
          </FilterForm>
          <div className="mb-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Spend" value={p.spend ? rs(p.spend) : ND} sub={c.budget != null ? `${rs(p.spendToDate)} of ${rs(c.budget)} budget to date` : "no budget set"} tone={c.budget != null && p.spendToDate > c.budget ? "warn" : "default"} />
            <StatCard label="Sign-ups" value={p.signups == null ? "needs a UTM key" : p.signups} />
            <StatCard label="Orders" value={p.hasData ? p.orders : ND} sub={p.orders ? `${rs(p.ordersValue)} booked` : undefined} />
            <StatCard label="Plans" value={p.hasData ? p.plans : ND} sub={p.plans ? `${rs(p.plansValue)} booked` : undefined} />
            <StatCard label="New customers" value={p.hasData ? p.newCustomers : ND} sub={p.cac != null ? `CAC ${rs(p.cac)}` : undefined} />
            <StatCard label="Recognised revenue" value={p.revenue == null ? "needs analytics access" : p.deliveredOrders ? rs(p.revenue) : ND} sub={p.roas != null ? `ROAS ${p.roas.toFixed(2)}×` : `${p.deliveredOrders} delivered`} tone="brand" />
          </div>
          {p.couponRedemptions > 0 && (
            <p className="mb-4 text-sm text-ink-mute">
              Linked coupons were redeemed {p.couponRedemptions} time(s) in this period, giving away {rs(p.couponDiscount)}.
            </p>
          )}
        </>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <ActionForm action={saveCampaignAction.bind(null, isNew ? null : c!.id)}>
          <fieldset disabled={!canEdit}>
            <Panel title="Details">
              <div className="grid gap-4 md:grid-cols-2">
                <Input name="name" label="Name" defaultValue={c?.name} />
                <Select name="channel" label="Channel" defaultValue={c?.channel ?? "FACEBOOK"} options={CHANNELS.map((x) => ({ value: x, label: CHANNEL_LABEL[x] }))} />
                <Input name="utmCampaign" label="UTM campaign key" defaultValue={c?.utmCampaign ?? ""} className="font-mono" hint="Use in ad links as utm_campaign=… (matched case-insensitively)" />
                <Input name="budget" label="Budget (Rs)" defaultValue={c?.budget != null ? rupeesInput(c.budget) : ""} hint="Blank = no budget" />
                <Input name="startsOn" type="date" label="Starts" defaultValue={ymd(c?.startsAt)} />
                <Input name="endsOn" type="date" label="Ends" defaultValue={ymd(c?.endsAt)} />
                <Textarea name="notes" label="Notes" defaultValue={c?.notes ?? ""} className="md:col-span-2" rows={3} />
                <Checkbox name="isActive" label="Active" hint="Paused campaigns keep their history and attribution" defaultChecked={c?.isActive ?? true} />
              </div>
              {canEdit && <SubmitButton className="mt-5">{isNew ? "Create campaign" : "Save campaign"}</SubmitButton>}
            </Panel>
          </fieldset>
        </ActionForm>

        {c && (
          <Panel title="Spend entries" bodyClass="p-0">
            {canEdit && (
              <ActionForm action={addSpendAction.bind(null, c.id)} resetOnSuccess className="flex flex-wrap items-end gap-2 border-b border-ink-line/60 p-3">
                <Input name="date" type="date" label="Date" defaultValue={today} />
                <Input name="amount" label="Amount (Rs)" className="w-32" />
                <Input name="note" label="Note" className="min-w-40 flex-1" />
                <SubmitButton size="sm">Add</SubmitButton>
              </ActionForm>
            )}
            <Table className="rounded-none border-0 shadow-none">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Note</Th>
                  <Th className="text-right">Amount</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {c.spend.length === 0 && <EmptyRow colSpan={4}>No spend recorded.</EmptyRow>}
                {c.spend.map((s) => (
                  <tr key={s.id}>
                    <Td className="text-xs">{isoDate(s.date)}</Td>
                    <Td className="text-xs text-ink-mute">{s.note ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{rs(s.amount)}</Td>
                    <Td className="text-right">{canEdit && <ConfirmAction action={deleteSpendAction.bind(null, s.id)} label="Remove" variant="ghost" confirm="Remove this spend entry?" />}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )}

        {c && (
          <Panel title="Linked coupons">
            {c.coupons.length === 0 ? (
              <p className="text-sm text-ink-mute">
                No coupons linked. Link one from its{" "}
                <Link href="/admin/coupons" className="font-semibold underline">
                  coupon page
                </Link>{" "}
                (Campaign field).
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {c.coupons.map((k) => (
                  <li key={k.id}>
                    <Link href={`/admin/coupons/${k.id}`} className="font-mono font-bold hover:text-sindoor">
                      {k.code}
                    </Link>{" "}
                    <span className="text-ink-mute">
                      used {k.usedCount}
                      {k.usageLimit != null ? ` / ${k.usageLimit}` : ""}
                    </span>
                    {!k.isActive && <Badge className="ml-1">disabled</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {c && status && (
          <Panel title="Messages (email / SMS templates)">
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge tone={status.email ? "good" : "warn"}>Email {status.email ? "provider connected" : "not configured"}</Badge>
              <Badge tone={status.sms ? "good" : "warn"}>SMS {status.sms ? "provider connected" : "not configured"}</Badge>
              <Badge>
                {status.audience.optedIn} opted-in customer(s) · {status.audience.withPhone} with a verified phone
              </Badge>
            </div>
            <Callout tone="warn" className="mb-4">
              Templates are saved for this campaign, but nothing is sent from here: campaign broadcasts aren&apos;t built yet, and email/SMS need a configured provider (Resend domain, SMS sender ID). Only customers who opted in to marketing may be messaged.
            </Callout>
            {templates.map((t) => (
              <div key={t.id} className="mb-3 rounded-lg border border-ink-line/60 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-ink-mute">
                    {t.channel.toLowerCase()} · {t.locale}
                    {!t.isActive && " · off"}
                  </span>
                  {canEdit && <ConfirmAction action={deleteTemplateAction.bind(null, t.id)} label="Remove" variant="ghost" confirm="Remove this template?" />}
                </div>
                {t.subject && <p className="font-semibold">{t.subject}</p>}
                <p className="whitespace-pre-wrap text-ink-soft">{t.body}</p>
              </div>
            ))}
            {canEdit && (
              <ActionForm action={saveTemplateAction.bind(null, c.id)} className="grid gap-3 md:grid-cols-2">
                <Select name="channel" label="Channel" options={[{ value: "EMAIL", label: "Email" }, { value: "SMS", label: "SMS" }]} />
                <Select name="locale" label="Language" options={[{ value: "en", label: "English" }, { value: "ne", label: "Nepali" }]} />
                <Input name="subject" label="Subject (email)" className="md:col-span-2" />
                <Textarea name="body" label="Message" hint="Use {{name}} for the customer's name. SMS: 480 characters max. Saving the same channel + language replaces it." className="md:col-span-2" rows={4} />
                <Checkbox name="isActive" label="Active" defaultChecked />
                <div className="md:col-span-2">
                  <SubmitButton size="sm">Save template</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
