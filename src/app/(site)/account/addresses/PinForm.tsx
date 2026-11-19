"use client";

import { useId, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { saveAddressPinAction } from "@/lib/actions/dashboard";
import { format } from "@/lib/i18n";
import type { DashboardDict } from "@/lib/i18n/dashboard";

/**
 * Optional map pin for one saved address: "Use my location" (browser geolocation, only on click — the browser asks
 * for consent) or type latitude/longitude by hand. No map library needed; works as a plain form.
 */
export function PinForm({ addressId, lat, lng, labels }: { addressId: string; lat: number | null; lng: number | null; labels: DashboardDict["pin"] }) {
  const has = lat != null && lng != null;
  const [vals, setVals] = useState({ lat: has ? String(lat) : "", lng: has ? String(lng) : "" });
  const [msg, setMsg] = useState<string | null>(null);
  const id = useId();

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return setMsg(labels.unsupported);
    setMsg(labels.locating);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setVals({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) });
        setMsg(labels.located);
      },
      () => setMsg(labels.denied),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <details className="mt-2 rounded-xl border-2 border-ink-line bg-white px-4 py-2 text-sm open:border-ink">
      <summary className="cursor-pointer select-none py-1 font-semibold">
        {labels.title}: <span className="font-normal text-ink-soft">{has ? format(labels.current, { lat: lat!, lng: lng! }) : labels.none}</span>
      </summary>
      <div className="space-y-3 pb-2 pt-2">
        <p className="text-xs text-ink-mute">{labels.hint}</p>
        <div>
          <button type="button" onClick={locate} className="rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold hover:bg-ink hover:text-paper">
            {labels.useLocation}
          </button>
          <p className="mt-1 text-xs text-ink-mute">{labels.consent}</p>
          {msg && (
            <p className="mt-1 text-xs font-medium text-ink-soft" role="status" aria-live="polite">
              {msg}
            </p>
          )}
        </div>
        <ActionForm action={saveAddressPinAction} className="space-y-3">
          <input type="hidden" name="addressId" value={addressId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-lat`} className="label">{labels.lat}</label>
              <input id={`${id}-lat`} name="lat" inputMode="decimal" autoComplete="off" className="field" placeholder={labels.latHint} value={vals.lat} onChange={(e) => setVals((v) => ({ ...v, lat: e.target.value }))} aria-describedby={`${id}-range`} />
            </div>
            <div>
              <label htmlFor={`${id}-lng`} className="label">{labels.lng}</label>
              <input id={`${id}-lng`} name="lng" inputMode="decimal" autoComplete="off" className="field" placeholder={labels.lngHint} value={vals.lng} onChange={(e) => setVals((v) => ({ ...v, lng: e.target.value }))} aria-describedby={`${id}-range`} />
            </div>
          </div>
          <p id={`${id}-range`} className="text-xs text-ink-mute">Nepal: 26–31 / 80–89</p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" name="intent" value="save">{labels.save}</SubmitButton>
            {has && (
              <SubmitButton size="sm" variant="ghost" name="intent" value="clear">{labels.remove}</SubmitButton>
            )}
          </div>
        </ActionForm>
      </div>
    </details>
  );
}
