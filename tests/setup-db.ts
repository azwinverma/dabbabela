import { afterAll } from "vitest";

/**
 * Each test file gets a fresh module graph and so its own Prisma client. Without this, every finished file's pool
 * stayed open until the run ended; with 40+ files that exhausted Postgres max_connections and later files failed
 * with "Can't reach database server". Disconnect the file's client when the file is done.
 */
afterAll(async () => {
  const { db } = await import("@/lib/db");
  await db.$disconnect().catch(() => {});
});
