"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { AddressType, PaymentMethod } from "@prisma/client";
import { saveAddressAction, type AddressResult } from "@/lib/actions/account";
import { FormMessage, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Checkbox } from "@/components/ui/Fields";
import { rs } from "@/lib/money";
import { cn } from "@/lib/utils";

export type AddressView = {
  id: string;
  label: string;
  type: AddressType;
  recipientName: string;
  phone: string;
  placeName: string | null;
  line1: string;
  area: string;
  ward: number | null;
  municipality: string | null;
  city: string;
  landmark: string | null;
  instructions: string | null;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  zoneId: string | null;
  zoneName: string | null;
  kitchenId: string | null;
};

const TYPE_OPTIONS: { value: AddressType; label: string; hint: string }[] = [
  { value: "OFFICE", label: "Office", hint: "Company, bank, NGO…" },
  { value: "SHOP", label: "Shop", hint: "Your shop or showroom" },
  { value: "COLLEGE", label: "College", hint: "Campus, hostel, library" },
  { value: "SITE", label: "Work site", hint: "Construction, factory, warehouse" },
  { value: "HOME", label: "Home", hint: "Flat, house, family" },
  { value: "OTHER", label: "Other", hint: "Anywhere else we can find" },
];

/** Address form used in Account → Addresses and inline at checkout / plan sign-up. */
export function AddressForm({
  address,
  defaults,
  onSaved,
  onCancel,
  compact,
}: {
  address?: AddressView | null;
  defaults?: { recipientName?: string; phone?: string };
  onSaved?: (r: AddressResult) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [state, action] = useActionState(saveAddressAction, { ok: false } as AddressResult);
  const [type, setType] = useState<AddressType>(address?.type ?? "OFFICE");
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(address?.lat != null && address?.lng != null ? { lat: address.lat, lng: address.lng } : null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const handled = useRef<AddressResult | null>(null);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      onSaved?.(state);
    }
  }, [state, onSaved]);

  function locate() {
    if (!navigator.geolocation) return setGeoMsg("Your browser can't share location — the landmark is enough.");
    setGeoMsg("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeo({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) });
        setGeoMsg("Pin saved. It helps the rider; we still go by your area and landmark.");
      },
      () => setGeoMsg("Couldn't get your location — that's fine, the landmark is enough."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const e = state.errors ?? {};
  const place = type === "HOME" ? "Building / house name" : type === "SHOP" ? "Shop name" : type === "COLLEGE" ? "College / campus" : type === "SITE" ? "Site / company name" : "Office / company name";

  return (
    <form action={action} className="space-y-4">
      {address && <input type="hidden" name="id" value={address.id} />}
      {geo && (
        <>
          <input type="hidden" name="lat" value={geo.lat} />
          <input type="hidden" name="lng" value={geo.lng} />
        </>
      )}
      <fieldset>
        <legend className="label">Where is this?</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {TYPE_OPTIONS.map((o) => (
            <label key={o.value} className={cn("cursor-pointer rounded-lg border-2 px-2 py-2 text-center text-sm font-semibold transition", type === o.value ? "border-ink bg-besar-light" : "border-ink-line bg-white hover:border-ink")} title={o.hint}>
              <input type="radio" name="type" value={o.value} checked={type === o.value} onChange={() => setType(o.value)} className="sr-only" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Save as" name="label" placeholder={type === "HOME" ? "Home" : "e.g. Office, Didi's shop"} defaultValue={address?.label} maxLength={40} error={e.label} />
        <Input label={place} name="placeName" defaultValue={address?.placeName ?? ""} maxLength={120} hint="optional" />
        <Input label="Who receives it?" name="recipientName" defaultValue={address?.recipientName ?? defaults?.recipientName} required error={e.recipientName} />
        <Input label="Their phone" name="phone" type="tel" inputMode="tel" placeholder="98XXXXXXXX" defaultValue={address?.phone?.replace(/^\+977/, "") ?? defaults?.phone?.replace(/^\+977/, "")} required error={e.phone} />
      </div>
      <Input label="Street, tole, building & floor" name="line1" defaultValue={address?.line1} required error={e.line1} placeholder="e.g. Shantinagar Marg, Bhawani Complex, 3rd floor" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Area / locality" name="area" defaultValue={address?.area} required error={e.area} placeholder="e.g. New Baneshwor" hint="We check delivery by this" />
        <Input label="Ward no." name="ward" type="number" min={1} max={40} defaultValue={address?.ward ?? ""} error={e.ward} hint="optional" />
        <Input label="City" name="city" defaultValue={address?.city ?? "Kathmandu"} error={e.city} />
      </div>
      {!compact && <Input label="Municipality" name="municipality" defaultValue={address?.municipality ?? ""} hint="optional, e.g. Lalitpur Metropolitan City" />}
      <Input label="Landmark" name="landmark" defaultValue={address?.landmark ?? ""} placeholder="e.g. opposite Everest Bank, blue gate" />
      <Textarea label="Notes for the rider" name="instructions" rows={2} defaultValue={address?.instructions ?? ""} placeholder="e.g. leave at reception, call on arrival" />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={locate} className="rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold hover:bg-ink hover:text-paper">
          {geo ? "Update map pin" : "Add map pin (optional)"}
        </button>
        {geoMsg && <span className="text-xs text-ink-mute" role="status">{geoMsg}</span>}
      </div>
      <Checkbox name="isDefault" label="Make this my default address" defaultChecked={address?.isDefault} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton>{address ? "Save address" : "Add address"}</SubmitButton>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm font-semibold text-ink-soft underline underline-offset-2">
            Cancel
          </button>
        )}
      </div>
      {state.message && <FormMessage ok={state.ok && state.covered !== false} message={state.message} />}
    </form>
  );
}

export function AddressCard({ a, selected, onSelect }: { a: AddressView; selected?: boolean; onSelect?: () => void }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold">
          {a.label} <span className="text-xs font-semibold uppercase tracking-wide text-ink-mute">· {a.type.toLowerCase()}</span>
        </p>
        {a.zoneName ? <span className="rounded-full bg-saag-light px-2 py-0.5 text-[11px] font-bold text-saag-dark">Delivers</span> : <span className="rounded-full bg-sindoor-light px-2 py-0.5 text-[11px] font-bold text-sindoor-dark">Not covered yet</span>}
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {[a.placeName, a.line1, a.area, a.ward ? `Ward ${a.ward}` : null, a.city].filter(Boolean).join(", ")}
      </p>
      {a.landmark && <p className="text-xs text-ink-mute">Near {a.landmark}</p>}
      <p className="mt-1 text-xs text-ink-mute">
        {a.recipientName} · {a.phone.replace(/^\+977/, "")}
      </p>
    </>
  );
  if (!onSelect) return <div className="rounded-xl border-2 border-ink-line bg-white p-4">{body}</div>;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={cn("w-full rounded-xl border-2 bg-white p-4 text-left transition", selected ? "border-ink shadow-sticker-sm" : "border-ink-line hover:border-ink")}>
      {body}
    </button>
  );
}

