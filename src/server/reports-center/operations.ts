import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ktmNow } from "@/lib/dates";
import { dayRange, stampRange, type AnalyticsFilters } from "@/server/analytics/filters";
import { METRICS } from "@/server/analytics/metrics";
import { stockValuation } from "@/server/inventory";
import { dishCostPerPortion, kitchenPerformance } from "@/server/kitchen";
import { deliveryPerformance } from "@/server/dispatch";
import { payablesAgeing } from "@/server/finance/payables";
import { wasteRate } from "@/server/reports";
import { pageOf, totalsOf, windowOf } from "./common";
import type { ReportDef, Row } from "./types";

const kitchenSql = (f: AnalyticsFilters, col: Prisma.Sql) => (f.kitchenIds ? (f.kitchenIds.length ? Prisma.sql`AND ${col} = ANY(${f.kitchenIds})` : Prisma.sql`AND FALSE`) : Prisma.empty);
const kitchenWhere = (f: AnalyticsFilters) => (f.kitchenIds ? { kitchenId: { in: f.kitchenIds } } : {});

// ───────────── recipe costing ─────────────

export const recipeCosting: ReportDef = {
  key: "recipe-costing",
  title: "Recipe costing",
  group: "Menu & costing",
  description: "Cost per portion of every active dish's current recipe against its Build-a-Dabba price.",
  definition:
    "Live cost = current recipe version's ingredients scaled to one portion (incl. trim waste %) × each ingredient's current cost (same calculation as kitchen performance). Saved cost = the cost stored when the version was saved. Food cost % = live cost ÷ dish price. Dishes without a recipe fall back to their manual cost price.",
  view: ["recipes.view"],
  exportPerms: [],
  filters: [],
  snapshot: true,
  columns: [
    { key: "dish", label: "Dish" },
    { key: "category", label: "Category" },
    { key: "diet", label: "Diet" },
    { key: "version", label: "Recipe version" },
    { key: "yield", label: "Yield (portions)", kind: "int" },
    { key: "live", label: "Cost / portion (live)", kind: "money" },
    { key: "saved", label: "Cost / portion (saved)", kind: "money" },
    { key: "price", label: "Price", kind: "money" },
    { key: "foodCostPct", label: "Food cost %", kind: "pct" },
  ],
  async run(_ctx, paging) {
    const where: Prisma.MenuItemWhereInput = { isActive: true };
    const [count, withRecipe, items] = await Promise.all([
      db.menuItem.count({ where }),
      db.menuItem.count({ where: { ...where, recipe: { currentVersionId: { not: null } } } }),
      db.menuItem.findMany({
        where,
        orderBy: [{ category: "asc" }, { name: "asc" }],
        ...windowOf(paging),
        select: { id: true, name: true, category: true, diet: true, price: true, costPrice: true, recipe: { select: { currentVersion: { select: { version: true, yieldPortions: true, costPerPortion: true } } } } },
      }),
    ]);
    const live = await dishCostPerPortion(items.map((i) => i.id));
    const rows: Row[] = items.map((i) => {
      const v = i.recipe?.currentVersion ?? null;
      const cost = live.has(i.id) ? Math.round(live.get(i.id)!) : v ? null : i.costPrice || null;
      return {
        dish: i.name,
        category: i.category,
        diet: i.diet,
        version: v ? `v${v.version}` : "No recipe",
        yield: v?.yieldPortions ?? null,
        live: cost,
        saved: v?.costPerPortion ?? null,
        price: i.price,
        foodCostPct: cost != null && i.price ? cost / i.price : null,
      };
    });
    return {
      rows,
      count,
      summary: [
        { label: "Active dishes", value: count, kind: "int" },
        { label: "With a costed recipe", value: withRecipe, kind: "int" },
        { label: "Without a recipe", value: count - withRecipe, kind: "int" },
      ],
    };
  },
};

// ───────────── ingredient consumption ─────────────

