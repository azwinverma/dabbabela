import { Tabs } from "@/components/admin/ui";

export function InvTabs({ current, qs = "" }: { current: string; qs?: string }) {
  const q = qs ? `?${qs}` : "";
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "stock", label: "Stock", href: `/admin/inventory${q}` },
        { key: "ingredients", label: "Ingredients", href: `/admin/inventory/ingredients${q}` },
        { key: "movements", label: "Movements", href: `/admin/inventory/movements${q}` },
        { key: "purchases", label: "Purchase orders", href: `/admin/inventory/purchases${q}` },
        { key: "suppliers", label: "Suppliers", href: "/admin/inventory/suppliers" },
        { key: "variance", label: "Usage variance", href: `/admin/inventory/variance${q}` },
      ]}
    />
  );
}
