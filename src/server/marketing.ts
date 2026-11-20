import "server-only";
import { randomInt } from "node:crypto";
import { Prisma, type Coupon, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can, type Permission } from "@/lib/permissions";
import { dateOnly, isValidISODate, isoDate, monthRange } from "@/lib/dates";
import { rs } from "@/lib/money";
import { emailConfigured } from "./notify/email";
import { smsConfigured } from "./notify/sms";
import { lockUser } from "./capacity";
import { SPEND_KEY } from "./reports";
import { dayRange, ktmStart, stampRange, type AnalyticsFilters } from "./analytics/filters";
import { bookingsOrderWhere, bookingsPlanWhere, recognisedWhere } from "./analytics/revenue";
import { NOT_BOOKED } from "./analytics/metrics";

/**
 * Promotions and marketing (WP-15): campaigns + spend, campaign attribution and performance, referral codes with
 * wallet rewards and fraud rules, campaign message templates. Coupons live in `coupons.ts`.
 *
 * Every staff-facing function takes the acting user and checks `marketing.*` itself (pages and actions check too).
 *
 * ── Attribution (documented model) ──
 *  · Last touch (default): an order counts for campaign X when `Order.campaignId = X` (the consented last — else
 *    first — touch at checkout, WP-11) or when it is a meal of a plan with `Subscription.campaignId = X`.
 *    A plan counts when `Subscription.campaignId = X`. A sign-up counts when the last touch stored on the user
 *    (`User.attribution.last.campaign`, else the first touch) equals `Campaign.utmCampaign`.
 *  · First touch: everything a customer does counts for the campaign of their first touch
 *    (`User.attribution.campaign` = `Campaign.utmCampaign`, case-insensitive).
 *  Revenue uses the analytics *recognised* basis (Σ total − VAT − refunded of Delivered orders by delivery date,
 *  `analytics/revenue.ts recognisedWhere`); orders and plans use the *bookings* basis (`bookingsOrderWhere`,
 *  `bookingsPlanWhere`). Nothing is estimated: no data → null, shown as "no data".
 */

export type Actor = { id: string; role: Role | string; customGrants?: readonly string[] | null };
type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

export class MarketingError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

function need(actor: Actor, perm: Permission) {
  if (!can(actor, perm)) throw new MarketingError(`You don't have permission for this (${perm})`);
}

// ═════════════════════════════ Campaigns ═════════════════════════════

export const CHANNELS = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "GOOGLE", "FLYER", "REFERRAL", "OTHER"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = { FACEBOOK: "Facebook", INSTAGRAM: "Instagram", TIKTOK: "TikTok", GOOGLE: "Google", FLYER: "Flyer / print", REFERRAL: "Referral", OTHER: "Other" };

export type CampaignStatus = "RUNNING" | "SCHEDULED" | "ENDED" | "PAUSED";
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { RUNNING: "Running", SCHEDULED: "Scheduled", ENDED: "Ended", PAUSED: "Paused" };

export function campaignStatus(c: { isActive: boolean; startsAt: Date | null; endsAt: Date | null }, now = new Date()): CampaignStatus {
  if (!c.isActive) return "PAUSED";
  if (c.startsAt && c.startsAt > now) return "SCHEDULED";
  if (c.endsAt && c.endsAt < now) return "ENDED";
  return "RUNNING";
}

export type CampaignInput = {
  name: string;
  channel: string;
  utmCampaign?: string | null;
  startsOn?: string | null; // YYYY-MM-DD (Kathmandu)
  endsOn?: string | null;
  budget?: number | null; // paisa
  notes?: string | null;
  isActive: boolean;
};

export async function saveCampaign(actor: Actor, id: string | null, input: CampaignInput) {
  need(actor, "marketing.edit");
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new MarketingError("Give the campaign a name", "name");
  if (!(CHANNELS as readonly string[]).includes(input.channel)) throw new MarketingError("Pick a channel", "channel");
  const utm = input.utmCampaign?.trim().replace(/[^A-Za-z0-9_.\-]/g, "").slice(0, 100) || null;
  if (input.utmCampaign?.trim() && !utm) throw new MarketingError("Use letters, numbers, dot, dash or underscore", "utmCampaign");
  if (utm) {
    const clash = await db.campaign.findFirst({ where: { utmCampaign: { equals: utm, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) }, select: { name: true } });
    if (clash) throw new MarketingError(`"${clash.name}" already uses that UTM campaign key`, "utmCampaign");
  }
  for (const k of ["startsOn", "endsOn"] as const) if (input[k] && !isValidISODate(input[k]!)) throw new MarketingError("Enter a valid date", k);
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) throw new MarketingError("Ends before it starts", "endsOn");
  if (input.budget != null && (!Number.isInteger(input.budget) || input.budget < 0)) throw new MarketingError("Budget must be a rupee amount", "budget");
  const data = {
    name,
    channel: input.channel,
    utmCampaign: utm,
    startsAt: input.startsOn ? ktmStart(input.startsOn) : null,
    endsAt: input.endsOn ? new Date(`${input.endsOn}T23:59:59.999+05:45`) : null,
    budget: input.budget ?? null,
    notes: input.notes?.trim().slice(0, 1000) || null,
    isActive: input.isActive,
  };
  const before = id ? await db.campaign.findUnique({ where: { id } }) : null;
  if (id && !before) throw new MarketingError("Campaign not found");
  const c = id ? await db.campaign.update({ where: { id }, data }) : await db.campaign.create({ data });
  await audit({ actorId: actor.id, action: id ? "campaign.update" : "campaign.create", entity: "Campaign", entityId: c.id, summary: c.name, before, after: data });
  return c;
}

