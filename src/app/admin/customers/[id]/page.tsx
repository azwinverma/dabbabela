import Link from "next/link";
import { ledgerReasonLabel } from "@/lib/ledger-labels";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatDay, formatStamp, isoDate } from "@/lib/dates";
import { ADDRESS_TYPE_LABEL, METHOD_LABEL, REFUND_STATUS } from "@/lib/labels";
import { PREF_CHANNELS, PREF_TOPICS } from "@/lib/actions/account-constants";
import { PageHeader, Panel, KV, Table, Th, Td, EmptyRow, OrderBadge, PaymentBadge, SubBadge, Callout } from "@/components/admin/ui";
import { Timeline } from "@/components/admin/Timeline";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { customerProfile } from "@/server/crm";
import { ActiveForm, CommPrefsForm, CreditDecision, CreditForm, NoteForm, PrivacyRequestForm, ProcessPrivacyButton, ProfileEditForm, TimelineNoteForm } from "../CustomerForms";

const ACTION_TITLE: Record<string, string> = {
  "customer.note_added": "Support note",
  "customer.note": "Pinned note changed",
  "customer.update": "Profile updated",
  "customer.suspend": "Suspended",
  "customer.deactivate": "Suspended",
  "customer.reactivate": "Reactivated",
  "customer.comm_prefs": "Communication preferences changed",
  "customer.export": "Data exported",
  "credit.issue": "Credit issued",
  "credit.adjust": "Credit adjusted",
  "credit.request": "Credit requested",
  "credit.approve": "Credit request approved",
  "credit.reject": "Credit request rejected",
  "privacy.request": "Privacy request logged",
  "privacy.delete": "Personal data deleted",
};

