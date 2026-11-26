import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emailConfigured } from "@/server/notify/email";
import { smsConfigured } from "@/server/notify/sms";
import { pushConfigured } from "@/server/notify/push";
import { esewaConfigured, gatewayConfigProblem, khaltiConfigured, paymentsLive } from "@/server/payments/methods";
import { turnstileEnabled } from "@/lib/turnstile";
import { sentryConfigured } from "@/lib/sentry-options";

export const dynamic = "force-dynamic";

/** Liveness + dependency check for uptime monitors. Exposes no data, only booleans. */
export async function GET() {
  const started = Date.now();
  let database = false;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  const failedJobs = database ? await db.jobRun.count({ where: { status: "FAILED", startedAt: { gte: new Date(Date.now() - 86400000) } } }) : null;
  const stuckOutbox = database ? await db.outboundMessage.count({ where: { status: "FAILED" } }) : null;
  const body = {
    ok: database,
    database,
    latencyMs: Date.now() - started,
    integrations: { email: emailConfigured(), sms: smsConfigured(), push: pushConfigured(), esewa: esewaConfigured(), khalti: khaltiConfigured(), blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN), turnstile: turnstileEnabled(), sentry: sentryConfigured() },
    // L5: live mode with a gateway endpoint unset or pointing at a sandbox host → that gateway is switched off.
    paymentsConfig: { live: paymentsLive(), ok: !gatewayConfigProblem("ESEWA") && !gatewayConfigProblem("KHALTI"), problems: [gatewayConfigProblem("ESEWA"), gatewayConfigProblem("KHALTI")].filter(Boolean) },
    alerts: { failedJobs24h: failedJobs, failedMessages: stuckOutbox },
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  };
  return NextResponse.json(body, { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