const METHOD_TEXT: Record<PaymentMethod, { label: string; note: string }> = {
  ESEWA: { label: "eSewa", note: "Pay now in the eSewa app or web" },
  KHALTI: { label: "Khalti", note: "Pay now with Khalti wallet, bank or card" },
  BANK_TRANSFER: { label: "Bank transfer / QR", note: "Scan or transfer, then upload the screenshot" },
  CASH: { label: "Cash on delivery", note: "Pay the rider — exact change helps" },
  COMPANY_INVOICE: { label: "Company invoice", note: "Billed to your company monthly" },
  WALLET: { label: "Dabba Bela credit", note: "Use your credit balance" },
};

export function PaymentPicker({ methods, value, onChange, walletBalance }: { methods: PaymentMethod[]; value: PaymentMethod | null; onChange: (m: PaymentMethod) => void; walletBalance?: number }) {
  if (!methods.length) return <p className="text-sm text-sindoor">No payment method is available right now. Please contact us.</p>;
  return (
    <div role="radiogroup" aria-label="Payment method" className="grid gap-2 sm:grid-cols-2">
      {methods.map((m) => (
        <label key={m} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border-2 bg-white p-3 transition", value === m ? "border-ink shadow-sticker-sm" : "border-ink-line hover:border-ink")}>
          <input type="radio" name="method" value={m} checked={value === m} onChange={() => onChange(m)} className="mt-1 accent-sindoor" />
          <span>
            <span className="block font-bold">{METHOD_TEXT[m].label}</span>
            <span className="block text-xs text-ink-mute">
              {METHOD_TEXT[m].note}
              {m === "WALLET" && walletBalance != null ? ` · balance ${rs(walletBalance)}` : ""}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function SummaryRow({ label, value, strong, muted, negative }: { label: React.ReactNode; value: number; strong?: boolean; muted?: boolean; negative?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1", strong && "border-t-2 border-ink pt-2 text-lg font-extrabold", muted && "text-sm text-ink-mute")}>
      <span>{label}</span>
      <span className="tabular-nums">{negative && value > 0 ? `− ${rs(value)}` : rs(value)}</span>
    </div>
  );
}
