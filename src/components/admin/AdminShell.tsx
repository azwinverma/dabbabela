"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Icons from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import type { NavGroup } from "./nav";

function Icon({ name, className }: { name: string; className?: string }) {
  const C = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name] ?? Icons.Circle;
  return <C className={className} />;
}

export function AdminShell({
  nav,
  user,
  badges,
  children,
  roleLabel,
  kitchen,
  twoFactor,
  logoutAction,
}: {
  nav: NavGroup[];
  user: { name: string; role: string; email: string };
  badges: Record<string, number>;
  children: React.ReactNode;
  roleLabel?: string;
  /** Kitchen the staff member is scoped to (null/undefined = all kitchens). */
  kitchen?: string | null;
  twoFactor?: boolean;
  logoutAction?: () => Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));

  const sidebar = (
    <nav className="flex h-full flex-col">
      <Link href="/admin" className="flex items-center gap-2 px-5 py-5">
        <LogoMark className="h-9 w-9" />
        <span className="leading-none">
          <span className="block font-display text-lg font-extrabold tracking-tight text-paper">
            Dabba <span className="text-besar">Bela</span>
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-paper/50">Control room</span>
        </span>
      </Link>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 scrollbar-none">
        {nav.map((g) => (
          <div key={g.title}>
            <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-paper/40">{g.title}</p>
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                      active(it.href) ? "bg-besar text-ink" : "text-paper/75 hover:bg-white/5 hover:text-paper",
                    )}
                  >
                    <Icon name={it.icon} className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{it.label}</span>
                    {badges[it.href] ? (
                      <span className={cn("rounded-full px-1.5 text-[10px] font-bold", active(it.href) ? "bg-ink text-besar" : "bg-sindoor text-white")}>
                        {badges[it.href]}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 p-4">
        <p className="truncate text-sm font-semibold text-paper">{user.name}</p>
        <p className="truncate text-xs text-paper/50">{roleLabel ?? user.role}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-paper/70">{kitchen ? `Kitchen: ${kitchen}` : "All kitchens"}</span>
          {twoFactor !== undefined && (
            <Link href="/account/security" className={cn("rounded px-1.5 py-0.5", twoFactor ? "bg-saag/40 text-paper" : "bg-sindoor text-white")}>
              {twoFactor ? "2FA on" : "2FA off — set up"}
            </Link>
          )}
        </div>
        <div className="mt-3 flex gap-2 text-xs">
          <Link href="/" className="rounded-md border border-white/15 px-2 py-1 text-paper/70 hover:text-paper">
            View site
          </Link>
          {logoutAction ? (
            <form action={logoutAction}>
              <button className="rounded-md border border-white/15 px-2 py-1 text-paper/70 hover:text-paper">Log out</button>
            </form>
          ) : (
            <Link href="/account" className="rounded-md border border-white/15 px-2 py-1 text-paper/70 hover:text-paper">
              Account
            </Link>
          )}
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#F3EADB]">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-besar focus:px-3 focus:py-2 focus:text-sm focus:font-semibold">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-ink lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-ink" aria-label="Control room navigation">
            {sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-ink-line/70 bg-[#F3EADB]/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="rounded-md p-1.5 hover:bg-ink/5">
            <Icons.Menu className="h-5 w-5" />
          </button>
          <LogoMark className="h-7 w-7" />
          <span className="font-display font-extrabold">
            Dabba <span className="text-sindoor">Bela</span>
          </span>
        </header>
        <main id="admin-main" className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
