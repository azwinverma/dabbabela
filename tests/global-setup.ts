import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * Integration tests run in a brand-new Postgres schema inside DATABASE_URL_TEST.
 * We create it with `migrate deploy` (non-destructive) and drop only that schema afterwards.
 */
export default async function setup() {
  const url = process.env.TEST_DB_URL!;
  const schema = process.env.TEST_SCHEMA!;
  if (!/^t\d+$/.test(schema)) throw new Error("Unexpected test schema name");
  const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx tests/seed-test.ts", { env, stdio: "inherit" });
  return async () => {
    if (process.env.KEEP_TEST_SCHEMA) return;
    const db = new PrismaClient({ datasources: { db: { url } } });
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  };
}
