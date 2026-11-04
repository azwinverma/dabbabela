import { PrismaClient } from "@prisma/client";
import { seedCatalog } from "../src/server/seed";

const db = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const demo = process.env.SEED_DEMO === "true";
  if (process.env.NODE_ENV === "production" && demo) throw new Error("SEED_DEMO must not be used in production");
  await seedCatalog(db, {
    owner: email && password ? { name: process.env.SEED_ADMIN_NAME || "Owner", email, password } : undefined,
    demo,
    log: (s) => console.log(`✓ ${s}`),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
