import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import { deliverEmail, emailShell, escapeHtml } from "./email";
import { deliverSms } from "./sms";

/**
 * Notification templates. Code defaults below; staff can override any of them per channel/locale
 * in Admin → Notifications (NotificationTemplate rows). Variables use {{name}} and are HTML-escaped.
 */
export const TEMPLATES = {
  "order.placed": {
    topic: "ORDER_UPDATES",
    inApp: { title: "Order {{number}} received", body: "{{summary}}" },
    email: { subject: "We've got your order {{number}}", body: "<p>Namaste {{name}},</p><p>{{summary}}</p><p>Track it any time: <a href=\"{{link}}\">{{link}}</a></p>" },
    sms: "{{brand}}: order {{number}} received. {{summary}}",
  },
  "payment.received": {
    topic: "ORDER_UPDATES",
    inApp: { title: "Payment received", body: "{{amount}} for {{reference}}. Thank you!" },
    email: { subject: "Payment received — {{reference}}", body: "<p>We received {{amount}} for {{reference}}.</p>" },
    sms: null,
  },
  "order.out_for_delivery": {
    topic: "ORDER_UPDATES",
    inApp: { title: "Your dabba is on the way", body: "Order {{number}} left the kitchen. Hand-off code: {{otp}}" },
    email: null,
    sms: "{{brand}}: your lunch {{number}} is on the way. Share code {{otp}} with the rider.",
  },
  "order.delivered": {
    topic: "ORDER_UPDATES",
    inApp: { title: "Delivered — enjoy!", body: "Tell us how {{number}} tasted." },
    email: null,
    sms: null,
  },
  "order.failed_delivery": {
    topic: "ORDER_UPDATES",
    inApp: { title: "We couldn't deliver {{number}}", body: "{{reason}} — our team will call you." },
    email: { subject: "Delivery problem with {{number}}", body: "<p>{{reason}}</p><p>Our team will contact you about a credit or redelivery.</p>" },
    sms: "{{brand}}: we couldn't deliver {{number}} ({{reason}}). We'll call you shortly.",
  },
  "order.cancelled": {
    topic: "ORDER_UPDATES",
    inApp: { title: "Order {{number}} cancelled", body: "{{reason}}" },
    email: { subject: "Order {{number}} cancelled", body: "<p>{{reason}}</p>" },
    sms: null,
  },
  "service.disruption": {
    topic: "ORDER_UPDATES",
    inApp: { title: "No delivery on {{date}}", body: "{{reason}}. {{outcome}}" },
    email: { subject: "No lunch delivery on {{date}}", body: "<p>{{reason}}.</p><p>{{outcome}}</p>" },
    sms: "{{brand}}: no delivery on {{date}} ({{reason}}). {{outcome}}",
  },
  "plan.reminder": {
    topic: "PLAN_REMINDERS",
    inApp: { title: "Your plan ends on {{date}}", body: "Renew to keep lunches coming." },
    email: { subject: "Your {{plan}} ends on {{date}}", body: "<p>Renew any time from your account: <a href=\"{{link}}\">{{link}}</a></p>" },
    sms: null,
  },
  "refund.processed": {
    topic: "ORDER_UPDATES",
    inApp: { title: "Refund processed", body: "{{amount}} — {{method}}" },
    email: { subject: "Refund processed — {{amount}}", body: "<p>{{amount}} has been refunded ({{method}}).</p>" },
    sms: null,
  },
  "ticket.reply": {
    topic: "ORDER_UPDATES",
    inApp: { title: "Support replied: {{subject}}", body: "{{preview}}" },
    email: { subject: "Re: {{subject}}", body: "<p>{{preview}}</p><p><a href=\"{{link}}\">Open the conversation</a></p>" },
    sms: null,
  },
  "auth.reset_password": {
    topic: "SECURITY",
    inApp: null,
    email: { subject: "Reset your password", body: "<p>Use this link within an hour to set a new password:</p><p><a href=\"{{link}}\">{{link}}</a></p><p>If you didn't ask for this, ignore this email.</p>" },
    sms: null,
  },
  "auth.otp": {
    topic: "SECURITY",
    inApp: null,
    email: null,
    sms: "{{code}} is your {{brand}} sign-in code. It expires in 5 minutes. Never share it.",
  },
  "company.invite": {
    topic: "SECURITY",
    inApp: null,
    email: { subject: "{{company}} invited you to team lunches", body: "<p>{{inviter}} added you to {{company}} on {{brand}}.</p><p><a href=\"{{link}}\">Accept the invite</a> (valid 14 days).</p>" },
    sms: null,
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;
type Vars = Record<string, string | number | null | undefined>;

function fill(tpl: string, vars: Vars, html: boolean) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    const s = v === null || v === undefined ? "" : String(v);
    return html ? escapeHtml(s) : s;
  });
}

async function override(key: string, channel: string, locale: string) {
  try {
    return await db.notificationTemplate.findFirst({
      where: { key, channel, isActive: true, locale: { in: [locale, "en"] } },
      orderBy: { locale: locale === "en" ? "asc" : "desc" },
    });
  } catch {
    return null;
  }
}

