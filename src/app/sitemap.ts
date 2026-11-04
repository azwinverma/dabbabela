import type { MetadataRoute } from "next";
import { db } from "@/lib/db";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3100").replace(/\/$/, "");
  const fixed = ["", "/menu", "/build", "/plans", "/corporate", "/delivery-areas", "/about", "/contact", "/faq", "/journal"].map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly" as const, priority: p ? 0.7 : 1 }));
  try {
    const [boxes, posts, pages, plans] = await Promise.all([
      db.lunchBox.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
      db.post.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
      db.page.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
      db.mealPlan.findMany({ where: { isActive: true, isCorporate: false }, select: { slug: true, updatedAt: true } }),
    ]);
    return [
      ...fixed,
      ...boxes.map((b) => ({ url: `${base}/boxes/${b.slug}`, lastModified: b.updatedAt })),
      ...plans.map((p) => ({ url: `${base}/plans/${p.slug}`, lastModified: p.updatedAt })),
      ...posts.map((p) => ({ url: `${base}/journal/${p.slug}`, lastModified: p.updatedAt })),
      ...pages.map((p) => ({ url: `${base}/info/${p.slug}`, lastModified: p.updatedAt })),
    ];
  } catch {
    return fixed;
  }
}

export const revalidate = 3600;
