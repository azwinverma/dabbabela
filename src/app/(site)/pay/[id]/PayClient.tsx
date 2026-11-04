"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentMethod } from "@prisma/client";
import { startPaymentAction, switchMethodAction, uploadProofAction } from "@/lib/actions/shop";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input } from "@/components/ui/Fields";
import { buttonClass } from "@/components/ui/Button";
import { PaymentPicker } from "@/components/site/DeliveryFields";
import type { AccountDict } from "@/lib/i18n/account";

type Props = {
  paymentId: string;
  method: PaymentMethod;
  methods: PaymentMethod[];
  bankDetails: string;
  qrImage: string;
  awaitingCheck: boolean;
  t: AccountDict["pay"];
};

export function PayClient({ paymentId, method, methods, bankDetails, qrImage, awaitingCheck, t }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [esewa, setEsewa] = useState<{ action: string; fields: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [switching, setSwitching] = useState(false);
  const [next, setNext] = useState<PaymentMethod | null>(null);

  useEffect(() => {
    if (esewa) formRef.current?.submit();
  }, [esewa]);

  function go() {
    setError(null);
    start(async () => {
      const r = await startPaymentAction(paymentId);
      if (!r.ok || !r.start) return setError(r.error ?? "Couldn't start the payment");
      if (r.start.kind === "esewa") setEsewa({ action: r.start.action, fields: r.start.fields });
      else if (r.start.kind === "khalti") window.location.href = r.start.url;
      else if (r.start.kind === "done") router.push(`/thank-you/${paymentId}`);
    });
  }

  function doSwitch() {
    if (!next) return;
    setError(null);
    start(async () => {
      const r = await switchMethodAction(paymentId, next);
      if (!r.ok) return setError(r.error ?? "Couldn't switch");
      setSwitching(false);
      router.push(r.redirectTo ?? `/pay/${paymentId}`);
      router.refresh();
    });
  }

  const gateway = method === "ESEWA" || method === "KHALTI";

  return (
    <div className="mt-6 space-y-6">
      {gateway && (
        <div className="rounded-2xl border-2 border-ink bg-white p-5">
          <p className="text-sm text-ink-soft">
            You'll be taken to {method === "ESEWA" ? "eSewa" : "Khalti"} to pay, then brought back here. We confirm the payment with {method === "ESEWA" ? "eSewa" : "Khalti"} directly before marking it paid.
          </p>
          <button type="button" onClick={go} disabled={pending || Boolean(esewa)} className={buttonClass("primary", "lg", "mt-4 w-full sm:w-auto")}>
            {pending || esewa ? t.redirecting : method === "ESEWA" ? t.payEsewa : t.payKhalti}
          </button>
          {esewa && (
            <form ref={formRef} action={esewa.action} method="POST" className="hidden">
              {Object.entries(esewa.fields).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            </form>
          )}
        </div>
      )}

      {method === "BANK_TRANSFER" && (
        <div className="rounded-2xl border-2 border-ink bg-white p-5">
          <h2 className="text-lg font-extrabold">{t.bankTitle}</h2>
          {awaitingCheck ? (
            <p role="status" className="mt-2 rounded-lg bg-besar-light px-3 py-2 text-sm">{t.proofReceived}</p>
          ) : (
            <>
              {bankDetails ? <p className="mt-2 whitespace-pre-line text-sm">{bankDetails}</p> : <p className="mt-2 text-sm text-ink-mute">Bank details will be shared by our team.</p>}
              {qrImage && <img src={qrImage} alt="Payment QR code" className="mt-3 h-52 w-52 rounded-lg border-2 border-ink object-contain" />}
              <p className="mt-3 text-sm text-ink-soft">Use your payment reference in the remarks. Your order is confirmed once our finance team sees the money in our account.</p>
              <ActionForm action={uploadProofAction} className="mt-4 space-y-3">
                <input type="hidden" name="paymentId" value={paymentId} />
                <Input label={t.reference} name="reference" required maxLength={120} />
                <div>
                  <label htmlFor="proof" className="label">{t.uploadProof}</label>
                  <input id="proof" name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="block text-sm" />
                  <p className="mt-1 text-xs text-ink-mute">JPG, PNG, WEBP or PDF, up to 5 MB.</p>
                </div>
                <SubmitButton>{t.submitProof}</SubmitButton>
              </ActionForm>
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-sindoor-light px-3 py-2 text-sm font-semibold text-sindoor-dark">
          {error}
        </p>
      )}

      <div className="rounded-2xl border-2 border-ink-line bg-white p-5">
        {switching ? (
          <div className="space-y-3">
            <PaymentPicker methods={methods.filter((m) => m !== method)} value={next} onChange={setNext} />
            <div className="flex gap-3">
              <button type="button" onClick={doSwitch} disabled={!next || pending} className={buttonClass("dark", "sm")}>
                Use this instead
              </button>
              <button type="button" onClick={() => setSwitching(false)} className="text-sm font-semibold underline">
                Back
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setSwitching(true)} className="text-sm font-semibold text-sindoor underline underline-offset-2">
            {t.switch}
          </button>
        )}
      </div>
    </div>
  );
}
