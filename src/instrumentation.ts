/**
 * Next.js instrumentation hook: initialises Sentry on the server and edge runtimes when SENTRY_DSN is set.
 * Without a DSN nothing is imported or initialised (no-op), so dev, tests and the build don't depend on Sentry.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const runtime = process.env.NEXT_RUNTIME === "edge" ? "edge" : "nodejs";
  const [Sentry, { sentryOptions }] = await Promise.all([import("@sentry/nextjs"), import("./lib/sentry-options")]);
  Sentry.init(sentryOptions(dsn, runtime));
}

/** Server errors from route handlers, server components and actions (Next 15 `onRequestError`). */
export async function onRequestError(...args: unknown[]) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  (Sentry.captureRequestError as (...a: unknown[]) => void)(...args);
}
