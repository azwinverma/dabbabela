"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, ShoppingBag, UserRound, Languages } from "lucide-react";
import { useCart } from "./cart";
import { cn } from "@/lib/utils";
import { setLocaleAction } from "@/lib/actions/public";

type Labels = { login: string; account: string; admin: string; team: string; cart: string; open: string; close: string; language: string; home: string };

function LangSwitch({ locale, label, className }: { locale: string; label: string; className?: string }) {
  return (
    <form action={setLocaleAction} className={className}>
      <input type="hidden" name="locale" value={locale === "ne" ? "en" : "ne"} />
      <button type="submit" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold hover:bg-ink/5" lang={locale === "ne" ? "en" : "ne"}>
        <Languages className="h-4 w-4" aria-hidden />
        <span className={locale === "ne" ? "" : "lang-ne"}>{locale === "ne" ? "English" : "नेपाली"}</span>
        <span className="sr-only">{label}</span>
      </button>
    </form>
  );
}

export function HeaderClient({
  logo,
  links,
  user,
  locale,
  labels,
}: {
  logo: React.ReactNode;
  links: { href: string; label: string }[];
  user: { name: string; staff: boolean; teamAdmin: boolean } | null;
  locale: string;
  labels: Labels;
}) {
  const path = usePathname();
  const { count, ready } = useCart();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const accountHref = user ? (user.staff ? "/admin" : "/account") : "/login";
  const accountLabel = user ? (user.staff ? labels.admin : user.name.split(" ")[0]) : labels.login;

  return (
    <div className="container flex h-[72px] items-center justify-between gap-3">
      <Link href="/" aria-label={labels.home} className="shrink-0">
        {logo}
      </Link>
      <nav className={cn("hidden items-center gap-0.5 xl:flex", locale === "ne" && "lang-ne")} aria-label="Main">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={path.startsWith(l.href) ? "page" : undefined}
            className={cn("rounded-full px-3.5 py-2 text-[0.92rem] font-semibold transition", path.startsWith(l.href) ? "bg-ink text-paper" : "text-ink hover:bg-ink/5")}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-1.5">
        <LangSwitch locale={locale} label={labels.language} className="hidden md:block" />
        {user?.teamAdmin && (
          <Link href="/team" className="hidden rounded-full px-3 py-2 text-sm font-semibold hover:bg-ink/5 lg:inline-flex">
            {labels.team}
          </Link>
        )}
        <Link href={accountHref} className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold hover:bg-ink/5 sm:inline-flex">
          <UserRound className="h-4 w-4" aria-hidden />
          {accountLabel}
        </Link>
        <Link
          href="/checkout"
          className="relative inline-flex h-11 items-center gap-2 rounded-full border-2 border-ink bg-besar px-4 text-sm font-bold shadow-sticker-sm transition hover:-translate-y-0.5"
          aria-label={`${labels.cart}: ${ready ? count : 0}`}
        >
          <ShoppingBag className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{labels.cart}</span>
          {ready && count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-sindoor px-1 text-[11px] text-white">{count}</span>}
        </Link>
        <button className="rounded-full p-2 hover:bg-ink/5 xl:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? labels.close : labels.open} aria-expanded={open} aria-controls="mobile-nav">
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>
      {open && (
        <div id="mobile-nav" className="absolute inset-x-0 top-full z-40 border-b-2 border-ink bg-paper-card shadow-card xl:hidden">
          <nav className={cn("container flex flex-col py-3", locale === "ne" && "lang-ne")} aria-label="Mobile">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="border-b border-ink-line/60 py-3 font-display text-lg font-bold">
                {l.label}
              </Link>
            ))}
            {user?.teamAdmin && (
              <Link href="/team" className="border-b border-ink-line/60 py-3 font-semibold">
                {labels.team}
              </Link>
            )}
            <Link href={accountHref} className="py-3 font-semibold text-sindoor">
              {accountLabel}
            </Link>
            <LangSwitch locale={locale} label={labels.language} className="-ml-3 pb-2 md:hidden" />
          </nav>
        </div>
      )}
    </div>
  );
}
