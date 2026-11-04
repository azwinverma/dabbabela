import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";

export default async function BannersPage() {
  await requirePermission("marketing.view");
  const banners = await db.banner.findMany({ orderBy: [{ isActive: "desc" }, { placement: "asc" }, { sortOrder: "asc" }] });
  const now = new Date();
  const state = (b: (typeof banners)[number]) => (!b.isActive ? ["off", "neutral"] : b.startsAt && b.startsAt > now ? ["scheduled", "info"] : b.endsAt && b.endsAt < now ? ["ended", "neutral"] : ["live", "good"]) as [string, "neutral" | "info" | "good"];
  return (
    <>
      <PageHeader title="Banners & promos" description="Short messages on the site, scheduled in Kathmandu time. Keep offers truthful and give an end date." actions={<Link href="/admin/banners/new" className={buttonClass("primary", "sm")}>New banner</Link>} />
      <Table>
        <thead>
          <tr>
            <Th>Message</Th>
            <Th>Where</Th>
            <Th>Schedule</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {banners.length === 0 && <EmptyRow colSpan={4}>No banners.</EmptyRow>}
          {banners.map((b) => {
            const [label, tone] = state(b);
            return (
              <tr key={b.id}>
                <Td>
                  <Link href={`/admin/banners/${b.id}`} className="font-semibold hover:text-sindoor">
                    {b.text}
                  </Link>
                  {b.textNe && <div className="lang-ne text-xs text-ink-mute">{b.textNe}</div>}
                </Td>
                <Td className="text-xs">{b.placement.toLowerCase()}</Td>
                <Td className="text-xs text-ink-mute">
                  {b.startsAt ? formatStamp(b.startsAt) : "now"} → {b.endsAt ? formatStamp(b.endsAt) : "no end"}
                </Td>
                <Td>
                  <Badge tone={tone}>{label}</Badge>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
