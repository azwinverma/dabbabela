"use server";

import crypto from "node:crypto";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/action";
import { audit } from "@/lib/audit";
import { log } from "@/lib/logger";
import { seedCatalog } from "@/server/seed";
import { auth } from "@/server/auth";

function same(a: string, b: string) {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * One-time owner setup. Protected by SETUP_KEY; refuses as soon as any super admin exists.
 * Loads the catalogue (menu, zones, plans, pages). Demo data is never loaded in production.
 */
export async function setupAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const key = process.env.SETUP_KEY;
  if (!key) return { ok: false, message: "Set a SETUP_KEY environment variable first, then redeploy." };
  if (await db.user.count({ where: { role: "SUPER_ADMIN" } })) return { ok: false, message: "Setup is already complete." };
  if (!same(String(fd.get("key") ?? ""), key)) {
    log.warn("setup.bad_key");
    await new Promise((r) => setTimeout(r, 800));
    return { ok: false, message: "Setup key doesn't match.", errors: { key: "Wrong key" } };
  }
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const name = String(fd.get("name") ?? "").trim().slice(0, 80) || "Owner";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Enter a valid email.", errors: { email: "Invalid" } };
  if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return { ok: false, message: "Use at least 12 characters with letters and numbers.", errors: { password: "Too weak" } };
  const demo = fd.get("demo") === "on" && process.env.NODE_ENV !== "production";
  await seedCatalog(db, { owner: { name, email, password }, demo });
  const owner = await db.user.findUniqueOrThrow({ where: { email } });
  await audit({ actorId: owner.id, action: "system.setup", entity: "User", entityId: owner.id, summary: `Owner created${demo ? " with demo data" : ""}` });
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch {
    return { ok: true, message: "Owner created — please log in.", redirectTo: "/login?next=/admin" };
  }
  return { ok: true, redirectTo: "/admin" };
}
