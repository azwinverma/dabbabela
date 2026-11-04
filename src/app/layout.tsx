import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, DM_Sans, Permanent_Marker, Noto_Sans_Devanagari } from "next/font/google";
import { getLocale } from "@/lib/i18n/server";
import { RoughFilter } from "@/components/art/Graffiti";
import { getSettings } from "@/lib/settings";
import "./globals.css";

export const dynamic = "force-dynamic";

// Licensed under the SIL Open Font License (see brand/BRAND_GUIDELINES.md §Typography).
const display = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--font-display", display: "swap" });
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const marker = Permanent_Marker({ subsets: ["latin"], weight: "400", variable: "--font-marker", display: "swap" }); // graffiti accents only
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari", "latin"], weight: ["400", "600", "700"], variable: "--font-deva", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const base = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return {
    metadataBase: new URL(base),
    title: { default: s.seoTitle, template: `%s · ${s.brandName}` },
    description: s.seoDescription,
    openGraph: {
      title: s.seoTitle,
      description: s.seoDescription,
      siteName: s.brandName,
      locale: "en_NP",
      alternateLocale: ["ne_NP"],
      type: "website",
      ...(s.ogImage ? { images: [s.ogImage] } : {}),
    },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = { themeColor: "#8B2923", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale === "ne" ? "ne" : "en"} className={`${display.variable} ${body.variable} ${marker.variable} ${deva.variable}`}>
      <body>
        <RoughFilter />
        {children}
      </body>
    </html>
  );
}
