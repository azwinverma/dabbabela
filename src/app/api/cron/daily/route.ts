import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { alertsJob, cutoffJob, frequentJob, housekeepingJob } from "@/server/jobs";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOBS = ["cutoff", "housekeeping", "frequent", "alerts", "all"] as const;
type Job = (typeof JOBS)[number];

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const have = Buffer.from(got);
  return have.length === want.length && timingSafeEqual(have, want);
}

/**
 * Vercel Cron (vercel.json). Authenticated with CRON_SECRET (Vercel sends it as a Bearer token).
 * ?job=cutoff runs after the order cut-off; ?job=housekeeping runs early morning; ?job=frequent is for a Pro
 * `*\/15` schedule; ?job=alerts runs detectors + escalation. Every step is idempotent and recorded as a JobRun.
 */
export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = new URL(req.url).searchParams.get("job") ?? "all";
  if (!(JOBS as readonly string[]).includes(raw)) return NextResponse.json({ error: "unknown job" }, { status: 400 });
  const job = raw as Job;
  try {
    const out: Record<string, unknown> = {};
    const failed: string[] = [];
    if (job === "cutoff" || job === "all") out.cutoff = await cutoffJob();
    for (const [name, fn] of [
      ["housekeeping", housekeepingJob],
      ["frequent", frequentJob],
      ["alerts", alertsJob],
    ] as const) {
      if (job !== name && !(job === "all" && name === "housekeeping")) continue;
      const r = await fn();
      out[name] = r;
      failed.push(...r.failed.map((s) => `${name}.${s}`));
    }
    log.info("cron.done", { job, failed });
    return NextResponse.json({ ok: failed.length === 0, failed, ...out }, { status: failed.length ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