export async function addCampaignSpend(actor: Actor, campaignId: string, input: { date: string; amount: number; note?: string | null }) {
  need(actor, "marketing.edit");
  if (!isValidISODate(input.date)) throw new MarketingError("Enter the date of the spend", "date");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new MarketingError("Enter the amount spent", "amount");
  const c = await db.campaign.findUnique({ where: { id: campaignId }, select: { id: true, name: true } });
  if (!c) throw new MarketingError("Campaign not found");
  const s = await db.campaignSpend.create({ data: { campaignId, date: dateOnly(input.date), amount: input.amount, note: input.note?.trim().slice(0, 200) || null } });
  await audit({ actorId: actor.id, action: "campaign.spend_add", entity: "Campaign", entityId: campaignId, summary: `${c.name}: ${rs(input.amount)} on ${input.date}`, after: { spendId: s.id, date: input.date, amount: input.amount, note: s.note } });
  return s;
}

export async function deleteCampaignSpend(actor: Actor, spendId: string, reason?: string | null) {
  need(actor, "marketing.edit");
  const s = await db.campaignSpend.findUnique({ where: { id: spendId }, include: { campaign: { select: { name: true } } } });
  if (!s) throw new MarketingError("Spend entry not found");
  await db.campaignSpend.delete({ where: { id: spendId } });
  await audit({ actorId: actor.id, action: "campaign.spend_delete", entity: "Campaign", entityId: s.campaignId, summary: `${s.campaign.name}: removed ${rs(s.amount)} on ${isoDate(s.date)}`, before: { spendId: s.id, date: isoDate(s.date), amount: s.amount, note: s.note }, reason: reason?.trim() || null });
}

export const LEGACY_CAMPAIGN_NAME = "Monthly marketing spend (imported)";

/**
 * Move the old per-month figures (`Setting` "marketing.spend" = { "YYYY-MM": paisa }) into spend entries on one
 * campaign, dated the 1st of each month. Idempotent: a month already imported is skipped. The setting is left in
 * place (the old CAC report still reads it).
 */
export async function importLegacySpend(actor: Actor) {
  need(actor, "marketing.edit");
  const row = await db.setting.findUnique({ where: { key: SPEND_KEY } });
  const months = Object.entries((row?.value as Record<string, unknown> | null) ?? {}).filter(([ym, v]) => /^\d{4}-\d{2}$/.test(ym) && typeof v === "number" && Number.isInteger(v) && v > 0) as [string, number][];
  if (!months.length) return { imported: 0, skipped: 0, campaignId: null as string | null };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('marketing:legacy-spend'))`;
    let c = await tx.campaign.findFirst({ where: { name: LEGACY_CAMPAIGN_NAME } });
    if (!c) c = await tx.campaign.create({ data: { name: LEGACY_CAMPAIGN_NAME, channel: "OTHER", notes: "Monthly totals moved from the old Reports → marketing spend setting.", isActive: false } });
    const have = new Set((await tx.campaignSpend.findMany({ where: { campaignId: c.id }, select: { note: true } })).map((s) => s.note));
    let imported = 0;
    for (const [ym, amount] of months) {
      const note = `imported:${ym}`;
      if (have.has(note)) continue;
      await tx.campaignSpend.create({ data: { campaignId: c.id, date: dateOnly(`${ym}-01`), amount, note } });
      imported++;
    }
    await audit({ actorId: actor.id, action: "campaign.spend_import", entity: "Campaign", entityId: c.id, summary: `Imported ${imported} month(s) of legacy spend`, after: { months: months.map(([ym]) => ym), imported } });
    return { imported, skipped: months.length - imported, campaignId: c.id };
  });
}

// ───────────── performance ─────────────

export type AttributionModel = "last" | "first";

export type CampaignPerf = {
  campaignId: string;
  spend: number; // in the range
  spendToDate: number; // all time (for the budget)
  signups: number | null; // null = no UTM key, can't be measured
  orders: number; // single orders booked in the range
  ordersValue: number; // their booked total
  plans: number; // plans bought in the range
  plansValue: number;
  newCustomers: number;
  revenue: number | null; // recognised; null without analytics.view
  deliveredOrders: number;
  couponRedemptions: number;
  couponDiscount: number;
  roas: number | null;
  cac: number | null;
  hasData: boolean;
};

/** Users whose stored first (or last) touch names this UTM campaign. */
async function usersForUtm(utm: string, which: "first" | "last", createdIn?: { gte: Date; lt: Date }) {
  const key = utm.toLowerCase();
  const field =
    which === "first"
      ? Prisma.sql`lower(u.attribution->>'campaign')`
      : Prisma.sql`lower(coalesce(u.attribution->'last'->>'campaign', u.attribution->>'campaign'))`;
  const created = createdIn ? Prisma.sql`AND u."createdAt" >= ${createdIn.gte} AND u."createdAt" < ${createdIn.lt}` : Prisma.empty;
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT u.id FROM "User" u WHERE u.attribution IS NOT NULL AND ${field} = ${key} ${created}`;
  return rows.map((r) => r.id);
}