export const ingredientConsumption: ReportDef = {
  key: "ingredient-consumption",
  title: "Ingredient consumption",
  group: "Kitchen & stock",
  description: "Stock used and wasted per ingredient and kitchen, with cost.",
  definition:
    "Stock ledger Usage + Waste movements created in the range (Kathmandu days). Cost = |quantity| × the movement's unit cost (lot cost), else the ingredient's current cost, rounded per movement — the same figure as Analytics → Food cost (actual).",
  view: ["inventory.view"],
  exportPerms: ["inventory.export"],
  filters: ["range", "kitchen"],
  columns: [
    { key: "ingredient", label: "Ingredient" },
    { key: "kitchen", label: "Kitchen" },
    { key: "unit", label: "Unit" },
    { key: "used", label: "Used", kind: "num" },
    { key: "wasted", label: "Wasted", kind: "num" },
    { key: "usageCost", label: "Usage cost", kind: "money" },
    { key: "wasteCost", label: "Waste cost", kind: "money" },
    { key: "cost", label: "Total cost", kind: "money" },
  ],
  async run({ f }, paging) {
    const st = stampRange(f.from, f.to);
    const rows = await db.$queryRaw<{ ingredient: string; kitchen: string; unit: string; used: number; wasted: number; uc: Prisma.Decimal | number; wc: Prisma.Decimal | number }[]>`
      SELECT i.name AS ingredient, k.name AS kitchen, i.unit::text AS unit,
        SUM(CASE WHEN m.type = 'USAGE' THEN ABS(m.quantity) ELSE 0 END) AS used,
        SUM(CASE WHEN m.type = 'WASTE' THEN ABS(m.quantity) ELSE 0 END) AS wasted,
        SUM(CASE WHEN m.type = 'USAGE' THEN ROUND((ABS(m.quantity) * COALESCE(m."unitCost", i."costPerUnit"))::numeric) ELSE 0 END) AS uc,
        SUM(CASE WHEN m.type = 'WASTE' THEN ROUND((ABS(m.quantity) * COALESCE(m."unitCost", i."costPerUnit"))::numeric) ELSE 0 END) AS wc
      FROM "StockMovement" m JOIN "Ingredient" i ON i.id = m."ingredientId" JOIN "Kitchen" k ON k.id = m."kitchenId"
      WHERE m.type::text IN ('USAGE', 'WASTE') AND m."createdAt" >= ${st.gte} AND m."createdAt" < ${st.lt} ${kitchenSql(f, Prisma.sql`m."kitchenId"`)}
      GROUP BY i.name, k.name, i.unit`;
    const all = rows
      .map((r) => {
        const usageCost = Number(r.uc);
        const wasteCost = Number(r.wc);
        return { ingredient: r.ingredient, kitchen: r.kitchen, unit: r.unit, used: Math.round(Number(r.used) * 1000) / 1000, wasted: Math.round(Number(r.wasted) * 1000) / 1000, usageCost, wasteCost, cost: usageCost + wasteCost };
      })
      .sort((a, b) => b.cost - a.cost || a.ingredient.localeCompare(b.ingredient));
    return {
      rows: pageOf(all, paging),
      count: all.length,
      totals: totalsOf(all, ["usageCost", "wasteCost", "cost"], { ingredient: "Total" }),
      summary: [{ label: METRICS.foodCostActual.label, value: all.reduce((a, r) => a + r.cost, 0), kind: "money", note: METRICS.foodCostActual.definition }],
    };
  },
};

// ───────────── inventory valuation ─────────────

export const inventoryValuation: ReportDef = {
  key: "inventory-valuation",
  title: "Inventory valuation",
  group: "Kitchen & stock",
  description: "Value of stock on hand right now, per ingredient and kitchen (lot cost).",
  definition:
    "inventory.stockValuation: Σ lot remaining quantity × lot unit cost, plus unlotted stock (on hand − lots, never below 0) at the ingredient's latest cost. Negative on-hand (recorded shortages) is valued at 0. Snapshot now; the date range doesn't apply.",
  view: ["inventory.view"],
  exportPerms: ["inventory.export"],
  filters: ["kitchen"],
  snapshot: true,
  columns: [
    { key: "ingredient", label: "Ingredient" },
    { key: "kitchen", label: "Kitchen" },
    { key: "unit", label: "Unit" },
    { key: "onHand", label: "On hand", kind: "num" },
    { key: "lotQty", label: "In lots", kind: "num" },
    { key: "lotValue", label: "Lot value", kind: "money" },
    { key: "unlottedQty", label: "Unlotted", kind: "num" },
    { key: "unlottedValue", label: "Unlotted value", kind: "money" },
    { key: "value", label: "Value", kind: "money" },
  ],
  async run({ f }, paging) {
    const v = await stockValuation(f.kitchenIds);
    const [ings, kitchens] = await Promise.all([
      db.ingredient.findMany({ where: { id: { in: [...new Set(v.rows.map((r) => r.ingredientId))] } }, select: { id: true, name: true, unit: true } }),
      db.kitchen.findMany({ where: { id: { in: [...new Set(v.rows.map((r) => r.kitchenId))] } }, select: { id: true, name: true } }),
    ]);
    const ing = new Map(ings.map((i) => [i.id, i]));
    const kit = new Map(kitchens.map((k) => [k.id, k.name]));
    const all = v.rows
      .filter((r) => r.value !== 0 || r.onHand !== 0)
      .map((r) => ({ ingredient: ing.get(r.ingredientId)?.name ?? "—", kitchen: kit.get(r.kitchenId) ?? "—", unit: ing.get(r.ingredientId)?.unit ?? "", onHand: r.onHand, lotQty: r.lotQty, lotValue: r.lotValue, unlottedQty: r.unlottedQty, unlottedValue: r.unlottedValue, value: r.value }))
      .sort((a, b) => b.value - a.value || a.ingredient.localeCompare(b.ingredient));
    return { rows: pageOf(all, paging), count: all.length, totals: { ingredient: "Total", lotValue: all.reduce((a, r) => a + r.lotValue, 0), unlottedValue: all.reduce((a, r) => a + r.unlottedValue, 0), value: v.total } };
  },
};

