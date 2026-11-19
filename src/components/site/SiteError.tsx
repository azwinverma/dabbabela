"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { dashboardDict } from "@/lib/i18n/dashboard";

/** Customer-side error panel for error.tsx boundaries (bilingual: reads the language cookie on the client). */
export function SiteError({ error, reset, homeHref = "/account" }: { error: Error & { digest?: string }; reset: () => void; homeHref?: string }) {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    const v = document.cookie.split("; ").find((c) => c.startsWith(`${LOCALE_COOKIE}=`))?.split("=")[1];
    if (isLocale(v)) setLocale(v);
  }, []);
  const t = dashboardDict(locale).states;
  return (
    <div role="alert" className="mx-auto max-w-lg rounded-2xl border-2 border-ink bg-paper-card px-6 py-10 text-center">
      <p className="font-marker text-2xl text-sindoor" aria-hidden>
        ohho!
      </p>
      <h2 className="mt-1 text-xl font-extrabold">{t.errorTitle}</h2>
      <p className="mt-2 text-sm text-ink-soft">{format(t.errorBody, { code: error.digest ? ` (${error.digest})` : "" })}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className="rounded-xl border-2 border-ink bg-besar px-5 py-2 font-bold shadow-sticker-sm">
          {t.retry}
        </button>
        <Link href={homeHref} className="rounded-xl border-2 border-ink px-5 py-2 font-bold hover:bg-ink hover:text-paper">
          {t.home}
        </Link>
      </div>
    </div>
  );
}