function touchText(t: { source?: string; medium?: string; campaign?: string; referrer?: string; landing?: string; at?: string } | null | undefined) {
  if (!t?.source) return null;
  return [t.source, t.medium, t.campaign && `“${t.campaign}”`].filter(Boolean).join(" · ") + (t.landing ? ` → ${t.landing}` : "") + (t.at ? ` (${formatStamp(t.at)})` : "");
}

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("customers.view");
  const { id } = await params;
  const c = await customerProfile(staff, id);
  if (!c) notFound();
  const pii = c.pii;
  const canEdit = can(staff, "customers.edit") && !c.deletedAt;
  const allergens = canEdit ? await db.allergen.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }) : [];
  const live = !c.deletedAt;

  return (
    <div>
      <PageHeader
        title={c.name}
        back={{ href: "/admin/customers", label: "Customers" }}
        description={c.deletedAt ? "Personal data deleted on request — financial records kept." : `Joined ${formatStamp(c.createdAt)} · last sign-in ${c.lastLoginAt ? formatStamp(c.lastLoginAt) : "never"} · ${c.activeSessions} active session(s)`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!c.isActive && <Badge tone="bad">{c.deletedAt ? "Deleted" : "Suspended"}</Badge>}
            {can(staff, "customers.export") && (
              <a href={`/admin/customers/${c.id}/export`} className={buttonClass("outline", "sm")} download>
                Download data{pii ? "" : " (masked)"}
              </a>
            )}
          </div>
        }
      />
      {c.internalNote && (
        <Callout tone="warn" title="Pinned staff note" className="mb-4">
          <p className="whitespace-pre-wrap">{c.internalNote}</p>
        </Callout>
      )}
      {c.allergies.length > 0 && (
        <Callout tone="bad" title="Allergies (as the customer told us)" className="mb-4">
          {c.allergies.join(", ")}
          {c.avoidOnionGarlic ? " · no onion/garlic" : ""}
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Identity & preferences">
          <KV
            items={[
              ["Email", <span key="e">{c.email} {c.emailVerified ? <Badge tone="good">verified</Badge> : <Badge>unverified</Badge>}</span>],
              ["Phone", <span key="p">{c.phone || "—"} {c.phone ? c.phoneVerified ? <Badge tone="good">verified</Badge> : <Badge>unverified</Badge> : null}</span>],
              ["Two-step sign-in", c.twoFactorEnabled ? "On" : "Off"],
              ["Status", c.isActive ? "Active" : c.deletedAt ? "Deleted" : "Suspended"],
              ["Language", c.locale === "ne" ? "Nepali" : "English"],
              ["Diet", c.diet === "ANY" ? "No restriction" : c.diet === "EGG_OK" ? "Vegetarian + egg" : c.diet.toLowerCase()],
              ["Spice", ["None", "Mild", "Medium", "Hot", "Very hot"][c.spiceTolerance] ?? c.spiceTolerance],
              ["Allergies", c.allergies.length ? <span key="a" className="font-semibold text-sindoor">{c.allergies.join(", ")}</span> : "None declared"],
              ["No onion/garlic", c.avoidOnionGarlic ? "Yes" : "No"],
              ["Dietary notes", c.dietaryNotes],
              ["Marketing", c.marketingOptIn ? "Opted in" : "Not opted in"],
              ["Company", c.company ? <Link key="co" className="text-sindoor underline" href={`/admin/companies/${c.company.id}`}>{`${c.company.name} · ${c.company.role.toLowerCase()} · ${c.company.status.toLowerCase()}${c.company.department ? ` · ${c.company.department}` : ""}`}</Link> : "—"],
              ["Came from (first touch)", touchText(c.attribution) ?? (c.acquisitionSource ?? <span key="nc" className="text-ink-mute">not captured</span>)],
              ["Last touch before sign-up", touchText(c.attribution?.last) ?? "—"],
            ]}
          />
        </Panel>

        <Panel title="Money">
          <KV
            items={[
              ["Orders", c.orderCount],
              ["Paid by them (live orders)", rs(c.spent)],
              ["Credit balance", <span key="b" className="font-bold">{rs(c.balance)}</span>],
              ["Wallet top-ups (net)", c.topupsNet ? <Link key="t" className="text-sindoor underline" href={`/admin/payments?purpose=WALLET_TOPUP&q=${encodeURIComponent(c.name)}`}>{rs(c.topupsNet)}</Link> : "—"],
            ]}
          />
          {live && can(staff, "refunds.create") && (
            <div className="mt-3 border-t border-ink-line/60 pt-3">
              <p className="mb-1 text-xs font-semibold text-ink-mute">{can(staff, "refunds.approve") ? "Goodwill credit (you are recorded as approver)" : "Request goodwill credit (needs an approver)"}</p>
              <CreditForm id={c.id} canApprove={can(staff, "refunds.approve")} />
            </div>
          )}
          {c.pendingCredits.length > 0 && (
            <div className="mt-3 border-t border-ink-line/60 pt-3">
              <p className="mb-1 text-xs font-semibold text-ink-mute">Waiting for approval</p>
              <ul className="space-y-2 text-xs">
                {c.pendingCredits.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">{rs(p.amount)}</span> · {p.note} · by {p.requestedBy}, {formatStamp(p.at)}
                    </span>
                    {can(staff, "refunds.approve") && p.requestedById !== staff.id && <CreditDecision id={c.id} requestId={p.id} />}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mb-1 mt-3 text-xs font-semibold text-ink-mute">Credit ledger</p>
          <ul className="space-y-1 text-xs">
            {c.credits.map((l) => (
              <li key={l.id} className="flex justify-between gap-2">
                <span className="text-ink-mute">
                  {formatStamp(l.createdAt)} · {ledgerReasonLabel(l.reason)}
                  {l.note ? ` · ${l.note}` : ""}
                  {l.paymentId && can(staff, "payments.view") && (
                    <>
                      {" · "}
                      <Link href={`/admin/payments/${l.paymentId}`} className="text-sindoor underline">
                        payment
                      </Link>
                    </>
                  )}
                </span>
                <span className={`tabular-nums ${l.amount < 0 ? "text-sindoor" : "text-saag"}`}>{rs(l.amount)}</span>
              </li>
            ))}
            {!c.credits.length && <li className="text-ink-mute">No credit movements.</li>}
          </ul>
          {c.refunds.length > 0 && (
            <>
              <p className="mb-1 mt-3 text-xs font-semibold text-ink-mute">Refunds</p>
              <ul className="space-y-1 text-xs">
                {c.refunds.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <span className="text-ink-mute">
                      {formatStamp(r.createdAt)} · {r.reason}
                    </span>
                    <span className="flex items-center gap-1">
                      {rs(r.amount)} <Badge tone={REFUND_STATUS[r.status].tone}>{REFUND_STATUS[r.status].label}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel title="Staff actions">
          <div className="space-y-4">
            {can(staff, "customers.edit") && <NoteForm id={c.id} note={c.internalNote ?? ""} />}
            {live && can(staff, "customers.edit") && pii && (
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-mute">{c.isActive ? "Suspend: signs them out everywhere and blocks sign-in and ordering" : "Reactivate: they can sign in and order again"}</p>
                <ActiveForm id={c.id} active={c.isActive} />
              </div>
            )}
            {can(staff, "privacy.edit") && live && (
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-mute">Privacy request received by phone/email?</p>
                <PrivacyRequestForm id={c.id} />
              </div>
            )}
            {c.dataRequests.length > 0 && (
              <ul className="space-y-2 text-xs">
                {c.dataRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-ink-mute">
                      {r.type} · {r.status.toLowerCase()} · {formatStamp(r.createdAt)}
                    </span>
                    {r.status === "OPEN" && can(staff, "privacy.edit") && <ProcessPrivacyButton id={c.id} requestId={r.id} type={r.type} />}
                  </li>
                ))}
                <li>
                  <Link href="/admin/privacy" className="text-akash hover:underline">
                    All privacy requests
                  </Link>
                </li>
              </ul>
            )}
          </div>
        </Panel>

        {canEdit && (
          <Panel title="Edit details" className="lg:col-span-2">
            <ProfileEditForm
              id={c.id}
              canEditPhone={pii}
              allergens={allergens}
              value={{ name: c.name, phone: pii ? c.phone : "", locale: c.locale, diet: c.diet, spiceTolerance: c.spiceTolerance, allergies: c.allergies, avoidOnionGarlic: c.avoidOnionGarlic, dietaryNotes: c.dietaryNotes ?? "" }}
            />
            <p className="mt-2 text-xs text-ink-mute">Email is the sign-in identity and can only be changed by the customer. Every change is audited.</p>
          </Panel>
        )}
        {canEdit && (
          <Panel title="Communication preferences">
            <CommPrefsForm id={c.id} prefs={c.prefs} topics={PREF_TOPICS} channels={PREF_CHANNELS} />
            <p className="mt-2 text-xs text-ink-mute">Security messages (sign-in codes, password resets) are always sent.</p>
          </Panel>
        )}

        <Panel title="Addresses" className="lg:col-span-3" bodyClass="p-0">
          <Table className="rounded-none border-0 shadow-none">
            <thead>
              <tr>
                <Th>Label</Th>
                <Th>Type</Th>
                <Th>Address</Th>
                <Th>Zone</Th>
                <Th>Recipient</Th>
              </tr>
            </thead>
            <tbody>
              {c.addresses.map((a) => (
                <tr key={a.id} className={a.archived ? "opacity-50" : ""}>
                  <Td>
                    {a.label} {a.isDefault && <Badge tone="info">default</Badge>}
                  </Td>
                  <Td>{ADDRESS_TYPE_LABEL[a.type]}</Td>
                  <Td className="text-xs">
                    {a.address}
                    {a.instructions && <span className="block text-ink-mute">{a.instructions}</span>}
                  </Td>
                  <Td>{a.zone ?? <Badge tone="bad">not served</Badge>}</Td>
                  <Td className="text-xs">{a.recipient}</Td>
                </tr>
              ))}
              {!c.addresses.length && <EmptyRow colSpan={5} />}
            </tbody>
          </Table>
        </Panel>

        <Panel title="Recent orders" className="lg:col-span-2" bodyClass="p-0">
          <Table className="rounded-none border-0 shadow-none">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Date</Th>
                <Th>Items</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {c.orders.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link className="font-semibold text-sindoor hover:underline" href={`/admin/orders/${o.id}`}>
                      {o.number}
                    </Link>
                    {o.source !== "SINGLE" && <span className="block text-[11px] text-ink-mute">{o.source.toLowerCase()}</span>}
                  </Td>
                  <Td className="text-xs">{formatDay(isoDate(o.deliveryDate))}</Td>
                  <Td className="text-xs">{o.items.map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ")}</Td>
                  <Td>
                    <OrderBadge status={o.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{rs(o.total)}</Td>
                </tr>
              ))}
              {!c.orders.length && <EmptyRow colSpan={5} />}
            </tbody>
          </Table>
        </Panel>
        <div className="space-y-4">
          <Panel title="Meal plans">
            {c.subscriptions.length ? (
              <ul className="space-y-2 text-sm">
                {c.subscriptions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <Link className="hover:underline" href={`/admin/subscriptions/${s.id}`}>
                      {s.plan.name} <span className="text-xs text-ink-mute">· {s.reference}</span>
                    </Link>
                    <SubBadge status={s.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-mute">None.</p>
            )}
          </Panel>
          <Panel title="Payments">
            {c.payments.length ? (
              <ul className="space-y-2 text-sm">
                {c.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <Link className="font-mono text-xs hover:underline" href={`/admin/payments/${p.id}`}>
                      {p.reference}
                    </Link>
                    <span className="text-xs">
                      {METHOD_LABEL[p.method]} · {rs(p.amount)}
                    </span>
                    <PaymentBadge status={p.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-mute">None.</p>
            )}
          </Panel>
          <Panel title="Support tickets">
            {c.tickets.length ? (
              <ul className="space-y-1 text-sm">
                {c.tickets.map((t) => (
                  <li key={t.id}>
                    <Link className="hover:underline" href={`/admin/support/${t.id}`}>
                      {t.number} · {t.subject}
                    </Link>{" "}
                    <span className="text-xs text-ink-mute">{t.status.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-mute">None.</p>
            )}
          </Panel>
          <Panel title="Feedback">
            {c.feedback.length ? (
              <ul className="space-y-2 text-sm">
                {c.feedback.map((f) => (
                  <li key={f.id}>
                    <span className="font-semibold">{"★".repeat(f.rating)}</span>{" "}
                    <Link className="text-xs text-ink-mute hover:underline" href={`/admin/orders/${f.order.id}`}>
                      {f.order.number}
                    </Link>
                    {f.comment && <p className="text-xs text-ink-soft">{f.comment}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-mute">None.</p>
            )}
          </Panel>
        </div>

        <Panel title="Notes & staff activity" className="lg:col-span-2">
          {can(staff, "customers.edit") && (
            <div className="mb-4">
              <TimelineNoteForm id={c.id} />
            </div>
          )}
          <Timeline
            items={c.timeline.map((t) => ({
              id: t.id,
              at: t.at,
              title: ACTION_TITLE[t.action] ?? t.action,
              actor: t.actor,
              tone: t.action === "customer.note_added" ? "info" : t.action.includes("suspend") || t.action.includes("delete") ? "bad" : t.approved ? "good" : "neutral",
              body: (
                <>
                  {t.summary && <span className={t.action === "customer.note_added" ? "whitespace-pre-wrap" : ""}>{t.summary}</span>}
                  {t.reason && <span className="block text-xs text-ink-mute">Reason: {t.reason}</span>}
                </>
              ),
            }))}
            empty="No notes or staff changes yet."
          />
        </Panel>
        <Panel title="Sign-in activity">
          {c.loginEvents.length ? (
            <ul className="space-y-1 text-xs">
              {c.loginEvents.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    <Badge tone={e.success ? "good" : "bad"}>{e.success ? "ok" : "failed"}</Badge> {e.method}
                    {e.reason ? ` · ${e.reason.toLowerCase().replace(/_/g, " ")}` : ""}
                  </span>
                  <span className="text-ink-mute">
                    {e.ip ?? ""} · {formatStamp(e.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">No sign-ins recorded.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