/** Order / plan conditions for one campaign under a model. */
async function attributionWhere(c: { id: string; utmCampaign: string | null }, model: AttributionModel) {
  if (model === "last") {
    return {
      order: { OR: [{ campaignId: c.id }, { subscription: { campaignId: c.id } }] } satisfies Prisma.OrderWhereInput,
      plan: { campaignId: c.id } satisfies Prisma.SubscriptionWhereInput,
    };
  }
  const ids = c.utmCampaign ? await usersForUtm(c.utmCampaign, "first") : [];
  return { order: { userId: { in: ids } } satisfies Prisma.OrderWhereInput, plan: { userId: { in: ids } } satisfies Prisma.SubscriptionWhereInput };
}

const sum = (v: number | null | undefined) => v ?? 0;

/**
 * Spend, conversions and attributable revenue per campaign for [from, to] (Kathmandu days). Campaign figures are
 * company-wide (spend isn't per kitchen). Revenue needs `analytics.view` as on the analytics pages.
 */
export async function campaignPerformance(actor: Actor, opts: { from: string; to: string; model?: AttributionModel; campaignIds?: string[] }): Promise<Map<string, CampaignPerf>> {
  need(actor, "marketing.view");
  const model = opts.model ?? "last";
  const showRevenue = can(actor, "analytics.view");
  const f: AnalyticsFilters = { from: opts.from, to: opts.to, kitchenIds: null };
  const stamps = stampRange(opts.from, opts.to);
  const campaigns = await db.campaign.findMany({ where: opts.campaignIds ? { id: { in: opts.campaignIds } } : {}, select: { id: true, utmCampaign: true } });
  const ids = campaigns.map((c) => c.id);
  const [spendIn, spendAll] = await Promise.all([
    db.campaignSpend.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids }, date: dayRange(opts.from, opts.to) }, _sum: { amount: true } }),
    db.campaignSpend.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids } }, _sum: { amount: true } }),
  ]);
  const out = new Map<string, CampaignPerf>();
  for (const c of campaigns) {
    const attr = await attributionWhere(c, model);
    const [signupIds, booked, plans, recog, attributedUsers, coupons] = await Promise.all([
      c.utmCampaign ? usersForUtm(c.utmCampaign, model, stamps) : Promise.resolve(null),
      db.order.aggregate({ where: { AND: [bookingsOrderWhere(f), attr.order] }, _sum: { total: true }, _count: true }),
      db.subscription.aggregate({ where: { AND: [bookingsPlanWhere(f), attr.plan] }, _sum: { total: true }, _count: true }),
      db.order.aggregate({ where: { AND: [recognisedWhere(f), attr.order] }, _sum: { total: true, tax: true, refundedAmount: true }, _count: true }),
      db.order.findMany({ where: { AND: [{ createdAt: stamps, status: { notIn: NOT_BOOKED } }, attr.order] }, select: { userId: true }, distinct: ["userId"] }),
      db.couponRedemption.aggregate({ where: { coupon: { campaignId: c.id }, createdAt: stamps }, _sum: { amount: true }, _count: true }),
    ]);
    // New customer = their first booked order ever was placed in the range (and they have an attributed one in it).
    const uids = attributedUsers.map((u) => u.userId);
    const firsts = uids.length ? await db.order.groupBy({ by: ["userId"], where: { userId: { in: uids }, status: { notIn: NOT_BOOKED } }, _min: { createdAt: true } }) : [];
    const newCustomers = firsts.filter((r) => r._min.createdAt && r._min.createdAt >= stamps.gte && r._min.createdAt < stamps.lt).length;
    const spend = sum(spendIn.find((s) => s.campaignId === c.id)?._sum.amount);
    const revenueRaw = sum(recog._sum.total) - sum(recog._sum.tax) - sum(recog._sum.refundedAmount);
    const revenue = showRevenue ? revenueRaw : null;
    const perf: CampaignPerf = {
      campaignId: c.id,
      spend,
      spendToDate: sum(spendAll.find((s) => s.campaignId === c.id)?._sum.amount),
      signups: signupIds ? signupIds.length : null,
      orders: booked._count,
      ordersValue: sum(booked._sum.total),
      plans: plans._count,
      plansValue: sum(plans._sum.total),
      newCustomers,
      revenue,
      deliveredOrders: recog._count,
      couponRedemptions: coupons._count,
      couponDiscount: sum(coupons._sum.amount),
      roas: revenue != null && spend > 0 ? revenue / spend : null,
      cac: spend > 0 && newCustomers > 0 ? Math.round(spend / newCustomers) : null,
      hasData: false,
    };
    perf.hasData = Boolean(perf.spend || perf.signups || perf.orders || perf.plans || perf.deliveredOrders || perf.couponRedemptions);
    out.set(c.id, perf);
  }
  return out;
}

