import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { ktmNow } from "@/lib/dates";
import { log } from "@/lib/logger";
import { expireUnpaidOrders, lockDay } from "./orders";
import { reconcileGatewayAttempts } from "./payments";
import { completeAndRemind } from "./subscriptions";
import { processOutbox } from "./notify";

/**
 * Run a job at most once per idempotency key. A crashed run (RUNNING for > 15 min) may be retried.
 * Jobs are written to be safe to repeat anyway; the key just avoids duplicate work.
 */
export async function runOnce<T>(name: string, key: string, fn: () => Promise<T>) {
  const existing = await db.jobRun.findUnique({ where: { key } });
  if (existing?.status === "DONE") return { skipped: true as const, result: existing.result };
  if (existing?.status === "RUNNING" && Date.now() - existing.startedAt.getTime() < 15 * 60_000) return { skipped: true as const, result: null };
  const run = existing
    ? await db.jobRun.update({ where: { key }, data: { status: "RUNNING", startedAt: new Date(), error: null } })
    : await db.jobRun.create({ data: { name, key } }).catch(() => null);
  if (!run) return { skipped: true as const, result: null };
  try {
    const result = await fn();
    await db.jobRun.update({ where: { key }, data: { status: "DONE", finishedAt: new Date(), result: JSON.parse(JSON.stringify(result ?? null)) as Prisma.InputJsonValue } });
    return { skipped: false as const, result };
  } catch (e) {
    await db.jobRun.update({ where: { key }, data: { status: "FAILED", finishedAt: new Date(), error: e instanceof Error ? e.message : String(e) } });
    log.error("job.failed", { name, key, error: e });
    throw e;
  }
}

/** After the cut-off: lock today for every kitchen and cancel unpaid orders that can no longer be cooked. */
export async function cutoffJob() {
  const s = await getSettings();
  const now = ktmNow();
  const out: Record<string, unknown> = { date: now.date };
  if (now.time < s.orderCutoff) return { ...out, note: `Before the ${s.orderCutoff} cut-off — nothing to lock yet` };
  const kitchens = await db.kitchen.findMany({ where: { isActive: true }, select: { id: true, code: true } });
  for (const k of kitchens) out[k.code] = (await runOnce("lock-day", `lock-day:${now.date}:${k.id}`, () => lockDay(k.id, now.date, null))).result;
  out.expired = await expireUnpaidOrders(now);
  return out;
}

export async function housekeepingJob() {
  const [reconcile, plans, outbox] = await Promise.all([reconcileGatewayAttempts(), completeAndRemind(), processOutbox({ limit: 200 })]);
  return { reconcile, plans, outbox };
}
