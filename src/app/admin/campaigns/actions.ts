"use server";

import { done, fail, type ActionResult } from "@/lib/action";
import {
  MarketingError,
  addCampaignSpend,
  decideReferral,
  deleteCampaignSpend,
  deleteCampaignTemplate,
  importLegacySpend,
  runReferralSweep,
  saveCampaign,
  saveCampaignTemplate,
  saveReferralSettings,
} from "@/server/marketing";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

const PATHS = ["/admin/campaigns", "/admin/campaigns/referrals", "/admin/coupons"];

async function run(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MarketingError) {
      if (e.field) throw new FieldError(e.field, e.message);
      return fail(e.message);
    }
    throw e;
  }
}

export async function saveCampaignAction(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("marketing.edit", (user) =>
    run(async () => {
      const c = await saveCampaign(user, id, {
        name: f.str(fd, "name", 120),
        channel: f.str(fd, "channel"),
        utmCampaign: f.opt(fd, "utmCampaign", 100),
        startsOn: f.date(fd, "startsOn"),
        endsOn: f.date(fd, "endsOn"),
        budget: f.moneyOpt(fd, "budget", "Budget"),
        notes: f.opt(fd, "notes", 1000),
        isActive: f.bool(fd, "isActive"),
      });
      return done(id ? "Campaign saved" : "Campaign created", id ? undefined : `/admin/campaigns/${c.id}`);
    }),
  PATHS);
}

export async function addSpendAction(campaignId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("marketing.edit", (user) =>
    run(async () => {
      await addCampaignSpend(user, campaignId, { date: f.str(fd, "date"), amount: f.money(fd, "amount", "Amount"), note: f.opt(fd, "note", 200) });
      return done("Spend recorded");
    }),
  PATHS);
}

export async function deleteSpendAction(spendId: string): Promise<ActionResult> {
  return guarded("marketing.edit", (user) =>
    run(async () => {
      await deleteCampaignSpend(user, spendId);
      return done("Removed");
    }),
  PATHS);
}

export async function importLegacySpendAction(): Promise<ActionResult> {
  return guarded("marketing.edit", (user) =>
    run(async () => {
      const r = await importLegacySpend(user);
      return done(r.imported ? `Imported ${r.imported} month(s)` : "Nothing new to import");
    }),
  PATHS);
}

export async function saveTemplateAction(campaignId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("marketing.edit", (user) =>
    run(async () => {
      await saveCampaignTemplate(user, campaignId, { channel: f.str(fd, "channel"), locale: f.str(fd, "locale"), subject: f.opt(fd, "subject", 200), body: f.str(fd, "body", 10000), isActive: f.bool(fd, "isActive") });
      return done("Template saved");
    }),
  PATHS);
}

export async function deleteTemplateAction(templateId: string): Promise<ActionResult> {
  return guarded("marketing.edit", (user) =>
    run(async () => {
      await deleteCampaignTemplate(user, templateId);
      return done("Template removed");
    }),
  PATHS);
}

export async function saveReferralSettingsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("marketing.edit", (user) =>
    run(async () => {
      const type = f.str(fd, "refereeType") === "PERCENT" ? "PERCENT" : "FLAT";
      await saveReferralSettings(user, {
        enabled: f.bool(fd, "enabled"),
        refereeType: type,
        refereeValue: type === "PERCENT" ? f.int(fd, "refereeValue", 0) : f.money(fd, "refereeValue", "Friend's discount"),
        refereeMaxDiscount: f.moneyOpt(fd, "refereeMaxDiscount", "Max discount"),
        refereeMinSubtotal: f.moneyOpt(fd, "refereeMinSubtotal", "Minimum order") ?? 0,
        referrerReward: f.money(fd, "referrerReward", "Reward"),
        maxRewardsPerReferrer: f.int(fd, "maxRewardsPerReferrer", 0),
        maxRewardsPerMonth: f.int(fd, "maxRewardsPerMonth", 0),
      });
      return done("Referral settings saved");
    }),
  PATHS);
}

export async function runReferralSweepAction(): Promise<ActionResult> {
  return guarded("marketing.edit", (user) =>
    run(async () => {
      const c = await runReferralSweep(user);
      return done(`Rewarded ${c.REWARDED} · held ${c.HELD} · capped ${c.CAPPED}`);
    }),
  PATHS);
}

export async function decideReferralAction(referralId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("marketing.edit", (user) =>
    run(async () => {
      const approve = f.str(fd, "decision") === "approve";
      const r = await decideReferral(user, referralId, approve, f.str(fd, "note", 300));
      return done(approve ? (r.settled?.outcome === "REWARDED" ? "Approved and rewarded" : "Approved — rewarded after the friend's first delivered, paid order") : "Rejected");
    }),
  PATHS);
}
