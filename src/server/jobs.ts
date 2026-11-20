import "server-only";
import type { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { ktmNow } from "@/lib/dates";
import { log } from "@/lib/logger";
import { publishDuePages } from "@/lib/cms/pages";
import { expireUnpaidOrders, lockDay } from "./orders";
import { reconcileGatewayAttempts } from "./payments";
import { completeAndRemind, syncPlanPriceMirrors } from "./subscriptions";
import { processOutbox } from "./notify";
import { publishDueMenus } from "./menu";
import { settleReferralRewards } from "./marketing";
import { CUTOFF_DETECTORS, escalateAlerts, runDetectors } from "./alerts";

/**
 * Run a job at most once per idempotency key. A crashed run (RUNNING for > 15 min) may be retried, and so may a
 * FAILED one. Jobs are written to be safe to repeat anyway; the key just avoids duplicate work.
 */
export async function runOnce<T>(name: string, key: string, fn: () => Promise<T>) {
  const existing = await db.jobRun.findUnique({ where: { key } });
  if (existing?.status === "DONE") return { skipped: true as const, result: existing.result };
  if (existing?.status === "RUNNING" && Date.now() - existing.startedAt.getTime() < 15 * 60_000) return { skipped: true as const, result: null };
  const run = existing
    ? (await db.jobRun.updateMany({ where: { key, status: existing.status, startedAt: existing.startedAt }, data: { status: "RUNNING", startedAt: new Date(), finishedAt: null, error: null } })).count
      ? existing
      : null
    : await db.jobRun.create({ data: { name, key } }).catch(() => null);
  if (!run) return { skipped: true as const, result: null }; // someone else claimed it
  try {
    const result = await fn();
    await db.jobRun.update({ where: { key }, data: { status: "DONE", finishedAt: new Date(), result: JSON.parse(JSON.stringify(result ?? null)) as Prisma.InputJsonValue } });
    return { skipped: false as const, result };
  } catch (e) {
    await db.jobRun.update({ where: { key }, data: { status: "FAILED", finishedAt: new Date(), error: (e instanceof Error ? e.message : String(e)).slice(0, 2000) } });
    log.error("job.failed", { name, key, error: e });
    throw e;
  }
}

// ───────────── steps ─────────────

type StepCtx = { now: Date };
export type JobStep = { name: string; label: string; run: (ctx: StepCtx) => Promise<unknown> };


async function detectorsStep({ now }: StepCtx) {
  const r = await runDetectors({ now });
  // Findings are saved either way; failing the step makes the broken detector visible (JobRun + alert) and retryable.
  if (r.failed.length) throw new Error(`Detectors failed — ${r.failed.join("; ")}`.slice(0, 1500));
  return { raised: r.raised, reopened: r.reopened, resolved: r.resolved, open: r.open };
}

export const STEPS: Record<string, JobStep> = {
  reconcile: { name: "reconcile", label: "Re-check gateway payments", run: () => reconcileGatewayAttempts() },
  plans: { name: "plans", label: "Finish ended plans, renewal reminders", run: () => completeAndRemind() },
  "plan-prices": { name: "plan-prices", label: "Apply scheduled plan prices", run: async () => ({ changed: await syncPlanPriceMirrors() }) },
  menus: { name: "menus", label: "Publish scheduled weekly menus", run: async ({ now }) => { const r = await publishDueMenus(now); return { published: r.filter((x) => x.ok).length, refused: r.filter((x) => !x.ok) }; } },
  pages: { name: "pages", label: "Publish scheduled CMS pages", run: ({ now }) => publishDuePages(now) },
  referrals: { name: "referrals", label: "Settle referral rewards", run: () => settleReferralRewards() },
  detectors: { name: "detectors", label: "Run alert detectors", run: detectorsStep },
  escalation: { name: "escalation", label: "Escalate unacknowledged alerts", run: ({ now }) => escalateAlerts({ now }) },
  outbox: { name: "outbox", label: "Send / retry queued email and SMS", run: () => processOutbox({ limit: 200 }) },
  "cutoff-detectors": { name: "cutoff-detectors", label: "Detectors after the day lock", run: ({ now }) => runDetectors({ now, only: CUTOFF_DETECTORS }).then((r) => ({ raised: r.raised, resolved: r.resolved, failed: r.failed })) },
};

export type JobName = "cutoff" | "housekeeping" | "frequent" | "alerts";

/** Scheduled jobs and their steps (docs/DEPLOYMENT.md → Cron). */
export const JOBS: Record<JobName, { label: string; schedule: string; description: string; steps: string[] }> = {
  cutoff: { label: "Cut-off", schedule: "Daily 04:00 UTC (09:45–10:44 Kathmandu on Hobby)", description: "Locks today for every kitchen, cancels unpaid orders, then re-checks capacity/production alerts.", steps: ["lock-day", "cutoff-detectors"] },
  housekeeping: { label: "Housekeeping", schedule: "Daily 00:15 UTC (06:00–06:59 Kathmandu on Hobby)", description: "Gateway re-checks, plan completion and reminders, scheduled prices/menus/pages, referral rewards, alert detectors, escalation, outbox.", steps: ["reconcile", "plans", "plan-prices", "menus", "pages", "referrals", "detectors", "escalation", "outbox"] },
  frequent: { label: "Frequent", schedule: "Not scheduled on Hobby — on Pro add */15 * * * *", description: "Scheduled publishes, detectors, escalation and the outbox every 15 minutes.", steps: ["menus", "pages", "detectors", "escalation", "outbox"] },
  alerts: { label: "Alerts", schedule: "Manual", description: "Run every detector and the escalation rules now.", steps: ["detectors", "escalation"] },
};

export type StepOutcome = { step: string; key: string; skipped: boolean; result?: unknown; error?: string };

/**
 * Run a job's steps, each under its own JobRun key `<job>.<step>:<bucket>`: a step already DONE for the bucket is
 * skipped, a FAILED one is retried, and one step failing doesn't stop the others.
 */
async function runSteps(job: JobName, bucket: string, now: Date): Promise<{ job: JobName; bucket: string; steps: StepOutcome[]; failed: string[] }> {
  const steps: StepOutcome[] = [];
  for (const name of JOBS[job].steps) {
    const step = STEPS[name];
    if (!step) continue;
    const key = `${job}.${name}:${bucket}`;
    try {
      const r = await runOnce(`${job}.${name}`, key, () => step.run({ now }));
      steps.push({ step: name, key, skipped: r.skipped, result: r.result });
    } catch (e) {
      steps.push({ step: name, key, skipped: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { job, bucket, steps, failed: steps.filter((s) => s.error).map((s) => s.step) };
}

/** After the cut-off: lock today for every kitchen and cancel unpaid orders that can no longer be cooked. */
export async function cutoffJob(opts: { now?: Date; actorId?: string | null } = {}) {
  const s = await getSettings();
  const now = ktmNow(opts.now);
  const out: Record<string, unknown> = { date: now.date };
  if (now.time < s.orderCutoff) return { ...out, note: `Before the ${s.orderCutoff} cut-off — nothing to lock yet` };
  const kitchens = await db.kitchen.findMany({ where: { isActive: true }, select: { id: true, code: true } });
  for (const k of kitchens) out[k.code] = (await runOnce("lock-day", `lock-day:${now.date}:${k.id}`, () => lockDay(k.id, now.date, opts.actorId ?? null))).result;
  out.expired = await expireUnpaidOrders(now);
  const step = STEPS["cutoff-detectors"];
  try {
    out.alerts = (await runOnce("cutoff.cutoff-detectors", `cutoff.cutoff-detectors:${now.date}`, () => step.run({ now: opts.now ?? new Date() }))).result;
  } catch (e) {
    out.alerts = { error: e instanceof Error ? e.message : String(e) };
  }
  return out;
}

/** Daily housekeeping (bucket = Kathmandu date, so a second call the same day only retries failed steps). */
export async function housekeepingJob(opts: { now?: Date; bucket?: string } = {}) {
  const now = opts.now ?? new Date();
  return runSteps("housekeeping", opts.bucket ?? ktmNow(now).date, now);
}

/** Pro plan only: every 15 minutes (bucket = Kathmandu date + quarter hour). */
export async function frequentJob(opts: { now?: Date; bucket?: string } = {}) {
  const now = opts.now ?? new Date();
  const t = ktmNow(now);
  const [h, m] = t.time.split(":").map(Number);
  return runSteps("frequent", opts.bucket ?? `${t.date}T${String(h).padStart(2, "0")}:${String(Math.floor(m / 15) * 15).padStart(2, "0")}`, now);
}

export async function alertsJob(opts: { now?: Date; bucket?: string } = {}) {
  const now = opts.now ?? new Date();
  return runSteps("alerts", opts.bucket ?? `${ktmNow(now).date}T${ktmNow(now).time}`, now);
}

// ───────────── manual runs (/admin/jobs) ─────────────

export class JobError extends Error {}
type JobActor = { id: string; role: Role | string; customGrants?: readonly string[] | null };

/** Manual runs need settings.edit (the registry's guard for /admin/jobs re-runs). */
function needRun(actor: JobActor) {
  if (!can(actor, "settings.edit")) throw new JobError("You don't have permission to run jobs");
}

/**
 * Run a whole job now. Steps get a `manual-<minute>` bucket, so a double click within the same minute is a no-op,
 * and every step is itself idempotent (publish-due, dedupe-keyed alerts, outbox claims). Audited.
 */
export async function runJobManually(actor: JobActor, job: JobName, now = new Date()) {
  needRun(actor);
  if (!JOBS[job]) throw new JobError("Unknown job");
  const bucket = `manual-${now.toISOString().slice(0, 16)}`;
  const out = job === "cutoff" ? { job, bucket, result: await cutoffJob({ now, actorId: actor.id }), failed: [] as string[] } : await runSteps(job, bucket, now);
  await audit({ actorId: actor.id, action: "job.run", entity: "JobRun", entityId: job, summary: `${JOBS[job].label} run manually${out.failed.length ? ` — failed: ${out.failed.join(", ")}` : ""}`, after: { bucket } });
  return out;
}

/** Retry one FAILED (or crashed RUNNING) run under the same key. Audited. */
export async function retryJobRun(actor: JobActor, key: string) {
  needRun(actor);
  const run = await db.jobRun.findUnique({ where: { key } });
  if (!run) throw new JobError("That run doesn't exist");
  const stale = run.status === "RUNNING" && Date.now() - run.startedAt.getTime() >= 15 * 60_000;
  if (run.status !== "FAILED" && !stale) throw new JobError(run.status === "DONE" ? "That run already finished — run the job again instead" : "That run is still in progress");
  let fn: (() => Promise<unknown>) | null = null;
  const lock = /^lock-day:(\d{4}-\d{2}-\d{2}):(.+)$/.exec(key);
  if (lock) fn = () => lockDay(lock[2], lock[1], actor.id);
  const step = /^(?:cutoff|housekeeping|frequent|alerts)\.([a-z-]+):/.exec(key);
  if (step && STEPS[step[1]]) fn = () => STEPS[step[1]].run({ now: new Date() });
  if (!fn) throw new JobError("This run can't be retried from here — run its job again");
  let error: string | null = null;
  try {
    await runOnce(run.name, key, fn);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  await audit({ actorId: actor.id, action: "job.retry", entity: "JobRun", entityId: run.id, summary: `${key}${error ? ` — failed again: ${error.slice(0, 160)}` : " — done"}` });
  return { key, ok: !error, error };
}

/** Latest run per JobRun name (status board) and a filtered, paged history. */
export async function jobOverview(filters: { name?: string; status?: string; page?: number; per?: number } = {}) {
  const per = filters.per ?? 50;
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.JobRunWhereInput = { ...(filters.name ? { name: filters.name } : {}), ...(filters.status ? { status: filters.status } : {}) };
  const [latestIds, rows, total, names] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`SELECT DISTINCT ON (name) id FROM "JobRun" ORDER BY name, "startedAt" DESC`,
    db.jobRun.findMany({ where, orderBy: { startedAt: "desc" }, skip: (page - 1) * per, take: per }),
    db.jobRun.count({ where }),
    db.jobRun.groupBy({ by: ["name", "status"], _count: { _all: true } }),
  ]);
  const latest = await db.jobRun.findMany({ where: { id: { in: latestIds.map((r) => r.id) } }, orderBy: { name: "asc" } });
  const stats = new Map<string, Record<string, number>>();
  for (const g of names) stats.set(g.name, { ...(stats.get(g.name) ?? {}), [g.status]: g._count._all });
  return { latest: latest.map((l) => ({ ...l, counts: stats.get(l.name) ?? {} })), rows, total, page, per };
}

/** Human label for a JobRun name ("housekeeping.menus" → "Housekeeping · Publish scheduled weekly menus"). */
export function jobLabel(name: string) {
  if (name === "lock-day") return "Cut-off · Lock the day";
  const [job, step] = name.split(".");
  const j = JOBS[job as JobName];
  return j && step && STEPS[step] ? `${j.label} · ${STEPS[step].label}` : name;
}
