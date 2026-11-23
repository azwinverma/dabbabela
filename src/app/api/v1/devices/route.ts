import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { iso, readJson } from "@/server/api/http";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/server/notify";

export const dynamic = "force-dynamic";

const registerSchema = z.object({
  token: z.string().trim().min(10).max(4096),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
  appVersion: z.string().trim().max(40).optional(),
});

const removeSchema = z.object({ token: z.string().trim().min(10).max(4096) });

/** This account's registered push devices (tokens are never echoed back in full). */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => {
  const rows = await db.deviceToken.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: "desc" } });
  return rows.map((d) => ({ id: d.id, platform: d.platform, appVersion: d.appVersion, tokenSuffix: d.token.slice(-6), lastSeenAt: iso(d.lastSeenAt), createdAt: iso(d.createdAt) }));
});

/**
 * Register (or refresh) this device's FCM/APNs token for push. A token registered by another account moves to the
 * caller (one device = one signed-in account, e.g. a shared phone after sign-out without unregistering) — but never
 * silently (security review L7): the move is audited and the previous account is told in-app, since push will carry
 * hand-off codes.
 */
export const POST = apiRoute({ auth: "user", limit: "write" }, async ({ req, user }) => {
  const b = await readJson(req, registerSchema);
  const before = await db.deviceToken.findUnique({ where: { token: b.token }, select: { userId: true } });
  const d = await db.deviceToken.upsert({
    where: { token: b.token },
    create: { token: b.token, platform: b.platform, appVersion: b.appVersion ?? null, userId: user.id },
    update: { userId: user.id, platform: b.platform, appVersion: b.appVersion ?? null, lastSeenAt: new Date() },
  });
  if (before && before.userId !== user.id) {
    const suffix = b.token.slice(-6);
    await audit({ actorId: user.id, action: "device.moved", entity: "DeviceToken", entityId: d.id, summary: `Push token …${suffix} (${b.platform}) moved from another account`, before: { userId: before.userId }, after: { userId: user.id } });
    await notify("device.moved", { userId: before.userId }, { platform: b.platform.toLowerCase(), suffix }, { dedupeKey: `device-moved:${d.id}:${user.id}:${Date.now()}` });
  }
  return { id: d.id, platform: d.platform, registered: true };
});

/** Unregister a push token (on sign-out or when the OS revokes it). Only the caller's own tokens. */
export const DELETE = apiRoute({ auth: "user", limit: "write" }, async ({ req, user }) => {
  const { token } = await readJson(req, removeSchema);
  const r = await db.deviceToken.deleteMany({ where: { token, userId: user.id } });
  return { removed: r.count };
});
