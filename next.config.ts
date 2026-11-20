import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Lets several dev servers run side by side (each with its own NEXT_DIST_DIR).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com" },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
  },
  // Browser Sentry (src/instrumentation-client.ts) reads these at build time; one SENTRY_DSN configures both sides.
  env: {
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN || "",
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA || "",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Content-Security-Policy is set per request with a fresh nonce in src/middleware.ts (src/lib/csp.ts).
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

/**
 * Sentry's build wrapper only when a DSN is configured. Source maps are uploaded only when SENTRY_AUTH_TOKEN (and
 * SENTRY_ORG / SENTRY_PROJECT) are set; without them the build never talks to Sentry.
 */
const sentryOn = Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
const uploadMaps = Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);

export default sentryOn
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      telemetry: false,
      sourcemaps: { disable: !uploadMaps, deleteSourcemapsAfterUpload: true },
      release: { name: process.env.VERCEL_GIT_COMMIT_SHA, create: uploadMaps, finalize: uploadMaps },
    })
  : nextConfig;
