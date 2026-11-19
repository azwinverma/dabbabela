import { Tabs } from "@/components/admin/ui";

export function CampaignTabs({ current }: { current: "campaigns" | "referrals" }) {
  return (
    <Tabs
      current={current}
      tabs={[
        { key: "campaigns", label: "Campaigns", href: "/admin/campaigns" },
        { key: "referrals", label: "Referrals", href: "/admin/campaigns/referrals" },
      ]}
    />
  );
}