// ───────────── stock wastage ─────────────

export const stockWastage: ReportDef = {
  key: "stock-wastage",
  title: "Stock wastage",
  group: "Kitchen & stock",
  description: "Every waste movement on the stock ledger, plus cooked-portion waste from production batches.",
  definition:
    "Waste movements created in the range (Kathmandu days); cost = |quantity| × lot unit cost (else current ingredient cost), rounded per movement — the waste part of Food cost (actual). Batch waste = Σ waste portions ÷ Σ cooked portions on batches completed in the range.",
  view: ["inventory.view"],
  exportPerms: ["inventory.export"],
  filters: ["range", "kitchen"],
  columns: [
    { key: "when", label: "When" },
    { key: "kitchen", label: "Kitchen" },
    { key: "ingredient", label: "Ingredient" },
    { key: "quantity", label: "Quantity", kind: "num" },
    { key: "unit", label: "Unit" },
    { key: "cost", label: "Cost", kind: "money" },
    { key: "reference", label: "Reference" },
    { key: "note", label: "Note" },
  ],
  async run({ f }, paging) {
    const st = stampRange(f.from, f.to);
    const where: Prisma.StockMovementWhereInput = { type: "WASTE", createdAt: st, ...kitchenWhere(f) };
    const [count, sum, list, batches] = await Promise.all([
      db.stockMovement.count({ where }),
      db.$queryRaw<{ c: Prisma.Decimal | number | null }[]>`
        SELECT SUM(ROUND((ABS(m.quantity) * COALESCE(m."unitCost", i."costPerUnit"))::numeric)) AS c
        FROM "StockMovement" m JOIN "Ingredient" i ON i.id = m."ingredientId"
        WHERE m.type::text = 'WASTE' AND m."createdAt" >= ${st.gte} AND m."createdAt" < ${st.lt} ${kitchenSql(f, Prisma.sql`m."kitchenId"`)}`,
      db.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...windowOf(paging),
        select: { createdAt: true, quantity: true, unitCost: true, reference: true, note: true, kitchen: { select: { name: true } }, ingredient: { select: { name: true, unit: true, costPerUnit: true } } },
      }),
      wasteRate({ from: f.from, to: f.to, kitchenIds: f.kitchenIds }),
    ]);
    const total = Number(sum[0]?.c ?? 0);
    return {
      rows: list.map((m) => ({
        when: `${ktmNow(m.createdAt).date} ${ktmNow(m.createdAt).time}`,
        kitchen: m.kitchen.name,
        ingredient: m.ingredient.name,
        quantity: Math.abs(m.quantity),
        unit: m.ingredient.unit,
        cost: Math.round(Math.abs(m.quantity) * (m.unitCost ?? m.ingredient.costPerUnit)),
        reference: m.reference ?? "",
        note: m.note ?? "",
      })),
      count,
      totals: { when: "Total", cost: total },
      summary: [
        { label: "Waste cost (stock)", value: total, kind: "money" },
        { label: "Portions cooked", value: batches.cooked, kind: "int" },
        { label: "Portions wasted", value: batches.waste, kind: "int" },
        { label: "Batch waste rate", value: batches.rate, kind: "pct", note: "Σ waste portions ÷ Σ cooked portions on production batches completed in the range." },
      ],
    };
  },
};

