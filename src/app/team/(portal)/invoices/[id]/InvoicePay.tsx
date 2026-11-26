"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/Button";
import { startInvoicePaymentAction } from "../../actions";

type Props = {
  invoiceId: string;
  number: string;
  outstanding: string;
  methods: ("ESEWA" | "KHALTI")[];
  bankDetails: string;
  qrImage: string;
};

const LABEL = { ESEWA: "Pay with eSewa", KHALTI: "Pay with Khalti" } as const;

/** Corporate portal: pay the invoice's outstanding balance online, or see the bank details for a transfer. */
export function InvoicePay({ invoiceId, number, outstanding, methods, bankDetails, qrImage }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [esewa, setEsewa] = useState<{ action: string; fields: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (esewa) formRef.current?.submit();
  }, [esewa]);

  function pay(method: "ESEWA" | "KHALTI") {
    setError(null);
    start(async () => {
      const r = await startInvoicePaymentAction(invoiceId, method);
      if (!r.ok || !r.start) return setError(r.error ?? "Couldn't start the payment");
      if (r.start.kind === "esewa") setEsewa({ action: r.start.action, fields: r.start.fields });
      else if (r.start.kind === "khalti") window.location.href = r.start.url;
      else window.location.reload();
    });
  }

  return (
    <div className="mb-4 grid gap-4 rounded-xl border-2 border-ink bg-white p-4 md:grid-cols-2 print:hidden" data-testid="invoice-pay">
      <div>
        <h2 className="font-display text-lg font-bold">Pay {outstanding} online</h2>
        <p className="mt-1 text-sm text-ink-soft">
          The full outstanding balance of {number}. You&apos;ll go to the gateway and come back here; we confirm the payment with the gateway before marking the invoice paid.
        </p>
        {methods.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {methods.map((m) => (
              <button key={m} type="button" onClick={() => pay(m)} disabled={pending || Boolean(esewa)} className={buttonClass(m === "ESEWA" ? "primary" : "dark", "sm")}>
                {pending || esewa ? "Taking you to the gateway…" : LABEL[m]}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-mute">Online payment isn&apos;t available right now — pay by bank transfer.</p>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-sindoor-light px-3 py-2 text-sm font-semibold text-sindoor-dark">
            {error}
          </p>
        )}
        {esewa && (
          <form ref={formRef} action={esewa.action} method="POST" className="hidden">
            {Object.entries(esewa.fields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          </form>
        )}
      </div>
      <div>
        <h2 className="font-display text-lg font-bold">Or pay by bank transfer</h2>
        {bankDetails ? <p className="mt-1 whitespace-pre-line text-sm">{bankDetails}</p> : <p className="mt-1 text-sm text-ink-mute">Ask us for the bank details.</p>}
        {/* eslint-disable-next-line @next/next/no-img-element -- admin-uploaded QR, any host allowed by the CSP */}
        {qrImage && <img src={qrImage} alt="Payment QR code" className="mt-2 h-40 w-40 rounded-lg border-2 border-ink object-contain" />}
        <p className="mt-2 text-xs text-ink-mute">Put {number} in the remarks. Our finance team records the transfer when it reaches our account.</p>
      </div>
    </div>
  );
}
