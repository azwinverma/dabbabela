"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AccountDict } from "@/lib/i18n/account";
import { cn } from "@/lib/utils";

export function AccountNav({ labels, unread }: { labels: AccountDict["nav"]; unread: number }) {
  const path = usePathname();
  const tabs = [
    { href: "/account", label: labels.overview },
    { href: "/account/orders", label: labels.orders },
    { href: "/account/plans", label: labels.plans },
    { href: "/account/boxes", label: labels.boxes },
    { href: "/account/addresses", label: labels.addresses },
    { href: "/account/wallet", label: labels.wallet },
    { href: "/account/notifications", label: labels.notifications, badge: unread },
    { href: "/account/support", label: labels.support },
    { href: "/account/profile", label: labels.profile },
    { href: "/account/security", label: labels.security },
    { href: "/account/privacy", label: labels.privacy },
  ];
  return (
    <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none" aria-label="Account">
      {tabs.map((t) => {
        const active = t.href === "/account" ? path === "/account" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-ink px-4 py-1.5 text-sm font-bold", active ? "bg-ink text-paper" : "bg-paper-card hover:bg-besar-light")}
          >
            {t.label}
            {t.badge ? <span className="rounded-full bg-sindoor px-1.5 text-[11px] text-white">{t.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
