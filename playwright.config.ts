import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a running app. Locally: `npm run build && PORT=3100 npm start`, then `npm run test:e2e`.
 * Needs the seeded dev database with demo users (SEED_DEMO=true).
 */
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: BASE, trace: "retain-on-failure", screenshot: "only-on-failure" },
  // Started after globalSetup so the server reads the E2E settings fresh. Build first: `npm run build`.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npx next start -p 3100", url: "http://localhost:3100/api/health", reuseExistingServer: false, timeout: 120_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /public\.spec/ },
  ],
});
