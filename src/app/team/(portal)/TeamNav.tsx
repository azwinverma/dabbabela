"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  ["/team", "Overview"],
  ["/team/roster", "People"],
  ["/team/invites", "Invite & import"],
  ["/team/order", "Order for the team"],
  ["/team/reports", "Reports"],
  ["/team/invoices", "Invoices"],
  ["/team/calendar", "Calendar"],
] as const;

export function TeamNav() {
  const path = usePathname();
  return (
    <nav aria-label="Team portal" className="container flex gap-1 overflow-x-auto scrollbar-none">
      {ITEMS.map(([href, label]) => {
        const on = href === "/team" ? path === "/team" : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", on ? "border-sindoor text-ink" : "border-transparent text-ink-mute hover:text-ink")}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
