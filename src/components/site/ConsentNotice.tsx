"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/Button";

const COOKIE = "dabba_consent";
/** Any page (e.g. a footer "Cookie choices" link) can reopen the notice: window.dispatchEvent(new Event(OPEN_EVENT)). */
export const OPEN_EVENT = "dabba:consent-open";

function currentChoice() {
  const m = document.cookie.match(/(?:^|;\s*)dabba_consent=(granted|denied)/);
  return m?.[1] ?? null;
}

/**
 * Minimal, honest notice for marketing attribution (WP-11). Nothing about where a visitor came from is stored until
 * they choose "Allow"; "No thanks" is as easy as "Allow" and removes anything already stored.
 * Sign-in and cart cookies are essential and don't depend on this choice.
 */
export function ConsentNotice() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!currentChoice()) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, reopen);
    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, []);

  async function choose(choice: "granted" | "denied") {
    setBusy(true);
    try {
      await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice,
          landing: window.location.href,
          referrer: document.referrer || null,
        }),
      });
    } catch {
      // Offline: remember the choice locally so we don't nag; nothing is recorded server-side.
      document.cookie = `${COOKIE}=${choice}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  if (!open) return null;
  return (
    // In the page flow (not an overlay), so it never covers buttons, the cart bar or the checkout.
    <section
      role="region"
      aria-label="Cookie choice"
      className="border-b-2 border-ink bg-paper-card px-4 py-3 text-sm text-ink"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-6">
        <div>
          <p className="font-semibold">May we remember how you found us?</p>
          <p className="mt-0.5 text-ink-soft">
            If you allow it, we keep a small first-party cookie with the ad or
            link that brought you here (campaign tags and the referring website,
            never what you searched for) and save it with your account and
            orders, so we know which marketing works. No third-party trackers.
            Sign-in and cart cookies are needed for the site to work and
            aren&apos;t affected.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => choose("granted")}
            className={buttonClass("dark", "sm")}
          >
            Allow
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => choose("denied")}
            className={buttonClass("outline", "sm")}
          >
            No thanks
          </button>
        </div>
      </div>
    </section>
  );
}
