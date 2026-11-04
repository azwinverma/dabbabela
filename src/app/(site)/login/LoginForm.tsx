"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input } from "@/components/ui/Fields";
import { loginAction, sendOtpAction, verifyOtpAction, verifyTwoFactorAction } from "@/lib/actions/auth";
import type { AccountDict } from "@/lib/i18n/account";
import { cn } from "@/lib/utils";

type T = AccountDict["auth"];

export function LoginForm({ next, phoneOtp, t }: { next: string; phoneOtp: boolean; t: T }) {
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [phone, setPhone] = useState("");
  return (
    <div>
      {phoneOtp && (
        <div role="tablist" aria-label="Sign-in method" className="mb-5 inline-flex rounded-full border-2 border-ink p-1">
          {(["email", "phone"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              type="button"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn("rounded-full px-4 py-1.5 text-sm font-bold", mode === m ? "bg-ink text-paper" : "text-ink")}
            >
              {m === "email" ? t.emailTab : t.otpTab}
            </button>
          ))}
        </div>
      )}
      {mode === "email" ? (
        <ActionForm action={loginAction} className="space-y-4">
          {(state) => (
            <>
              <input type="hidden" name="next" value={next} />
              <Input label={t.email} name="email" type="email" autoComplete="email" required error={state.errors?.email} />
              <Input label={t.password} name="password" type="password" autoComplete="current-password" required minLength={8} />
              <div className="flex items-center justify-between gap-3">
                <SubmitButton pendingText={t.loggingIn}>{t.login}</SubmitButton>
                <Link href="/forgot-password" className="text-sm font-semibold text-ink-soft underline underline-offset-2">
                  {t.forgot}
                </Link>
              </div>
            </>
          )}
        </ActionForm>
      ) : (
        <div className="space-y-4">
          <ActionForm action={sendOtpAction} className="space-y-3">
            <Input label={t.mobile} name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <SubmitButton variant="outline" pendingText="…">
              {t.sendCode}
            </SubmitButton>
          </ActionForm>
          <ActionForm action={verifyOtpAction} className="space-y-3">
            <input type="hidden" name="phone" value={phone} />
            <input type="hidden" name="next" value={next} />
            <Input label={t.code} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
            <SubmitButton pendingText="…">{t.verify}</SubmitButton>
          </ActionForm>
        </div>
      )}
    </div>
  );
}

export function TwoFactorForm({ next, t }: { next: string; t: T }) {
  const [backup, setBackup] = useState(false);
  return (
    <ActionForm action={verifyTwoFactorAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="mode" value={backup ? "backup" : "totp"} />
      <Input
        label={backup ? "Backup code" : t.code}
        name="code"
        autoComplete="one-time-code"
        inputMode={backup ? "text" : "numeric"}
        maxLength={backup ? 20 : 6}
        autoFocus
        required
      />
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingText="…">{t.verify}</SubmitButton>
        <button type="button" onClick={() => setBackup((b) => !b)} className="text-sm font-semibold text-ink-soft underline underline-offset-2">
          {backup ? "Use my authenticator app" : t.backupCode}
        </button>
      </div>
    </ActionForm>
  );
}
