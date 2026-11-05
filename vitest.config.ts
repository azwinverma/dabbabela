import { defineConfig } from "vitest/config";
import path from "node:path";

try {
  process.loadEnvFile(".env");
} catch {
  /* CI provides env vars directly */
}
const BASE = process.env.DATABASE_URL_TEST ?? "";
if (!/test/.test(BASE)) throw new Error("Set DATABASE_URL_TEST to a throwaway database whose name contains 'test'");
// Each run gets its own schema (created + migrated in global-setup, dropped in teardown).
const SCHEMA = process.env.TEST_SCHEMA ?? `t${Date.now()}${process.pid}`; // pid avoids clashes between runs started in the same millisecond
process.env.TEST_SCHEMA = SCHEMA;
const u = new URL(BASE);
u.searchParams.set("schema", SCHEMA);
const TEST_DB = u.toString();
process.env.TEST_DB_URL = TEST_DB;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { VITEST: "true", DISABLE_STAFF_2FA: "true", DATABASE_URL: TEST_DB, DATABASE_URL_UNPOOLED: TEST_DB, RESEND_API_KEY: "", SMS_PROVIDER: "" },
  },
});
