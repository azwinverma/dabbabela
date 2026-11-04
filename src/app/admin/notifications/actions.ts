"use server";

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { processOutbox, TEMPLATES, type TemplateKey } from "@/server/notify";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";

const CHANNELS = ["EMAIL", "SMS", "IN_APP"];

export async function saveTemplate(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("settings", async (user) => {
    const key = f.str(fd, "key") as TemplateKey;
    const channel = f.str(fd, "channel");
    const locale = f.str(fd, "locale") === "ne" ? "ne" : "en";
    if (!(key in TEMPLATES) || !CHANNELS.includes(channel)) return fail("Unknown template");
    const body = f.str(fd, "body", 4000);
    const subject = f.opt(fd, "subject", 200);
    if (!body) return fail("Write the message (or reset to default)");
    if (channel === "SMS" && body.length > 300) return fail("Keep SMS under 300 characters");
    const row = await db.notificationTemplate.upsert({
      where: { key_channel_locale: { key, channel, locale } },
      create: { key, channel, locale, subject, body, isActive: f.bool(fd, "isActive") },
      update: { subject, body, isActive: f.bool(fd, "isActive") },
    });
    await audit({ actorId: user.id, action: "notify.template", entity: "NotificationTemplate", entityId: row.id, summary: `${key} ${channel} ${locale}`, after: { subject, body } });
    return done("Template saved — used for the next message");
  }, ["/admin/notifications"]);
}

export async function resetTemplate(id: string): Promise<ActionResult> {
  return guarded("settings", async (user) => {
    const t = await db.notificationTemplate.delete({ where: { id } });
    await audit({ actorId: user.id, action: "notify.template_reset", entity: "NotificationTemplate", entityId: id, before: t });
    return done("Back to the default text");
  }, ["/admin/notifications"]);
}

export async function retryMessages(ids: string[]): Promise<ActionResult> {
  return guarded("settings", async (user) => {
    const list = ids.length ? ids : (await db.outboundMessage.findMany({ where: { status: "FAILED" }, select: { id: true }, take: 100 })).map((m) => m.id);
    if (!list.length) return fail("Nothing to retry");
    await db.outboundMessage.updateMany({ where: { id: { in: list }, status: { in: ["FAILED", "SKIPPED"] } }, data: { status: "QUEUED", attempts: 0, sendAfter: new Date() } });
    const r = await processOutbox({ ids: list });
    await audit({ actorId: user.id, action: "notify.retry", entity: "OutboundMessage", summary: `${list.length} message(s)`, after: r });
    return done(`Retried ${list.length}: ${r.sent} sent, ${r.failed} failed, ${r.skipped} skipped (no provider)`);
  }, ["/admin/notifications"]);
}
