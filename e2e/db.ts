import { PrismaClient } from "@prisma/client";

/** Direct DB access for fixtures and assertions. Same dev database the app under test uses. */
try {
  process.loadEnvFile(".env");
} catch {
  /* CI env */
}

let client: PrismaClient | null = null;
export function db() {
  client ??= new PrismaClient();
  return client;
}

/** Today's date in Asia/Kathmandu as YYYY-MM-DD. */
export function todayKtm() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(new Date());
}

export const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
