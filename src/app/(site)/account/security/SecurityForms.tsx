"use client";

import { useActionState } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/ui/ActionForm";
import { Input } from "@/components/ui/Fields";
import { changePasswordAction, confirmTwoFactorAction, disableTwoFactorAction, enableTwoFactorAction, revokeSessionAction, type TwoFactorState } from "@/lib/actions/auth";

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="space-y-3" resetOnSuccess>
      {(state) => (
        <>
          <Input label="Current password" name="current" type="password" autoComplete="current-password" required />
          <Input label="New password" name="password" type="password" autoComplete="new-password" minLength={8} required error={state.errors?.password} />
          <Input label="Repeat new password" name="password2" type="password" autoComplete="new-password" minLength={8} required error={state.errors?.password2} />
          <SubmitButton size="sm">Change password</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function TwoFactorSetup() {
  const [start, startAction] = useActionState(enableTwoFactorAction, { ok: false } as TwoFactorState);
  const [confirm, confirmAction] = useActionState(confirmTwoFactorAction, { ok: false } as TwoFactorState);
  if (confirm.step === "done")
    return (
      <div className="space-y-3">
        <FormMessage ok message={confirm.message ?? "Two-step sign-in is on"} />
        <BackupCodes codes={confirm.backupCodes ?? start.backupCodes ?? []} />
      </div>
    );
  if (start.step === "verify")
    return (
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Open Google Authenticator, Microsoft Authenticator or similar.</li>
          <li>Scan this code (or enter the key by hand).</li>
          <li>Type the 6-digit code it shows.</li>
        </ol>
        {start.qr && <img src={start.qr} alt="QR code for your authenticator app" width={200} height={200} className="rounded-lg border-2 border-ink" />}
        {start.uri && (
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold">Can't scan? Show the key</summary>
            <code className="mt-1 block break-all rounded bg-ink/5 p-2">{new URL(start.uri).searchParams.get("secret")}</code>
          </details>
        )}
        <form action={confirmAction} className="flex flex-wrap items-end gap-2">
          <Input label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="w-40" />
          <SubmitButton size="sm">Turn on</SubmitButton>
        </form>
        {confirm.message && !confirm.ok && <FormMessage ok={false} message={confirm.message} />}
      </div>
    );
  return (
    <form action={startAction} className="space-y-3">
      <p className="text-sm text-ink-soft">Adds a code from your phone each time you log in on a new device.</p>
      <Input label="Confirm your password" name="password" type="password" autoComplete="current-password" required />
      <SubmitButton size="sm">Set up two-step sign-in</SubmitButton>
      {start.message && !start.ok && <FormMessage ok={false} message={start.message} />}
    </form>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  if (!codes.length) return null;
  return (
    <div className="rounded-xl border-2 border-ink bg-white p-4">
      <p className="text-sm font-bold">Backup codes — each works once</p>
      <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-mute">Save these now. You won't see them again.</p>
    </div>
  );
}

export function DisableTwoFactor() {
  return (
    <ActionForm action={disableTwoFactorAction} className="flex flex-wrap items-end gap-2">
      <Input label="Password" name="password" type="password" autoComplete="current-password" required className="w-56" />
      <SubmitButton size="sm" variant="danger" confirm="Turn off two-step sign-in?">
        Turn off
      </SubmitButton>
    </ActionForm>
  );
}

export function RevokeButton({ token, all }: { token?: string; all?: boolean }) {
  return (
    <ActionForm action={revokeSessionAction} showMessage={false}>
      {token && <input type="hidden" name="token" value={token} />}
      {all && <input type="hidden" name="all" value="1" />}
      <SubmitButton size="sm" variant="ghost">
        {all ? "Sign out all other devices" : "Sign out"}
      </SubmitButton>
    </ActionForm>
  );
}
