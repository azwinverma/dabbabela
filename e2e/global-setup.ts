import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * Staff accounts must have TOTP 2FA in production builds. Demo staff have none, so for the
 * duration of the E2E run we switch the `staff2fa` flag off and put the previous value back after.
 * Never point E2E at a live database.
 */
export default async function setup() {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* CI env */
  }
  if (process.env.NODE_ENV === "production" && !process.env.E2E_ALLOW) throw new Error("Refusing to run E2E setup with NODE_ENV=production");
  const db = new PrismaClient();
  const row = await db.setting.findUnique({ where: { key: "site" } });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  const flags = (value.flags ?? {}) as Record<string, unknown>;
  const previous = flags.staff2fa;
  const next = { ...value, flags: { ...flags, staff2fa: false } } as Prisma.InputJsonValue;
  await db.setting.upsert({ where: { key: "site" }, create: { key: "site", value: next }, update: { value: next } });
  await db.$disconnect();
  return async () => {
    const db2 = new PrismaClient();
    const r = await db2.setting.findUnique({ where: { key: "site" } });
    const v = (r?.value ?? {}) as Record<string, unknown>;
    const f = { ...((v.flags ?? {}) as Record<string, unknown>) };
    if (previous === undefined) delete f.staff2fa;
    else f.staff2fa = previous;
    await db2.setting.update({ where: { key: "site" }, data: { value: { ...v, flags: f } as Prisma.InputJsonValue } });
    await db2.$disconnect();
  };
}
