import { Tabs } from "@/components/admin/ui";

/** Inventory section tabs (WP-08). `qs` carries the selected kitchen between tabs. */
export function InventoryTabs({ current, qs = "" }: { current: string; qs?: string }) {
  const q = qs ? `?${qs}` : "";
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "stock", label: "Stock", href: `/admin/inventory${q}` },
        { key: "health", label: "Stock health", href: `/admin/inventory/health${q}` },
        { key: "lots", label: "Lots & expiry", href: `/admin/inventory/lots${q}` },
        { key: "ingredients", label: "Ingredients", href: `/admin/inventory/ingredients${q}` },
        { key: "movements", label: "Movements", href: `/admin/inventory/movements${q}` },
        { key: "purchases", label: "Purchase orders", href: `/admin/inventory/purchases${q}` },
        { key: "transfers", label: "Transfers", href: `/admin/inventory/transfers${q}` },
        { key: "locations", label: "Locations", href: `/admin/inventory/locations${q}` },
        { key: "scale", label: "Recipe scaling", href: `/admin/inventory/scale${q}` },
        { key: "suppliers", label: "Suppliers", href: `/admin/inventory/suppliers${q}` },
        { key: "variance", label: "Usage variance", href: `/admin/inventory/variance${q}` },
      ]}
    />
  );
}
