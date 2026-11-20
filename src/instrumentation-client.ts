/**
 * Browser instrumentation (Next 15.3+). Sentry loads only when NEXT_PUBLIC_SENTRY_DSN was set at build time
 * (next.config.ts copies SENTRY_DSN into it); otherwise the SDK isn't even downloaded.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void Promise.all([import("@sentry/nextjs"), import("./lib/sentry-options")]).then(([Sentry, { sentryOptions }]) => {
    Sentry.init(sentryOptions(dsn, "browser"));
  });
}

export {};