// ───────────── supplier purchases ─────────────

export const supplierPurchases: ReportDef = {
  key: "supplier-purchases",
  title: "Supplier purchases",
  group: "Kitchen & stock",
  description: "Per supplier: purchase orders raised, goods received, invoices and what is still owed.",
  definition:
    "POs created in the range for your kitchens (not cancelled): ordered = Σ quantity × unit cost; received = Σ received quantity × unit cost. Invoiced = supplier invoices dated in the range (not void). Outstanding = finance.payablesAgeing right now (all open supplier invoices, company-wide).",
  view: ["inventory.view", "purchasing.view"],
  exportPerms: ["inventory.export"],
  filters: ["range", "kitchen"],
  columns: [
    { key: "supplier", label: "Supplier" },
    { key: "pos", label: "POs", kind: "int" },
    { key: "ordered", label: "Ordered", kind: "money" },
    { key: "received", label: "Received", kind: "money" },
    { key: "invoices", label: "Invoices", kind: "int" },
    { key: "invoiced", label: "Invoiced", kind: "money" },
    { key: "outstanding", label: "Outstanding now", kind: "money" },
  ],
  async run({ f, today }, paging) {
    const st = stampRange(f.from, f.to);
    const [pos, invoices, ageing] = await Promise.all([
      db.purchaseOrder.findMany({ where: { createdAt: st, status: { not: "CANCELLED" }, ...kitchenWhere(f) }, select: { supplierId: true, supplier: { select: { name: true } }, lines: { select: { quantity: true, receivedQty: true, unitCost: true } } } }),
      db.supplierInvoice.findMany({ where: { date: dayRange(f.from, f.to), status: { not: "VOID" } }, select: { supplierId: true, total: true, supplier: { select: { name: true } } } }),
      payablesAgeing(today),
    ]);
    const by = new Map<string, Row & { supplier: string; pos: number; ordered: number; received: number; invoices: number; invoiced: number; outstanding: number }>();
    const get = (id: string, name: string) => by.get(id) ?? (by.set(id, { supplier: name, pos: 0, ordered: 0, received: 0, invoices: 0, invoiced: 0, outstanding: 0 }), by.get(id)!);
    for (const p of pos) {
      const r = get(p.supplierId, p.supplier.name);
      r.pos++;
      r.ordered += p.lines.reduce((a, l) => a + Math.round(l.quantity * l.unitCost), 0);
      r.received += p.lines.reduce((a, l) => a + Math.round(l.receivedQty * l.unitCost), 0);
    }
    for (const i of invoices) {
      const r = get(i.supplierId, i.supplier.name);
      r.invoices++;
      r.invoiced += i.total;
    }
    for (const s of ageing.suppliers) get(s.supplierId, s.name).outstanding += s.total;
    const all = [...by.values()].sort((a, b) => b.ordered - a.ordered || b.outstanding - a.outstanding || a.supplier.localeCompare(b.supplier));
    return {
      rows: pageOf(all, paging),
      count: all.length,
      totals: { ...totalsOf(all, ["pos", "ordered", "received", "invoices", "invoiced"], { supplier: "Total" }), outstanding: ageing.total },
      notes: f.kitchenIds ? ["Supplier invoices and outstanding balances aren't tagged to a kitchen, so they show company-wide."] : undefined,
    };
  },
};

// ───────────── kitchen production ─────────────

