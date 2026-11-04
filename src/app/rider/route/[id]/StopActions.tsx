"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { deliverAction, failAction } from "../../actions";

export function StopActions({ orderId, needOtp, needPhoto, cash }: { orderId: string; needOtp: boolean; needPhoto: boolean; cash: number }) {
  const [mode, setMode] = useState<"idle" | "deliver" | "fail">("idle");
  if (mode === "idle")
    return (
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setMode("deliver")} className="h-14 rounded-xl bg-saag text-lg font-bold text-white">Delivered</button>
        <button type="button" onClick={() => setMode("fail")} className="h-14 rounded-xl border-2 border-sindoor text-lg font-bold text-sindoor">Problem</button>
      </div>
    );
  if (mode === "fail")
    return (
      <ActionForm action={failAction.bind(null, orderId)} className="mt-3 space-y-2">
        <select name="reason" required className="field h-12 text-base" defaultValue="" aria-label="What went wrong">
          <option value="" disabled>What went wrong?</option>
          <option>Customer not reachable</option>
          <option>Office/shop closed</option>
          <option>Wrong or incomplete address</option>
          <option>Customer refused the order</option>
          <option>Damaged in transit</option>
          <option>Other — called dispatch</option>
        </select>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setMode("idle")} className="h-12 rounded-xl border-2 border-ink-line font-bold">Back</button>
          <SubmitButton variant="danger" className="h-12">Mark failed</SubmitButton>
        </div>
      </ActionForm>
    );
  return (
    <ActionForm action={deliverAction.bind(null, orderId)} className="mt-3 space-y-2">
      {needOtp && (
        <label className="block text-sm font-semibold">
          Customer&apos;s 4-digit code
          <input name="otp" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="one-time-code" required className="field mt-1 h-14 text-center font-mono text-2xl tracking-[0.5em]" />
        </label>
      )}
      {cash > 0 && (
        <label className="block text-sm font-semibold">
          Cash received (Rs)
          <input name="cash" inputMode="decimal" defaultValue={(cash / 100).toString()} required className="field mt-1 h-12 text-lg" />
        </label>
      )}
      {needPhoto && (
        <label className="block text-sm font-semibold">
          Photo of the hand-off
          <input name="photo" type="file" accept="image/*" capture="environment" required className="mt-1 block w-full text-sm" />
        </label>
      )}
      <input name="note" placeholder="Note (optional) — e.g. left at reception" className="field h-12" />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setMode("idle")} className="h-12 rounded-xl border-2 border-ink-line font-bold">Back</button>
        <SubmitButton className="h-12 bg-saag" pendingText="Saving…">Confirm</SubmitButton>
      </div>
    </ActionForm>
  );
}
