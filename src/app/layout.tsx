import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { getLocale } from "@/lib/i18n/server";
import { RoughFilter } from "@/components/art/Graffiti";
import { getSettings } from "@/lib/settings";
import "./globals.css";

export const dynamic = "force-dynamic";

// Fonts: SIL OFL 1.1 (Permanent Marker: Apache 2.0) — see brand/BRAND_GUIDELINES.md §Typography.
// Self-hosted (src/app/fonts) so the build never fetches from Google Fonts — see fonts/LICENSES.md.
const display = localFont({ src: "./fonts/plus-jakarta-sans-latin-wght-normal.woff2", weight: "200 800", variable: "--font-display", display: "swap" });
const body = localFont({ src: "./fonts/dm-sans-latin-wght-normal.woff2", weight: "100 1000", variable: "--font-body", display: "swap" });
const marker = localFont({ src: "./fonts/permanent-marker-latin-400-normal.woff2", weight: "400", variable: "--font-marker", display: "swap", preload: false }); // graffiti accents only
// Devanagari glyphs only; Latin characters fall through to --font-body (see tailwind `deva` + .lang-ne).
const deva = localFont({ src: "./fonts/noto-sans-devanagari-devanagari-wght-normal.woff2", weight: "100 900", variable: "--font-deva", display: "swap", preload: false, adjustFontFallback: false, fallback: [] });

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