export const kitchenProduction: ReportDef = {
  key: "kitchen-production",
  title: "Kitchen production",
  group: "Kitchen & stock",
  description: "Per kitchen: meals produced, batch waste, on-time packing, QC and cost per meal.",
  definition:
    "kitchen.kitchenPerformance per kitchen (delivery dates in the range): meals = Σ quantity on orders Scheduled → Delivered; on-time packing = first Packed event at or before the slot start; QC pass % from QC logs; waste % = waste cost ÷ (usage + waste) cost on the stock ledger; recipe cost per meal = current recipe cost of the dishes ordered ÷ meals; actual = ledger cost ÷ meals; operating costs = approved/paid expenses tagged to the kitchen.",
  view: ["kitchen.view"],
  exportPerms: [],
  filters: ["range", "kitchen"],
  columns: [
    { key: "kitchen", label: "Kitchen" },
    { key: "orders", label: "Orders", kind: "int" },
    { key: "meals", label: "Meals", kind: "int" },
    { key: "cooked", label: "Portions cooked", kind: "int" },
    { key: "wasted", label: "Portions wasted", kind: "int" },
    { key: "onTimePacking", label: "On-time packing", kind: "pct" },
    { key: "qcPass", label: "QC pass", kind: "pct" },
    { key: "wasteCostPct", label: "Waste % (cost)", kind: "pct" },
    { key: "recipeCostPerMeal", label: "Recipe cost / meal", kind: "money" },
    { key: "actualCostPerMeal", label: "Actual cost / meal", kind: "money" },
    { key: "opex", label: "Operating costs", kind: "money" },
  ],
  async run({ f }, paging) {
    const kitchens = await db.kitchen.findMany({ where: { isActive: true, ...(f.kitchenIds ? { id: { in: f.kitchenIds } } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
    const page = pageOf(kitchens, paging);
    const perf = await Promise.all(page.map((k) => kitchenPerformance(k.id, f.from, f.to)));
    const rows = page.map((k, i) => {
      const p = perf[i];
      const pctOf = (v: number | null) => (v == null ? null : v / 100);
      return {
        kitchen: k.name,
        orders: p.orders,
        meals: p.meals,
        cooked: p.waste.cookedPortions,
        wasted: p.waste.wastedPortions,
        onTimePacking: pctOf(p.onTimePacking.pct),
        qcPass: pctOf(p.qc.passPct),
        wasteCostPct: pctOf(p.waste.costPct),
        recipeCostPerMeal: p.costPerMeal.recipe,
        actualCostPerMeal: p.costPerMeal.actual,
        opex: p.operatingCosts.total,
      };
    });
    return { rows, count: kitchens.length, totals: totalsOf(rows, ["orders", "meals", "cooked", "wasted", "opex"], { kitchen: kitchens.length > page.length ? "Total (this page)" : "Total" }) };
  },
};

// ───────────── delivery performance ─────────────

export const deliveryPerformanceReport: ReportDef = {
  key: "delivery-performance",
  title: "Delivery performance",
  group: "Delivery",
  description: "Per rider or zone: delivered, failed, on-time rate, deliveries per day, cash and route cost.",
  definition:
    "dispatch.deliveryPerformance (delivery events of orders with a delivery date in the range): on time = Delivered event at or before the slot end (Kathmandu); failed rate = failed ÷ (delivered + failed) attempts; deliveries/day = delivered ÷ days with a delivery; cash = Σ cash collected; route cost = Σ cost of routes dated in the range.",
  view: ["dispatch.view"],
  exportPerms: [],
  filters: ["range", "kitchen"],
  choices: [{ name: "by", label: "By", options: [{ value: "rider", label: "Rider" }, { value: "zone", label: "Zone" }] }],
  columns: [
    { key: "label", label: "Rider / zone" },
    { key: "delivered", label: "Delivered", kind: "int" },
    { key: "failed", label: "Failed", kind: "int" },
    { key: "failedRate", label: "Failed rate", kind: "pct" },
    { key: "withSlot", label: "With a slot", kind: "int" },
    { key: "onTime", label: "On time", kind: "int" },
    { key: "onTimeRate", label: "On-time rate", kind: "pct" },
    { key: "perDay", label: "Deliveries / day", kind: "num" },
    { key: "cash", label: "Cash collected", kind: "money" },
    { key: "routes", label: "Routes", kind: "int" },
    { key: "routeCost", label: "Route cost", kind: "money" },
  ],
  async run({ f, choice }, paging) {
    const r = await deliveryPerformance({ from: f.from, to: f.to, kitchenIds: f.kitchenIds });
    const list = (choice.by === "zone" ? r.zones : r.riders).map((x) => ({ ...x, perDay: x.perDay == null ? null : Math.round(x.perDay * 10) / 10 }));
    const { key: _k, ...total } = r.total;
    void _k;
    return {
      rows: pageOf(list, paging),
      count: list.length,
      totals: { ...total, label: "Total", perDay: total.perDay == null ? null : Math.round(total.perDay * 10) / 10 },
      summary: [
        { label: "Delivered", value: r.total.delivered, kind: "int" },
        { label: "On-time rate", value: r.total.onTimeRate, kind: "pct" },
        { label: "Failed rate", value: r.total.failedRate, kind: "pct" },
      ],
    };
  },
};
