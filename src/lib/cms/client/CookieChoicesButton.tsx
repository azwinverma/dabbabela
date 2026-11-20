"use client";

import { OPEN_EVENT } from "@/components/site/ConsentNotice";

/** Footer "Cookie choices" link: reopens the consent notice (WP-11's ConsentNotice listens for OPEN_EVENT). */
export function CookieChoicesButton({ label, className }: { label: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      {label}
    </button>
  );
}
