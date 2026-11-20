import { PrismaClient } from "@prisma/client";
import { ensureFoundationData } from "../src/server/foundation";

/**
 * `npm run db:foundation` — idempotent foundation backfill (runs in vercel-build after migrate deploy).
 * Also creates the built-in CMS pages (our-story, how-it-works, nutrition, delivery policy, privacy cookie
 * section) once per database, so they exist without a staff visit to /admin/pages.
 */
process.env.SCRIPT_CONTEXT ??= "1"; // CMS/settings helpers read the DB directly instead of Next's request cache
const db = new PrismaClient();

async function main() {
  const r = await ensureFoundationData(db);
  console.log(`✓ foundation data: ${JSON.stringify(r)}`);
  const { ensureCmsContent } = await import("../src/lib/cms/builtin");
  const c = await ensureCmsContent(db);
  console.log(`✓ built-in CMS content: ${JSON.stringify(c)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
