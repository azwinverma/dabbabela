import { requireCompanyAdmin } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { pendingInvites } from "@/server/team";
import { Panel } from "@/components/admin/ui";
import { InviteForm, ImportForm, RevokeInvite } from "../TeamForms";

export const metadata = { title: "Invite & import" };

export default async function Invites() {
  const { company } = await requireCompanyAdmin();
  const invites = await pendingInvites(company.id);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Invite & import</h1>
      <p className="text-sm text-ink-mute">
        Invited people get an email link; they sign in (or create an account) with that same email and join straight away. Or share the join code <span className="font-mono font-semibold">{company.joinCode}</span>
        {company.requireApproval ? " — those joins wait for your approval." : "."}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Invite one person">
          <InviteForm />
        </Panel>
        <Panel title={`Pending invites (${invites.length})`}>
          {invites.length ? (
            <ul className="divide-y divide-ink-line/50 text-sm">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>
                    {i.email}
                    <span className="block text-xs text-ink-mute">
                      {i.department ? `${i.department} · ` : ""}
                      {i.expiresAt < new Date() ? "expired" : `expires ${formatStamp(i.expiresAt)}`}
                    </span>
                  </span>
                  <RevokeInvite id={i.id} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">No open invites.</p>
          )}
        </Panel>
        <Panel title="Bulk import (CSV)" className="lg:col-span-2">
          <p className="mb-3 text-sm text-ink-mute">We check every row first and show problems before anything is sent. Up to 500 people per import.</p>
          <ImportForm />
        </Panel>
      </div>
    </div>
  );
}
