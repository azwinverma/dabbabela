import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { LogoMark } from "@/components/brand/Logo";

export const metadata: Metadata = { title: "Rider", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#27221D", width: "device-width", initialScale: 1 };

export default async function RiderLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePermission("rider.view");
  return (
    <div className="min-h-dvh bg-paper">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-ink px-4 py-3 text-paper">
        <Link href="/rider" className="flex items-center gap-2 font-display font-extrabold">
          <LogoMark className="h-8 w-8" /> Rider
        </Link>
        <span className="text-sm text-paper/80">{user.name}</span>
      </header>
      <main className="mx-auto max-w-lg px-4 py-5">{children}</main>
    </div>
  );
}
