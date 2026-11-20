"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile widget (see src/lib/turnstile.ts). Renders nothing when NEXT_PUBLIC_TURNSTILE_SITE_KEY is
 * unset (dev / tests / E2E). Put it inside a <form>: Turnstile adds a hidden `cf-turnstile-response` input that the
 * server action verifies. Tokens are single-use, so the widget resets right after each submit (after React has read
 * the form data) to be ready for a retry.
 *
 * The script is injected from this component (a nonce-trusted Next chunk), so it is allowed by the nonce +
 * 'strict-dynamic' CSP without listing the host in script-src.
 */
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<void> | null = null;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  loader ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loader = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return loader;
}

export function Turnstile({ action, className }: { action?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    const el = ref.current;
    let widgetId: string | null = null;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetId = window.turnstile.render(el, { sitekey: SITE_KEY, action, appearance: "interaction-only", "refresh-expired": "auto" });
      })
      .catch(() => {
        /* the server refuses the submit with a clear message */
      });
    const form = el.closest("form");
    const onSubmit = () => setTimeout(() => widgetId && window.turnstile?.reset(widgetId), 0);
    form?.addEventListener("submit", onSubmit);
    return () => {
      cancelled = true;
      form?.removeEventListener("submit", onSubmit);
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [action]);
  if (!SITE_KEY) return null;
  return <div ref={ref} className={className} data-testid="turnstile" />;
}
