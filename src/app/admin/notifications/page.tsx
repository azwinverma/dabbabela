import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { TEMPLATES } from "@/server/notify";
import { emailConfigured } from "@/server/notify/email";
import { smsConfigured } from "@/server/notify/sms";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, Callout, Tabs } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Checkbox } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { resetTemplate, retryMessages, saveTemplate } from "./actions";

type Def = { inApp: { title: string; body: string } | null; email: { subject: string; body: string } | null; sms: string | null };
const TONE = { QUEUED: "warn", SENT: "good", FAILED: "bad", SKIPPED: "neutral" } as const;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  await requirePermission("settings");
  const sp = await searchParams;
  const tab = sp.tab === "outbox" ? "outbox" : "templates";
  const [overrides, outbox, counts] = await Promise.all([
    db.notificationTemplate.findMany(),
    tab === "outbox" ? db.outboundMessage.findMany({ where: sp.status ? { status: sp.status } : {}, orderBy: { createdAt: "desc" }, take: 100 }) : Promise.resolve([]),
    db.outboundMessage.groupBy({ by: ["status"], _count: true }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <PageHeader title="Notifications" description="Messages customers get by email, SMS and in the app. Variables in {{double braces}} are filled in automatically and escaped." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={emailConfigured() ? "good" : "warn"}>Email {emailConfigured() ? "connected (Resend)" : "not configured — emails are skipped"}</Badge>
        <Badge tone={smsConfigured() ? "good" : "warn"}>SMS {smsConfigured() ? "connected" : "not configured — SMS skipped"}</Badge>
        <Badge>WhatsApp: click-to-chat links only</Badge>
      </div>
      <Tabs
        current={tab}
        tabs={[
          { key: "templates", label: "Templates", href: "/admin/notifications" },
          { key: "outbox", label: "Outbox", href: "/admin/notifications?tab=outbox", count: count("FAILED") || undefined },
        ]}
      />
      {tab === "templates" ? (
        <div className="space-y-4">
          {(Object.entries(TEMPLATES) as [string, Def][]).map(([key, def]) => (
            <Panel key={key} title={<span className="font-mono text-sm">{key}</span>}>
              <div className="grid gap-4 lg:grid-cols-3">
                {(
                  [
                    ["IN_APP", def.inApp ? { subject: def.inApp.title, body: def.inApp.body } : null],
                    ["EMAIL", def.email],
                    ["SMS", def.sms ? { subject: null, body: def.sms } : null],
                  ] as const
                ).map(([channel, d]) =>
                  d ? (
                    <div key={channel} className="rounded-lg border border-ink-line/60 p-3">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-mute">{channel.replace("_", "-").toLowerCase()}</p>
                      {(["en", "ne"] as const).map((locale) => {
                        const o = overrides.find((x) => x.key === key && x.channel === channel && x.locale === locale);
                        return (
                          <details key={locale} className="mb-2" open={Boolean(o)}>
                            <summary className="cursor-pointer text-xs font-semibold">
                              {locale === "en" ? "English" : "नेपाली"} {o ? <Badge tone="info">custom</Badge> : <span className="text-ink-mute">(default)</span>}
                            </summary>
                            <ActionForm action={saveTemplate} className="mt-2 space-y-2">
                              <input type="hidden" name="key" value={key} />
                              <input type="hidden" name="channel" value={channel} />
                              <input type="hidden" name="locale" value={locale} />
                              {channel !== "SMS" && <input name="subject" defaultValue={o?.subject ?? d.subject ?? ""} className="field py-1 text-xs" aria-label="Subject / title" />}
                              <textarea name="body" rows={channel === "EMAIL" ? 4 : 3} defaultValue={o?.body ?? (locale === "en" ? d.body : "")} placeholder={d.body} className={`field text-xs ${locale === "ne" ? "lang-ne" : ""}`} aria-label="Message" />
                              <div className="flex items-center justify-between">
                                <Checkbox name="isActive" label="Use" defaultChecked={o?.isActive ?? true} />
                                <span className="flex gap-1">
                                  {o && <ConfirmAction action={resetTemplate.bind(null, o.id)} label="Reset" variant="ghost" />}
                                  <SubmitButton size="sm" variant="outline">Save</SubmitButton>
                                </span>
                              </div>
                            </ActionForm>
                          </details>
                        );
                      })}
                    </div>
                  ) : null,
                )}
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <>
          {count("FAILED") > 0 && (
            <Callout tone="bad" className="mb-4" title={`${count("FAILED")} message(s) failed after 5 attempts`}>
              <div className="mt-2">
                <ConfirmAction action={retryMessages.bind(null, [])} label="Retry all failed" variant="outline" />
              </div>
            </Callout>
          )}
          <div className="mb-3 flex gap-3 text-sm">
            {["", "QUEUED", "SENT", "FAILED", "SKIPPED"].map((s) => (
              <a key={s} href={`/admin/notifications?tab=outbox${s ? `&status=${s}` : ""}`} className={(sp.status ?? "") === s ? "font-semibold underline" : "text-ink-mute hover:text-ink"}>
                {s ? `${s.toLowerCase()} (${count(s)})` : "all"}
              </a>
            ))}
          </div>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Channel</Th>
                <Th>To</Th>
                <Th>Template</Th>
                <Th>Status</Th>
                <Th>Error</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {outbox.length === 0 && <EmptyRow colSpan={7}>Nothing in the outbox.</EmptyRow>}
              {outbox.map((m) => (
                <tr key={m.id}>
                  <Td className="text-xs">{formatStamp(m.createdAt)}</Td>
                  <Td className="text-xs">{m.channel}</Td>
                  <Td className="text-xs">{m.to.replace(/(.{3}).+(@.+|.{3})$/, "$1•••$2")}</Td>
                  <Td className="font-mono text-xs">{m.templateKey}</Td>
                  <Td>
                    <Badge tone={TONE[m.status as keyof typeof TONE] ?? "neutral"}>{m.status.toLowerCase()}</Badge> <span className="text-xs text-ink-mute">×{m.attempts}</span>
                  </Td>
                  <Td className="max-w-xs truncate text-xs text-ink-mute" title={m.lastError ?? ""}>
                    {m.lastError}
                  </Td>
                  <Td className="text-right">{(m.status === "FAILED" || m.status === "SKIPPED") && <ConfirmAction action={retryMessages.bind(null, [m.id])} label="Retry" variant="ghost" />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </>
  );
}
