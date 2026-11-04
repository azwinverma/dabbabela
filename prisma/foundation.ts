import { PrismaClient } from "@prisma/client";
import { ensureFoundationData } from "../src/server/foundation";

/** `npm run db:foundation` — idempotent foundation backfill (runs in vercel-build after migrate deploy). */
const db = new PrismaClient();
ensureFoundationData(db)
  .then((r) => console.log(`✓ foundation data: ${JSON.stringify(r)}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