async function prefEnabled(userId: string, topic: string, channel: string) {
  if (topic === "SECURITY") return true;
  const p = await db.notificationPreference.findUnique({ where: { userId_topic_channel: { userId, topic, channel } } });
  if (p) return p.enabled;
  return channel !== "SMS" || topic === "ORDER_UPDATES"; // SMS on only for order updates by default
}

/**
 * Notify a user: in-app row immediately, email/SMS queued in the durable outbox (sent by the cron
 * worker with retries, or immediately when `sendNow`). Never throws.
 */
export async function notify(
  key: TemplateKey,
  target: { userId?: string | null; email?: string | null; phone?: string | null; locale?: string },
  vars: Vars,
  opts: { link?: string; sendNow?: boolean; dedupeKey?: string } = {},
) {
  try {
    const s = await getSettings();
    const t = TEMPLATES[key];
    const allVars: Vars = { brand: s.brandName, link: opts.link ?? "", ...vars };
    const locale = target.locale ?? "en";
    let email = target.email ?? null;
    let phone = target.phone ?? null;
    if (target.userId && (!email || !phone)) {
      const u = await db.user.findUnique({ where: { id: target.userId }, select: { email: true, phoneNumber: true, deletedAt: true } });
      if (u?.deletedAt) return;
      email = email ?? u?.email ?? null;
      phone = phone ?? u?.phoneNumber ?? null;
    }

    if (t.inApp && target.userId) {
      const o = await override(key, "IN_APP", locale);
      await db.notification.create({
        data: {
          userId: target.userId,
          type: key,
          title: fill(o?.subject ?? t.inApp.title, allVars, false),
          body: fill(o?.body ?? t.inApp.body, allVars, false),
          link: opts.link,
        },
      });
    }

    const queued: string[] = [];
    if (t.email && email && !email.endsWith("@phone.dabbabela.local") && (!target.userId || (await prefEnabled(target.userId, t.topic, "EMAIL")))) {
      const o = await override(key, "EMAIL", locale);
      const subject = fill(o?.subject ?? t.email.subject, allVars, false);
      const html = emailShell(s.brandName, subject, fill(o?.body ?? t.email.body, allVars, true));
      const row = await db.outboundMessage.create({
        data: { channel: "EMAIL", to: email, templateKey: key, subject, body: html, dedupeKey: opts.dedupeKey ? `${opts.dedupeKey}:email` : undefined },
      });
      queued.push(row.id);
    }
    if (t.sms && phone && (!target.userId || (await prefEnabled(target.userId, t.topic, "SMS")))) {
      const o = await override(key, "SMS", locale);
      const row = await db.outboundMessage.create({
        data: { channel: "SMS", to: phone, templateKey: key, body: fill(o?.body ?? t.sms, allVars, false), dedupeKey: opts.dedupeKey ? `${opts.dedupeKey}:sms` : undefined },
      });
      queued.push(row.id);
    }
    if (!queued.length) return;
    if (opts.sendNow) await processOutbox({ ids: queued });
    else {
      // Send right after the response; the cron worker retries anything that fails.
      try {
        const { after } = await import("next/server");
        after(() => processOutbox({ ids: queued }).catch(() => {}));
      } catch {
        await processOutbox({ ids: queued }).catch(() => {});
      }
    }
  } catch (e) {
    // Unique dedupeKey collisions mean "already queued" — fine.
    if (!(e instanceof Error && e.message.includes("Unique constraint"))) log.error("notify.failed", { key, error: e });
  }
}

const MAX_ATTEMPTS = 5;

/** Send queued messages. Safe to run concurrently: each row is claimed with a conditional update. */
export async function processOutbox(opts: { ids?: string[]; limit?: number } = {}) {
  const rows = await db.outboundMessage.findMany({
    where: { status: "QUEUED", sendAfter: { lte: new Date() }, ...(opts.ids ? { id: { in: opts.ids } } : {}) },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 50,
  });
  let sent = 0,
    failed = 0,
    skipped = 0;
  for (const m of rows) {
    // claim: bump attempts only if still queued with the same attempt count
    const claim = await db.outboundMessage.updateMany({
      where: { id: m.id, status: "QUEUED", attempts: m.attempts },
      data: { attempts: { increment: 1 } },
    });
    if (!claim.count) continue;
    const res = m.channel === "EMAIL" ? await deliverEmail(m.to, m.subject ?? "", m.body) : await deliverSms(m.to, m.body);
    if (res.ok) {
      sent++;
      await db.outboundMessage.update({ where: { id: m.id }, data: { status: "SENT", sentAt: new Date(), lastError: null } });
    } else if (res.skipped) {
      skipped++;
      await db.outboundMessage.update({ where: { id: m.id }, data: { status: "SKIPPED", lastError: "No provider configured" } });
    } else {
      failed++;
      const attempts = m.attempts + 1;
      await db.outboundMessage.update({
        where: { id: m.id },
        data: {
          status: attempts >= MAX_ATTEMPTS ? "FAILED" : "QUEUED",
          lastError: res.error?.slice(0, 500),
          sendAfter: new Date(Date.now() + 2 ** attempts * 60_000), // 2, 4, 8, 16 min backoff
        },
      });
    }
  }
  return { sent, failed, skipped };
}