export async function listCampaigns(actor: Actor) {
  need(actor, "marketing.view");
  return db.campaign.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }], include: { _count: { select: { coupons: true, spend: true } } } });
}

export async function campaignDetail(actor: Actor, id: string) {
  need(actor, "marketing.view");
  return db.campaign.findUnique({
    where: { id },
    include: {
      spend: { orderBy: { date: "desc" }, take: 200 },
      coupons: { select: { id: true, code: true, isActive: true, usedCount: true, usageLimit: true } },
    },
  });
}

// ───────────── campaign message templates (NotificationTemplate) ─────────────

export const templateKey = (campaignId: string) => `campaign.${campaignId}`;
export const TEMPLATE_CHANNELS = ["EMAIL", "SMS"] as const;
const SMS_MAX = 480;

/** What can actually be sent today. Nothing is sent from here: broadcasting is not built (see the tracker). */
export async function deliveryStatus() {
  const base = { role: "CUSTOMER" as const, isActive: true, deletedAt: null, marketingOptIn: true };
  const [optedIn, withPhone] = await Promise.all([db.user.count({ where: base }), db.user.count({ where: { ...base, phoneNumberVerified: true, phoneNumber: { not: null } } })]);
  return { email: emailConfigured(), sms: smsConfigured(), audience: { optedIn, withPhone } };
}

export async function campaignTemplates(actor: Actor, campaignId: string) {
  need(actor, "marketing.view");
  return db.notificationTemplate.findMany({ where: { key: templateKey(campaignId) }, orderBy: [{ channel: "asc" }, { locale: "asc" }] });
}

export async function saveCampaignTemplate(actor: Actor, campaignId: string, input: { channel: string; locale: string; subject?: string | null; body: string; isActive?: boolean }) {
  need(actor, "marketing.edit");
  const c = await db.campaign.findUnique({ where: { id: campaignId }, select: { id: true, name: true } });
  if (!c) throw new MarketingError("Campaign not found");
  if (!(TEMPLATE_CHANNELS as readonly string[]).includes(input.channel)) throw new MarketingError("Pick email or SMS", "channel");
  const locale = input.locale === "ne" ? "ne" : "en";
  const body = input.body.trim();
  if (!body) throw new MarketingError("Write the message", "body");
  if (input.channel === "SMS" && body.length > SMS_MAX) throw new MarketingError(`SMS is limited to ${SMS_MAX} characters`, "body");
  if (input.channel === "EMAIL" && !input.subject?.trim()) throw new MarketingError("Emails need a subject", "subject");
  const key = templateKey(campaignId);
  const before = await db.notificationTemplate.findUnique({ where: { key_channel_locale: { key, channel: input.channel, locale } } });
  const data = { subject: input.channel === "EMAIL" ? input.subject!.trim().slice(0, 200) : null, body: body.slice(0, 10000), isActive: input.isActive ?? true };
  const t = await db.notificationTemplate.upsert({ where: { key_channel_locale: { key, channel: input.channel, locale } }, create: { key, channel: input.channel, locale, ...data }, update: data });
  await audit({ actorId: actor.id, action: "campaign.template_save", entity: "Campaign", entityId: campaignId, summary: `${c.name}: ${input.channel.toLowerCase()} (${locale})`, before, after: { channel: input.channel, locale, ...data } });
  return t;
}

export async function deleteCampaignTemplate(actor: Actor, templateId: string) {
  need(actor, "marketing.edit");
  const t = await db.notificationTemplate.findUnique({ where: { id: templateId } });
  if (!t || !t.key.startsWith("campaign.")) throw new MarketingError("Template not found");
  await db.notificationTemplate.delete({ where: { id: templateId } });
  await audit({ actorId: actor.id, action: "campaign.template_delete", entity: "Campaign", entityId: t.key.slice("campaign.".length), summary: `${t.channel.toLowerCase()} (${t.locale})`, before: t });
}

// ═════════════════════════════ Referrals ═════════════════════════════

export const REFERRAL_SETTINGS_KEY = "marketing.referrals";

/**
 * Statuses (Referral.status is a free string):
 *  PENDING   linked; waiting for the referee's first delivered + paid order
 *  HELD      a fraud signal matched (same phone / address / device); staff approve or reject
 *  APPROVED  staff cleared a hold; rewarded on the qualifying order without re-checking signals
 *  QUALIFIED the qualifying order happened but a cap (or a zero reward) stopped the reward; retried by the sweep
 *  REWARDED  the referrer's wallet was credited (exactly once: `rewardLedgerId`)
 *  REJECTED  refused by staff
 */
