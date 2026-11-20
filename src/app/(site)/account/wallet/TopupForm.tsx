"use client";

import { useState } from "react";
import type { PaymentMethod } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { PaymentPicker } from "@/components/site/DeliveryFields";
import { startTopupAction } from "@/lib/actions/wallet";
import { rs } from "@/lib/money";
import { cn } from "@/lib/utils";

type Props = {
  methods: PaymentMethod[];
  min: number;
  max: number;
  maxNow: number;
  daily: number;
  cap: number;
  usedToday: number;
};

const PRESETS = [50000, 100000, 200000, 500000]; // Rs 500, 1,000, 2,000, 5,000

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `topup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** "Add credit": amount presets + custom, payment method, the limits that apply. The server re-checks everything. */
export function TopupForm({ methods, min, max, maxNow, daily, cap, usedToday }: Props) {
  const presets = PRESETS.filter((p) => p >= min && p <= maxNow);
  const [preset, setPreset] = useState<string>(presets[1] != null ? String(presets[1] / 100) : presets[0] != null ? String(presets[0] / 100) : "custom");
  const [method, setMethod] = useState<PaymentMethod | null>(methods.length === 1 ? methods[0] : null);
  const [key] = useState(newKey);
  const blocked = maxNow <= 0;

  return (
    <section aria-labelledby="topup-title" className="mt-6 rounded-2xl border-2 border-ink bg-white p-5">
      <h2 id="topup-title" className="text-xl font-extrabold">Add credit</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Top up with eSewa, Khalti or a bank transfer. Credit is for Dabba Bela meals only — it isn&apos;t cash, can&apos;t be transferred or withdrawn, and earns no interest. Unspent top-ups can be refunded to where they came from; ask support.
      </p>
      <p className="mt-2 text-xs text-ink-mute">
        {rs(min)} – {rs(max)} per top-up · up to {rs(daily)} a day ({rs(Math.max(0, daily - usedToday))} left today) · your credit can&apos;t go above {rs(cap)}.
      </p>
      {blocked ? (
        <p role="status" className="mt-4 rounded-lg bg-besar-light px-3 py-2 text-sm">
          You can&apos;t add more credit right now — you&apos;ve reached today&apos;s limit or the balance cap. Spend some credit or try again tomorrow.
        </p>
      ) : !methods.length ? (
        <p role="status" className="mt-4 text-sm text-sindoor">No payment method is available for top-ups right now. Please contact us.</p>
      ) : (
        <ActionForm action={startTopupAction} className="mt-4 space-y-4">
          <input type="hidden" name="idempotencyKey" value={key} />
          <fieldset>
            <legend className="label">Amount</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {presets.map((p) => {
                const v = String(p / 100);
                return (
                  <label key={p} className={cn("cursor-pointer rounded-full border-2 px-4 py-1.5 text-sm font-bold", preset === v ? "border-ink bg-besar-light" : "border-ink-line hover:border-ink")}>
                    <input type="radio" name="preset" value={v} checked={preset === v} onChange={() => setPreset(v)} className="sr-only" />
                    {rs(p)}
                  </label>
                );
              })}
              <label className={cn("cursor-pointer rounded-full border-2 px-4 py-1.5 text-sm font-bold", preset === "custom" ? "border-ink bg-besar-light" : "border-ink-line hover:border-ink")}>
                <input type="radio" name="preset" value="custom" checked={preset === "custom"} onChange={() => setPreset("custom")} className="sr-only" />
                Other amount
              </label>
            </div>
            {preset === "custom" && (
              <div className="mt-3 max-w-xs">
                <label htmlFor="topup-amount" className="label">
                  Amount (Rs)
                </label>
                <input id="topup-amount" name="amount" inputMode="decimal" required className="field" placeholder={`${min / 100} – ${maxNow / 100}`} aria-describedby="topup-amount-hint" />
                <p id="topup-amount-hint" className="mt-1 text-xs text-ink-mute">
                  Up to {rs(maxNow)} right now.
                </p>
              </div>
            )}
          </fieldset>
          <fieldset>
            <legend className="label">Pay with</legend>
            <div className="mt-1">
              <PaymentPicker methods={methods} value={method} onChange={setMethod} />
            </div>
          </fieldset>
          <SubmitButton pendingText="Starting…">Continue to payment</SubmitButton>
        </ActionForm>
      )}
    </section>
  );
}
