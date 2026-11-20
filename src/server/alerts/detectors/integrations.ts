import "server-only";
import { db } from "@/lib/db";
import type { Detector, Finding } from "../types";

const DAY = 86_400_000;
const MIN = 60_000;

/**
 * Integration failures that are states: failed job runs (clear when the same run is retried successfully), runs
 * stuck in RUNNING, outbound messages that exhausted their retries, messages skipped because no email/SMS provider
 * is configured (reported honestly, INFO), and gateway payment attempts the reconciler couldn't settle.
 */
export const integrations: Detector = {
  name: "integrations",
  label: "Integration failures",
  mode: "condition",
  async run({ now }) {
    const out: Finding[] = [];
    const week = new Date(now.getTime() - 7 * DAY);
    const failedJobs = await db.jobRun.findMany({ where: { status: "FAILED", startedAt: { gte: week } }, orderBy: { startedAt: "desc" }, take: 100 });
    for (const j of failedJobs)
      out.push({ type: "JOB_FAILED", severity: "CRITICAL", entity: "JobRun", entityId: j.id, key: `job:${j.key}`, message: `Job ${j.name} failed (${j.key}): ${(j.error ?? "unknown error").slice(0, 200)}`, href: `/admin/jobs?status=FAILED&name=${encodeURIComponent(j.name)}`, data: { name: j.name, key: j.key, error: j.error?.slice(0, 500) ?? null } });
    const stuck = await db.jobRun.findMany({ where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - 30 * MIN), gte: week } }, take: 50 });
    for (const j of stuck)
      out.push({ type: "JOB_STUCK", severity: "WARNING", entity: "JobRun", entityId: j.id, key: `job-stuck:${j.key}`, message: `Job ${j.name} has been running since ${j.startedAt.toISOString()} (${j.key}) — it probably crashed; re-run it`, href: `/admin/jobs?status=RUNNING`, data: { name: j.name, key: j.key } });

    const outbox = await db.outboundMessage.groupBy({ by: ["channel", "status"], where: { status: { in: ["FAILED", "SKIPPED"] }, createdAt: { gte: week } }, _count: { _all: true } });
    for (const g of outbox) {
      const n = g._count._all;
      const what = g.channel === "SMS" ? "SMS" : "email";
      if (g.status === "FAILED")
        out.push({ type: "MESSAGES_FAILED", severity: "WARNING", key: `outbox-failed:${g.channel}`, message: `${n} ${what} message${n === 1 ? "" : "s"} failed after all retries in the last 7 days`, href: "/admin/notifications", data: { channel: g.channel, messages: n } });
      else
        out.push({ type: "MESSAGES_NOT_SENT", severity: "INFO", key: `outbox-skipped:${g.channel}`, message: `${n} ${what} message${n === 1 ? "" : "s"} not sent in the last 7 days: no ${what} provider is configured`, href: "/admin/notifications", data: { channel: g.channel, messages: n } });
    }

    const attempts = await db.paymentAttempt.groupBy({
      by: ["method"],
      where: { createdAt: { gte: new Date(now.getTime() - 3 * DAY) }, OR: [{ status: "EXPIRED" }, { status: "STARTED", createdAt: { lt: new Date(now.getTime() - 60 * MIN) }, payment: { status: { in: ["PENDING", "FAILED"] } } }] },
      _count: { _all: true },
    });
    for (const a of attempts) {
      const n = a._count._all;
      out.push({ type: "GATEWAY_RECONCILE", severity: "WARNING", key: `gateway:${a.method}`, message: `${n} ${a.method} payment attempt${n === 1 ? "" : "s"} in the last 3 days couldn't be confirmed with the gateway — check the merchant portal`, href: "/admin/payments?status=PENDING", data: { method: a.method, attempts: n } });
    }
    return out;
  },
};

/** Gateway callbacks/lookups whose amount or reference didn't match our payment (last 7 days). */
export const paymentMismatch: Detector = {
  name: "payment-mismatch",
  label: "Gateway verification mismatches",
  mode: "event",
  async run({ now }) {
    const rows = await db.paymentProviderEvent.findMany({ where: { outcome: "MISMATCH", createdAt: { gte: new Date(now.getTime() - 7 * DAY) } }, select: { id: true, provider: true, paymentId: true, createdAt: true }, take: 100 });
    return rows.map((e) => ({
      type: "GATEWAY_MISMATCH",
      severity: "CRITICAL",
      entity: e.paymentId ? "Payment" : "PaymentProviderEvent",
      entityId: e.paymentId ?? e.id,
      key: e.id,
      message: `${e.provider} verification didn't match our payment record (${e.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC)`,
      href: e.paymentId ? `/admin/payments/${e.paymentId}` : "/admin/payments",
      data: { provider: e.provider, eventId: e.id },
    }));
  },
};