export const REFERRAL_STATUSES = ["PENDING", "HELD", "APPROVED", "QUALIFIED", "REWARDED", "REJECTED"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
const SETTLEABLE: ReferralStatus[] = ["PENDING", "APPROVED", "QUALIFIED"];

export type ReferralSettings = {
  enabled: boolean;
  refereeType: "PERCENT" | "FLAT";
  refereeValue: number; // percent or paisa
  refereeMaxDiscount: number | null; // paisa
  refereeMinSubtotal: number; // paisa
  referrerReward: number; // paisa credited to the referrer's wallet
  maxRewardsPerReferrer: number;
  maxRewardsPerMonth: number;
  couponId: string | null; // the backing welcome coupon (managed here, never typed directly)
};

export const DEFAULT_REFERRAL_SETTINGS: ReferralSettings = {
  enabled: false,
  refereeType: "FLAT",
  refereeValue: 100_00,
  refereeMaxDiscount: null,
  refereeMinSubtotal: 0,
  referrerReward: 150_00,
  maxRewardsPerReferrer: 20,
  maxRewardsPerMonth: 5,
  couponId: null,
};

export async function getReferralSettings(client: Client = db): Promise<ReferralSettings> {
  const row = await client.setting.findUnique({ where: { key: REFERRAL_SETTINGS_KEY } });
  const v = (row?.value ?? {}) as Partial<ReferralSettings>;
  return { ...DEFAULT_REFERRAL_SETTINGS, ...v };
}

const WELCOME_CODE = "REFERRAL-WELCOME";

export async function saveReferralSettings(actor: Actor, input: Omit<ReferralSettings, "couponId">) {
  need(actor, "marketing.edit");
  if (input.refereeType === "PERCENT" && (input.refereeValue < 1 || input.refereeValue > 100)) throw new MarketingError("Percent must be 1–100", "refereeValue");
  if (input.refereeType === "FLAT" && input.refereeValue <= 0) throw new MarketingError("Enter the friend's discount", "refereeValue");
  if (input.referrerReward < 0 || input.referrerReward > 5_000_00) throw new MarketingError("Reward must be between Rs 0 and Rs 5,000", "referrerReward");
  if (!Number.isInteger(input.maxRewardsPerReferrer) || input.maxRewardsPerReferrer < 1) throw new MarketingError("At least 1", "maxRewardsPerReferrer");
  if (!Number.isInteger(input.maxRewardsPerMonth) || input.maxRewardsPerMonth < 1) throw new MarketingError("At least 1", "maxRewardsPerMonth");
  const before = await getReferralSettings();
  const couponData = {
    description: "Welcome discount from a friend's referral",
    type: input.refereeType,
    value: input.refereeValue,
    scope: "ALL" as const,
    minSubtotal: input.refereeMinSubtotal,
    maxDiscount: input.refereeMaxDiscount,
    perUserLimit: 1,
    firstOrderOnly: true,
    stackable: false,
    isActive: input.enabled,
  };
  let couponId = before.couponId && (await db.coupon.findUnique({ where: { id: before.couponId }, select: { id: true } })) ? before.couponId : null;
  if (couponId) await db.coupon.update({ where: { id: couponId }, data: couponData });
  else {
    let code = WELCOME_CODE;
    while (await db.coupon.findUnique({ where: { code }, select: { id: true } })) code = `${WELCOME_CODE}-${randomCode(4)}`;
    couponId = (await db.coupon.create({ data: { code, ...couponData } })).id;
  }
  const value: ReferralSettings = { ...input, couponId };
  await db.setting.upsert({ where: { key: REFERRAL_SETTINGS_KEY }, create: { key: REFERRAL_SETTINGS_KEY, value }, update: { value } });
  await audit({ actorId: actor.id, action: "referral.settings", entity: "Setting", entityId: REFERRAL_SETTINGS_KEY, summary: input.enabled ? "Referral programme on" : "Referral programme off", before, after: value });
  return value;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** The customer's own referral code (created on first use: up to 4 letters of the name + 4 random characters). */
export async function ensureReferralCode(userId: string) {
  const existing = await db.referralCode.findUnique({ where: { userId } });
  if (existing) return existing;
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const prefix = (u.name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "DABBA").padEnd(4, "X");
  for (let i = 0; i < 8; i++) {
    const code = `${prefix}${randomCode(4)}`;
    if (await db.coupon.findUnique({ where: { code }, select: { id: true } })) continue;
    try {
      return await db.referralCode.create({ data: { userId, code } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const mine = await db.referralCode.findUnique({ where: { userId } });
        if (mine) return mine; // created concurrently
        continue; // code collision: try another
      }
      throw e;
    }
  }
  throw new MarketingError("Couldn't create a referral code — please try again");
}

// ───────────── fraud signals ─────────────

const digits = (s: string | null | undefined) => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
};
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function footprint(userId: string, client: Client) {
  const [u, addresses, orders, sessions, logins] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { phoneNumber: true } }),
    client.address.findMany({ where: { userId }, select: { phone: true, line1: true, area: true, lat: true, lng: true } }),
    client.order.findMany({ where: { userId }, select: { contactPhone: true, addressLine: true, area: true, lat: true, lng: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    client.session.findMany({ where: { userId }, select: { ipAddress: true, userAgent: true }, take: 50 }),
    client.loginEvent.findMany({ where: { userId, success: true }, select: { ip: true, userAgent: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const phones = new Set([u?.phoneNumber, ...addresses.map((a) => a.phone), ...orders.map((o) => o.contactPhone)].map(digits).filter((x): x is string => Boolean(x)));
  const places = new Set(
    [...addresses.map((a) => [a.line1, a.area]), ...orders.map((o) => [o.addressLine, o.area])]
      .map(([l, a]) => (norm(l) ? `${norm(l)}|${norm(a)}` : null))
      .filter((x): x is string => Boolean(x)),
  );
  const points = [...addresses, ...orders].filter((p) => p.lat != null && p.lng != null).map((p) => [p.lat!, p.lng!] as const);
  const devices = new Set(
    [...sessions.map((s) => [s.ipAddress, s.userAgent]), ...logins.map((l) => [l.ip, l.userAgent])].filter(([ip, ua]) => ip && ua).map(([ip, ua]) => `${ip}|${ua}`),
  );
  return { phones, places, points, devices };
}

/** Heuristics that put a referral on hold: the two accounts share a phone number, a delivery address or a device. */
export async function fraudSignals(referrerId: string, refereeId: string, client: Client = db): Promise<string[]> {
  const [a, b] = await Promise.all([footprint(referrerId, client), footprint(refereeId, client)]);
  const out: string[] = [];
  if ([...a.phones].some((p) => b.phones.has(p))) out.push("same phone number");
  const near = a.points.some(([la, lo]) => b.points.some(([lb, lob]) => Math.abs(la - lb) < 0.0003 && Math.abs(lo - lob) < 0.0003));
  if ([...a.places].some((p) => b.places.has(p)) || near) out.push("same delivery address");
  if ([...a.devices].some((d) => b.devices.has(d))) out.push("same device (IP + browser)");
  return out;
}

// ───────────── claim + checkout ─────────────

export type ClaimResult = { ok: true; referralId: string; status: string } | { ok: false; error: string };

async function hasBooked(userId: string, client: Client) {
  const [orders, plans] = await Promise.all([
    client.order.count({ where: { userId, status: { notIn: NOT_BOOKED } } }),
    client.subscription.count({ where: { userId, status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] } } }),
  ]);
  return orders + plans > 0;
}

/**
 * Link a new customer (the referee) to a friend's code. Refused: own code, a second code, customers who already
 * ordered, staff accounts. A matching fraud signal links the referral as HELD (reviewed by staff).
 */
export async function claimReferral(userId: string, rawCode: string): Promise<ClaimResult> {
  const code = rawCode.trim().toUpperCase();
  const s = await getReferralSettings();
  if (!s.enabled) return { ok: false, error: "Referral discounts aren't running right now" };
  const rc = await db.referralCode.findUnique({ where: { code }, include: { user: { select: { id: true, isActive: true, deletedAt: true } } } });
  if (!rc) return { ok: false, error: "We couldn't find that referral code" };
  if (rc.userId === userId) return { ok: false, error: "You can't use your own referral code" };
  const me = await db.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!me || me.role !== "CUSTOMER" || !me.isActive) return { ok: false, error: "Referral codes are for customer accounts" };
  if (!rc.user.isActive || rc.user.deletedAt) return { ok: false, error: "That referral code is no longer active" };
  const existing = await db.referral.findUnique({ where: { refereeId: userId } });
  if (existing) return existing.codeId === rc.id ? { ok: true, referralId: existing.id, status: existing.status } : { ok: false, error: "You've already used a friend's code" };
  if (await hasBooked(userId, db)) return { ok: false, error: "Referral codes are for new customers, before their first order" };
  const signals = await fraudSignals(rc.userId, userId);
  const status: ReferralStatus = signals.length ? "HELD" : "PENDING";
  try {
    const r = await db.referral.create({ data: { codeId: rc.id, refereeId: userId, status, note: signals.length ? `Held at sign-up: ${signals.join(", ")}`.slice(0, 500) : null } });
    await audit({ actorId: userId, action: "referral.claim", entity: "Referral", entityId: r.id, summary: `Code ${rc.code}${signals.length ? ` — held: ${signals.join(", ")}` : ""}`, after: { codeId: rc.id, referrerId: rc.userId, status, signals } });
    return { ok: true, referralId: r.id, status };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.referral.findUnique({ where: { refereeId: userId } });
      if (again?.codeId === rc.id) return { ok: true, referralId: again.id, status: again.status };
      return { ok: false, error: "You've already used a friend's code" };
    }
    throw e;
  }
}

/**
 * Checkout: a typed code that is a referral code → the welcome coupon for this referee (claiming the referral if it
 * isn't linked yet and the customer is new). null = not a referral code.
 */
export async function referralCouponFor(userId: string, code: string, client: Client = db): Promise<{ ok: true; coupon: Coupon } | { ok: false; error: string } | null> {
  const rc = await client.referralCode.findUnique({ where: { code }, select: { id: true } });
  if (!rc) return null;
  const s = await getReferralSettings(client);
  const coupon = s.enabled && s.couponId ? await client.coupon.findUnique({ where: { id: s.couponId } }) : null;
  if (!coupon || !coupon.isActive) return { ok: false, error: "Referral discounts aren't running right now" };
  const existing = await client.referral.findUnique({ where: { refereeId: userId } });
  if (existing) {
    if (existing.codeId !== rc.id) return { ok: false, error: "You've already used a friend's code" };
    if (existing.status === "REJECTED") return { ok: false, error: "This referral can't be used" };
    return { ok: true, coupon };
  }
  const claim = await claimReferral(userId, code);
  return claim.ok ? { ok: true, coupon } : claim;
}

/** Inside the order transaction: the welcome coupon needs a live referral for this customer. */
export async function assertReferralRedeemable(tx: Tx, couponId: string, userId: string) {
  const s = await getReferralSettings(tx);
  if (!s.couponId || s.couponId !== couponId) return;
  const r = await tx.referral.findUnique({ where: { refereeId: userId }, select: { status: true } });
  if (!r || r.status === "REJECTED") throw new Error("This referral discount isn't available on your account");
}

// ───────────── rewards ─────────────

export type SettleResult = { referralId: string; outcome: "REWARDED" | "ALREADY" | "NOT_YET" | "HELD" | "CAPPED" | "SKIPPED"; ledgerId?: string };

class Abort extends Error {}

/**
 * Reward the referrer once the referee has a DELIVERED and paid order. Atomic and idempotent: the referrer's ledger
 * is locked, the referral row is moved to REWARDED with a conditional update in the same transaction as the wallet
 * credit, so concurrent or repeated calls credit exactly once.
 */
export async function settleReferral(referralId: string): Promise<SettleResult> {
  const s = await getReferralSettings();
  try {
    return await db.$transaction(async (tx) => {
      const pre = await tx.referral.findUnique({ where: { id: referralId }, include: { code: { select: { userId: true, code: true } } } });
      if (!pre) return { referralId, outcome: "SKIPPED" as const };
      await lockUser(tx, pre.code.userId);
      const r = await tx.referral.findUniqueOrThrow({ where: { id: referralId } });
      if (r.status === "REWARDED" || r.rewardLedgerId) return { referralId, outcome: "ALREADY" as const };
      if (!SETTLEABLE.includes(r.status as ReferralStatus)) return { referralId, outcome: "SKIPPED" as const };
      const order = await tx.order.findFirst({
        where: { userId: r.refereeId, status: "DELIVERED", paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
        orderBy: [{ deliveredAt: "asc" }, { createdAt: "asc" }],
        select: { id: true, number: true },
      });
      if (!order) return { referralId, outcome: "NOT_YET" as const };
      if (r.status === "PENDING") {
        const signals = await fraudSignals(pre.code.userId, r.refereeId, tx);
        if (signals.length) {
          await tx.referral.update({ where: { id: r.id }, data: { status: "HELD", qualifiedOrderId: order.id, note: `Held at reward: ${signals.join(", ")}`.slice(0, 500) } });
          await audit({ action: "referral.hold", entity: "Referral", entityId: r.id, summary: `Held at reward: ${signals.join(", ")}`, after: { signals, orderId: order.id } });
          return { referralId, outcome: "HELD" as const };
        }
      }
      const monthStart = ktmStart(monthRange().start);
      const [total, month] = await Promise.all([
        tx.referral.count({ where: { codeId: r.codeId, status: "REWARDED" } }),
        tx.creditLedger.count({ where: { userId: pre.code.userId, reason: "REFERRAL", createdAt: { gte: monthStart } } }),
      ]);
      if (s.referrerReward <= 0 || total >= s.maxRewardsPerReferrer || month >= s.maxRewardsPerMonth) {
        await tx.referral.update({ where: { id: r.id }, data: { status: r.status === "APPROVED" ? "APPROVED" : "QUALIFIED", qualifiedOrderId: order.id } });
        return { referralId, outcome: "CAPPED" as const };
      }
      const ledger = await tx.creditLedger.create({
        data: { userId: pre.code.userId, amount: s.referrerReward, reason: "REFERRAL", orderId: order.id, note: `Referral reward — a friend's first order (${order.number})` },
      });
      const n = await tx.referral.updateMany({
        where: { id: r.id, status: { in: SETTLEABLE }, rewardLedgerId: null },
        data: { status: "REWARDED", rewardLedgerId: ledger.id, qualifiedOrderId: order.id, rewardedAt: ledger.createdAt },
      });
      if (n.count !== 1) throw new Abort();
      await audit({ action: "referral.reward", entity: "Referral", entityId: r.id, summary: `${rs(s.referrerReward)} to the referrer (code ${pre.code.code})`, after: { ledgerId: ledger.id, amount: s.referrerReward, orderId: order.id, referrerId: pre.code.userId } });
      return { referralId, outcome: "REWARDED" as const, ledgerId: ledger.id };
    });
  } catch (e) {
    if (e instanceof Abort) return { referralId, outcome: "ALREADY" };
    throw e;
  }
}

/** Hook for order delivery / payment: settle the referee's referral if there is one (safe to call any time). */
export async function settleReferralFor(refereeId: string) {
  const r = await db.referral.findUnique({ where: { refereeId }, select: { id: true, status: true } });
  if (!r || !SETTLEABLE.includes(r.status as ReferralStatus)) return null;
  return settleReferral(r.id);
}

/** Settle the open referrals of one referrer (their referral page). Returns how many changed state. */
export async function settleReferralsOf(referrerId: string) {
  const open = await db.referral.findMany({ where: { code: { userId: referrerId }, status: { in: SETTLEABLE }, rewardLedgerId: null }, select: { id: true } });
  let changed = 0;
  for (const r of open) {
    const res = await settleReferral(r.id);
    if (res.outcome === "REWARDED" || res.outcome === "HELD") changed++;
  }
  return changed;
}

/** Sweep (admin button / cron): settle every open referral whose referee has a delivered + paid order. */
export async function settleReferralRewards(limit = 500) {
  const open = await db.referral.findMany({
    where: { status: { in: SETTLEABLE }, rewardLedgerId: null, referee: { orders: { some: { status: "DELIVERED", paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] } } } } },
    select: { id: true },
    take: limit,
  });
  const counts: Record<SettleResult["outcome"], number> = { REWARDED: 0, ALREADY: 0, NOT_YET: 0, HELD: 0, CAPPED: 0, SKIPPED: 0 };
  for (const r of open) counts[(await settleReferral(r.id)).outcome]++;
  return counts;
}

export async function runReferralSweep(actor: Actor) {
  need(actor, "marketing.edit");
  const counts = await settleReferralRewards();
  await audit({ actorId: actor.id, action: "referral.sweep", entity: "Referral", summary: `Rewarded ${counts.REWARDED}, held ${counts.HELD}, capped ${counts.CAPPED}`, after: counts });
  return counts;
}

/** Staff decision on a HELD (or open) referral. Approve clears a hold; reject stops it for good. */
export async function decideReferral(actor: Actor, referralId: string, approve: boolean, note: string) {
  need(actor, "marketing.edit");
  if (!note.trim()) throw new MarketingError("Add a note explaining the decision", "note");
  const r = await db.referral.findUnique({ where: { id: referralId } });
  if (!r) throw new MarketingError("Referral not found");
  if (r.status === "REWARDED" || r.status === "REJECTED") throw new MarketingError(`Already ${r.status.toLowerCase()}`);
  if (approve && r.status !== "HELD") throw new MarketingError("Only held referrals need approval");
  const to: ReferralStatus = approve ? "APPROVED" : "REJECTED";
  const n = await db.referral.updateMany({ where: { id: r.id, status: r.status }, data: { status: to, note: `${approve ? "Approved" : "Rejected"}: ${note.trim()}`.slice(0, 500) } });
  if (n.count !== 1) throw new MarketingError("It changed meanwhile — reload and try again");
  await audit({ actorId: actor.id, action: approve ? "referral.approve" : "referral.reject", entity: "Referral", entityId: r.id, summary: note.trim().slice(0, 200), before: { status: r.status }, after: { status: to }, reason: note.trim() });
  const settled = approve ? await settleReferral(r.id) : null;
  return { status: to, settled };
}

export async function listReferrals(actor: Actor, opts: { status?: string; take?: number } = {}) {
  need(actor, "marketing.view");
  const rows = await db.referral.findMany({
    where: opts.status ? { status: opts.status } : {},
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 200,
    include: { code: { select: { code: true, user: { select: { id: true, name: true } } } }, referee: { select: { id: true, name: true, createdAt: true } } },
  });
  const ledgers = await db.creditLedger.findMany({ where: { id: { in: rows.map((r) => r.rewardLedgerId).filter((x): x is string => Boolean(x)) } }, select: { id: true, amount: true, createdAt: true } });
  const held = rows.filter((r) => r.status === "HELD");
  const signals = new Map<string, string[]>();
  for (const r of held) signals.set(r.id, await fraudSignals(r.code.user.id, r.refereeId));
  return rows.map((r) => ({ ...r, reward: ledgers.find((l) => l.id === r.rewardLedgerId) ?? null, signals: signals.get(r.id) ?? [] }));
}

export async function referralTotals(actor: Actor) {
  need(actor, "marketing.view");
  const [byStatus, rewards] = await Promise.all([
    db.referral.groupBy({ by: ["status"], _count: true }),
    db.creditLedger.aggregate({ where: { reason: "REFERRAL" }, _sum: { amount: true }, _count: true }),
  ]);
  return { byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])) as Record<string, number>, rewarded: rewards._sum.amount ?? 0, rewardCount: rewards._count };
}

/** The customer's referral page: own code, friends referred (first names only), rewards and the friend's code they used. */
export async function myReferrals(userId: string) {
  const [settings, code, received] = await Promise.all([
    getReferralSettings(),
    db.referralCode.findUnique({ where: { userId }, include: { referrals: { orderBy: { createdAt: "desc" }, include: { referee: { select: { name: true } } } } } }),
    db.referral.findUnique({ where: { refereeId: userId }, include: { code: { select: { code: true } } } }),
  ]);
  const rewards = await db.creditLedger.aggregate({ where: { userId, reason: "REFERRAL" }, _sum: { amount: true }, _count: true });
  const canClaim = !received && !(await hasBooked(userId, db));
  return {
    settings,
    code: code?.code ?? null,
    friends: (code?.referrals ?? []).map((r) => ({ id: r.id, name: r.referee.name.split(/\s+/)[0] || "A friend", status: r.status as ReferralStatus, at: r.createdAt })),
    rewarded: rewards._sum.amount ?? 0,
    rewardCount: rewards._count,
    received: received ? { code: received.code.code, status: received.status as ReferralStatus } : null,
    canClaim,
  };
}
