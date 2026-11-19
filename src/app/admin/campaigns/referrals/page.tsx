import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatStamp } from "@/lib/dates";
import { rs, rupeesInput } from "@/lib/money";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, StatCard, Callout } from "@/components/admin/ui";
import { FilterForm, Field } from "@/components/admin/Filters";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Checkbox } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Badge";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { REFERRAL_STATUSES, getReferralSettings, listReferrals, referralTotals, type ReferralStatus } from "@/server/marketing";
import { CampaignTabs } from "../_components/CampaignTabs";
import { decideReferralAction, runReferralSweepAction, saveReferralSettingsAction } from "../actions";

export const metadata = { title: "Referrals" };
const TONE: Record<ReferralStatus, "neutral" | "info" | "warn" | "good" | "bad"> = { PENDING: "info", HELD: "warn", APPROVED: "info", QUALIFIED: "neutral", REWARDED: "good", REJECTED: "bad" };
const LABEL: Record<ReferralStatus, string> = { PENDING: "Waiting for first order", HELD: "Held for review", APPROVED: "Cleared by staff", QUALIFIED: "Qualified — cap reached", REWARDED: "Rewarded", REJECTED: "Rejected" };

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requirePermission("marketing.view");
  const sp = await searchParams;
  const status = (REFERRAL_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const canEdit = can(user, "marketing.edit");
  const [settings, rows, totals] = await Promise.all([getReferralSettings(), listReferrals(user, { status }), referralTotals(user)]);

  return (
    <>
      <PageHeader title="Campaigns & referrals" description="Every customer gets a referral code. A new customer who uses a friend's code gets a welcome discount on their first order; the friend gets wallet credit once that order is delivered and paid." />
      <CampaignTabs current="referrals" />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="Programme" value={settings.enabled ? "On" : "Off"} tone={settings.enabled ? "good" : "warn"} />
        <StatCard label="Referrals" value={Object.values(totals.byStatus).reduce((a, b) => a + b, 0)} sub={`${totals.byStatus.PENDING ?? 0} waiting · ${totals.byStatus.HELD ?? 0} held`} />
        <StatCard label="Rewards paid" value={totals.rewardCount} sub={rs(totals.rewarded)} />
        <StatCard label="Held for review" value={totals.byStatus.HELD ?? 0} tone={totals.byStatus.HELD ? "warn" : "default"} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_2fr]">
        <ActionForm action={saveReferralSettingsAction}>
          <fieldset disabled={!canEdit}>
            <Panel title="Settings">
              <div className="grid gap-4 sm:grid-cols-2">
                <Checkbox name="enabled" label="Programme on" defaultChecked={settings.enabled} className="sm:col-span-2" />
                <Select name="refereeType" label="Friend's discount" defaultValue={settings.refereeType} options={[{ value: "FLAT", label: "Rupees off" }, { value: "PERCENT", label: "Percent off" }]} />
                <Input name="refereeValue" label="Value (Rs or %)" defaultValue={settings.refereeType === "PERCENT" ? String(settings.refereeValue) : rupeesInput(settings.refereeValue)} />
                <Input name="refereeMaxDiscount" label="Max discount (Rs)" defaultValue={settings.refereeMaxDiscount != null ? rupeesInput(settings.refereeMaxDiscount) : ""} />
                <Input name="refereeMinSubtotal" label="Minimum first order (Rs)" defaultValue={settings.refereeMinSubtotal ? rupeesInput(settings.refereeMinSubtotal) : ""} />
                <Input name="referrerReward" label="Reward to referrer (Rs)" defaultValue={rupeesInput(settings.referrerReward)} hint="Credited to their wallet" />
                <span />
                <Input name="maxRewardsPerReferrer" type="number" min={1} label="Max rewards per customer" defaultValue={settings.maxRewardsPerReferrer} />
                <Input name="maxRewardsPerMonth" type="number" min={1} label="Max rewards per month" defaultValue={settings.maxRewardsPerMonth} />
              </div>
              {canEdit && <SubmitButton className="mt-5">Save settings</SubmitButton>}
            </Panel>
          </fieldset>
          <Callout tone="info" className="mt-4" title="Rules">
            No self-referral; one referral per new customer, only before their first order; one reward per referred friend (credited exactly once). A shared phone number, delivery address or device (IP + browser) puts the referral on hold for review. Rewards are paid when the friend&apos;s first order is <b>delivered and paid</b> — automatically when that happens if the order flow calls the hook, otherwise with the button here (and the scheduled job once it exists). The referral terms still need a legal review.
          </Callout>
        </ActionForm>
        <div>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <FilterForm basePath="/admin/campaigns/referrals" q={null} active={Boolean(status)}>
              <Field label="Status" htmlFor="flt-status">
                <select id="flt-status" name="status" defaultValue={status ?? ""} className="field w-auto">
                  <option value="">Any</option>
                  {REFERRAL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </FilterForm>
            {canEdit && <ConfirmAction action={runReferralSweepAction} label="Pay qualifying rewards now" confirm="Credit every referrer whose friend's first order is delivered and paid?" />}
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Referrer</Th>
                <Th>Friend</Th>
                <Th>Status</Th>
                <Th className="text-right">Reward</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={5}>No referrals yet.</EmptyRow>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/admin/customers/${r.code.user.id}`} className="font-semibold hover:text-sindoor">
                      {r.code.user.name}
                    </Link>
                    <div className="font-mono text-xs text-ink-mute">{r.code.code}</div>
                  </Td>
                  <Td>
                    <Link href={`/admin/customers/${r.referee.id}`} className="hover:text-sindoor">
                      {r.referee.name}
                    </Link>
                    <div className="text-xs text-ink-mute">linked {formatStamp(r.createdAt)}</div>
                  </Td>
                  <Td>
                    <Badge tone={TONE[r.status as ReferralStatus] ?? "neutral"}>{LABEL[r.status as ReferralStatus] ?? r.status}</Badge>
                    {r.signals.length > 0 && <div className="mt-1 text-xs text-besar-dark">{r.signals.join(", ")}</div>}
                    {r.qualifiedOrderId && (
                      <div className="text-xs">
                        <Link href={`/admin/orders/${r.qualifiedOrderId}`} className="text-ink-mute hover:text-sindoor">
                          qualifying order
                        </Link>
                      </div>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{r.reward ? <>{rs(r.reward.amount)}<div className="text-xs text-ink-mute">{formatStamp(r.reward.createdAt)}</div></> : "—"}</Td>
                  <Td className="text-right">
                    {canEdit && !["REWARDED", "REJECTED"].includes(r.status) && (
                      <ActionForm action={decideReferralAction.bind(null, r.id)} className="flex flex-col items-end gap-1">
                        <input name="note" aria-label="Decision note" placeholder="Note (required)" className="field h-8 w-40 text-xs" />
                        <div className="flex gap-1">
                          {r.status === "HELD" && (
                            <button name="decision" value="approve" className="rounded bg-saag px-2 py-1 text-xs font-semibold text-white">
                              Approve
                            </button>
                          )}
                          <button name="decision" value="reject" className="rounded bg-sindoor px-2 py-1 text-xs font-semibold text-white">
                            Reject
                          </button>
                        </div>
                      </ActionForm>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </>
  );
}
