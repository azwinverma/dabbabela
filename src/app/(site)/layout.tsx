import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { CartProvider } from "@/components/site/cart";
import { getSettings } from "@/lib/settings";
import { getLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [s, locale] = await Promise.all([getSettings(), getLocale()]);
  return (
    <CartProvider>
      <div className={cn("grain flex min-h-screen flex-col", locale === "ne" && "lang-ne")}>
        <Header />
        {s.maintenanceMode && (
          <div role="status" className="border-b-2 border-ink bg-besar py-2 text-center text-sm font-semibold">
            {s.maintenanceMessage}
          </div>
        )}
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
      </div>
    </CartProvider>
  );
}
