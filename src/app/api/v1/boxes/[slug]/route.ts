import { apiRoute } from "@/server/api/route";
import { notFound } from "@/server/api/http";
import { db } from "@/lib/db";
import { activeCompany } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { datesForBox, toPublicBox } from "@/lib/public";
import { boxInclude } from "@/server/menu";
import { memberCompanyMenu } from "@/server/corporate";

export const dynamic = "force-dynamic";

/**
 * One dabba (by slug or id, like /boxes/[slug]): contents, diet, allergens, nutrition, substitutions, and the dates it
 * can still be ordered (empty for a company member when it's off their company menu). Hidden dabbas → 404.
 * `allergyHits` lists the caller's own allergies it contains (signed-in only).
 */
export const GET = apiRoute<"optional", { slug: string }>({ auth: "optional", limit: "read" }, async ({ req, user, params }) => {
  const raw = await db.lunchBox.findFirst({ where: { OR: [{ slug: params.slug }, { id: params.slug }], isActive: true, isVisible: true }, include: boxInclude });
  if (!raw) throw notFound("Dabba not found");
  const ql = new URL(req.url).searchParams.get("locale");
  const locale = isLocale(ql) ? ql : user && isLocale(user.locale) ? user.locale : "en";
  const box = toPublicBox(raw, locale);
  const [dates, companyMenu] = await Promise.all([datesForBox(raw.id), memberCompanyMenu(activeCompany(user))]);
  const offCompanyMenu = Boolean(companyMenu && !companyMenu.allowed.has(raw.id));
  return {
    box,
    offCompanyMenu,
    dates: offCompanyMenu ? [] : dates.map((d) => ({ date: d.value, label: d.label, price: d.price, soldOut: d.soldOut, remaining: d.remaining })),
    allergyHits: user ? box.allergens.filter((a) => user.allergies.includes(a.code)).map((a) => a.code) : [],
  };
});
