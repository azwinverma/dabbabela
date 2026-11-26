import { apiRoute } from "@/server/api/route";
import { activeCompany } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { builderGroups, DIET_RULES, isDietRule } from "@/server/builder";
import { defaultKitchenId } from "@/server/orders";
import { memberCompanyMenu } from "@/server/corporate";

export const dynamic = "force-dynamic";

/**
 * Build-a-Dabba catalogue (same data as the website /build page): steps (groups) with min/max picks and diet rules,
 * and their options (dish, price in paisa, portions, diet, allergen codes). Options switched off at the default
 * kitchen are left out. A signed-in member of a company that bills its own menu gets `companyBuildBlocked` — they
 * can build and save, but a built dabba can't go on a company-billed order.
 */
export const GET = apiRoute({ auth: "optional", limit: "read" }, async ({ user }) => {
  const [settings, kitchenId] = await Promise.all([getSettings(), defaultKitchenId()]);
  const [groups, companyMenu] = await Promise.all([builderGroups({ kitchenId }), memberCompanyMenu(user ? activeCompany(user) : null)]);
  return {
    minPrice: settings.builderMinPrice,
    maxQtyPerDish: settings.builderMaxQty,
    companyBuildBlocked: companyMenu?.buildBlocked ? { companyName: companyMenu.companyName } : null,
    groups: groups
      .filter((g) => g.options.length)
      .map((g) => {
        const rule = isDietRule(g.dietRule) ? DIET_RULES[g.dietRule] : null;
        return {
          id: g.id,
          key: g.key,
          name: g.name,
          nameNe: g.nameNe,
          category: g.category,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          dietRule: rule ? { code: g.dietRule, level: rule.level, scope: rule.scope, label: rule.label } : null,
          options: g.options.map((o) => ({
            menuItemId: o.menuItem.id,
            name: o.menuItem.name,
            nameNe: o.menuItem.nameNe,
            description: o.menuItem.description,
            descriptionNe: o.menuItem.descriptionNe,
            price: o.priceOverride ?? o.menuItem.price,
            diet: o.menuItem.diet,
            spiceLevel: o.menuItem.spiceLevel,
            portionLabel: o.menuItem.portionLabel,
            image: o.menuItem.image,
            isDefault: o.isDefault,
            allergens: o.menuItem.allergens.map((a) => a.allergen.code),
            portions: o.portions.map((p) => ({ id: p.id, label: p.label, labelNe: p.labelNe, priceDelta: p.priceDelta })),
          })),
        };
      }),
  };
});
