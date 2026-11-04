import { requireUser, isStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatStamp } from "@/lib/dates";
import { DisableTwoFactor, PasswordForm, RevokeButton, TwoFactorSetup } from "./SecurityForms";

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${br} on ${os}`;
}

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/account/security");
  const hasPassword = await db.account.count({ where: { userId: user.id, providerId: "credential", password: { not: null } } });
  const sessions = await db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { updatedAt: "desc" } });
  const forced = sp.setup === "2fa" && isStaff(user.role) && !user.twoFactorEnabled;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {forced && (
        <div role="alert" className="rounded-2xl border-2 border-sindoor bg-sindoor-light p-5 lg:col-span-2">
          <p className="font-extrabold text-sindoor-dark">Staff accounts need two-step sign-in</p>
          <p className="mt-1 text-sm">Set it up below to open the control room. It takes about a minute with an authenticator app.</p>
        </div>
      )}
      <section className="rounded-2xl border-2 border-ink bg-paper-card p-5">
        <h2 className="text-xl font-extrabold">Two-step sign-in</h2>
        <div className="mt-4">
          {user.twoFactorEnabled ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-saag-dark">On — you'll be asked for a code from your authenticator app.</p>
              {!isStaff(user.role) && <DisableTwoFactor />}
            </div>
          ) : hasPassword ? (
            <TwoFactorSetup />
          ) : (
            <p className="text-sm text-ink-soft">You sign in with a mobile code. Set a password first (use "Forgot password" with your email) to add two-step sign-in.</p>
          )}
        </div>
      </section>
      <section className="rounded-2xl border-2 border-ink bg-paper-card p-5">
        <h2 className="text-xl font-extrabold">Password</h2>
        <div className="mt-4">{hasPassword ? <PasswordForm /> : <p className="text-sm text-ink-soft">No password set — you sign in with a code sent to your mobile.</p>}</div>
      </section>
      <section className="rounded-2xl border-2 border-ink bg-paper-card p-5 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold">Where you're signed in</h2>
          {sessions.length > 1 && <RevokeButton all />}
        </div>
        <ul className="mt-3 divide-y divide-ink-line">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span>
                <span className="font-semibold">{device(s.userAgent)}</span>
                {s.id === user.sessionId && <span className="ml-2 rounded-full bg-saag-light px-2 py-0.5 text-xs font-bold text-saag-dark">This device</span>}
                <span className="block text-xs text-ink-mute">
                  Last active {formatStamp(s.updatedAt)}
                  {s.ipAddress ? ` · ${s.ipAddress.replace(/\.\d+$/, ".•")}` : ""}
                </span>
              </span>
              {s.id !== user.sessionId && <RevokeButton token={s.token} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
