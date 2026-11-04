import { NextResponse } from "next/server";
import { cutoffJob, housekeepingJob } from "@/server/jobs";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron (vercel.json). Authenticated with CRON_SECRET (Vercel sends it as a Bearer token).
 * ?job=cutoff runs after the order cut-off; ?job=housekeeping runs early morning. Both are idempotent.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const job = new URL(req.url).searchParams.get("job") ?? "all";
  try {
    const out: Record<string, unknown> = {};
    if (job === "cutoff" || job === "all") out.cutoff = await cutoffJob();
    if (job === "housekeeping" || job === "all") out.housekeeping = await housekeepingJob();
    log.info("cron.done", { job });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
