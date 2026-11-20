import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { notificationPrefs, saveNotificationPrefs, type PrefKey } from "@/server/profile";
import { PREF_CHANNELS, PREF_TOPICS } from "@/lib/actions/account-constants";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Topic × channel switches (ORDER_UPDATES / PLAN_REMINDERS / MARKETING × IN_APP / EMAIL / SMS). */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => ({ topics: PREF_TOPICS, channels: PREF_CHANNELS, preferences: await notificationPrefs(user.id, user.marketingOptIn) }));

const schema = z.object({
  preferences: z.array(z.object({ topic: z.enum(PREF_TOPICS), channel: z.enum(PREF_CHANNELS), enabled: z.boolean() })).max(PREF_TOPICS.length * PREF_CHANNELS.length),
});

/** Replace all switches (any topic × channel not listed = off, like the web form). Marketing opt-in follows MARKETING email/SMS. */
export const PUT = apiRoute({ auth: "user", limit: "write" }, async ({ req, user }) => {
  const { preferences } = await readJson(req, schema);
  const on = new Set(preferences.filter((p) => p.enabled).map((p) => `${p.topic}:${p.channel}`));
  await saveNotificationPrefs(user.id, (key: PrefKey) => on.has(key));
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { marketingOptIn: true } });
  return { message: "Notification settings saved", preferences: await notificationPrefs(user.id, u.marketingOptIn) };
});
