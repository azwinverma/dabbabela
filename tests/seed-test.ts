import { PrismaClient } from "@prisma/client";
import { seedCatalog } from "../src/server/seed";

const db = new PrismaClient();
seedCatalog(db, { owner: { name: "Test Owner", email: "owner@test.local", password: "test-pass-123" }, demo: true })
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
