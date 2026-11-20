import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub";

/**
 * Shared Sentry init options (server, edge, browser). Sentry is env-gated: nothing initialises without a DSN
 * (`SENTRY_DSN` on the server; the browser gets the same value through NEXT_PUBLIC_SENTRY_DSN, inlined by
 * next.config.ts). No PII: `sendDefaultPii` off, every event and breadcrumb passes through the scrubber.
 */
export function sentryOptions(dsn: string, runtime: "nodejs" | "edge" | "browser") {
  const release = runtime === "browser" ? process.env.NEXT_PUBLIC_SENTRY_RELEASE : process.env.VERCEL_GIT_COMMIT_SHA;
  const rate = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0);
  return {
    dsn,
    release: release || undefined,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 1) : 0,
    initialScope: { tags: { runtime } },
    // The scrubber is typed structurally (no SDK types) so it works for every runtime's event shape.
    beforeSend: scrubEvent as <E>(event: E, hint?: unknown) => E | null,
    beforeSendTransaction: scrubEvent as <E>(event: E, hint?: unknown) => E | null,
    beforeBreadcrumb: scrubBreadcrumb as <B>(b: B) => B | null,
  };
}

export function serverDsn() {
  return process.env.SENTRY_DSN || "";
}

export function sentryConfigured() {
  return Boolean(process.env.SENTRY_DSN);
}
