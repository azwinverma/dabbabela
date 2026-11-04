import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3100").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/account", "/checkout", "/pay", "/thank-you", "/setup", "/api", "/team", "/rider", "/corporate/sample-menu"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
