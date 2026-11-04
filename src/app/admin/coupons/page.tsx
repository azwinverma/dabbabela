import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { rs } from "@/lib/money";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { toggleCoupon } from "./actions";

export default async function CouponsPage() {
  await requirePermission("pricing.view");
  const coupons = await db.coupon.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }], include: { redemptions: { select: { amount: true } } } });
  const now = new Date();
  return (
    <>
      <PageHeader title="Coupons" description="Usage limits are enforced with a guarded counter, so a code can't be over-used by simultaneous checkouts." actions={<Link href="/admin/coupons/new" className={buttonClass("primary", "sm")}>New coupon</Link>} />
      <Table>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Discount</Th>
            <Th>Applies to</Th>
            <Th>Window</Th>
            <Th className="text-right">Used</Th>
            <Th className="text-right">Given away</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {coupons.length === 0 && <EmptyRow colSpan={7}>No coupons.</EmptyRow>}
          {coupons.map((c) => {
            const expired = c.endsAt && c.endsAt < now;
            return (
              <tr key={c.id} className={c.isActive && !expired ? "" : "opacity-60"}>
                <Td>
                  <Link href={`/admin/coupons/${c.id}`} className="font-mono font-bold hover:text-sindoor">
                    {c.code}
                  </Link>
                  <div className="text-xs text-ink-mute">{c.description}</div>
                </Td>
                <Td className="text-sm">
                  {c.type === "PERCENT" ? `${c.value}%` : rs(c.value)}
                  {c.maxDiscount != null && <span className="text-xs text-ink-mute"> (max {rs(c.maxDiscount)})</span>}
                  {c.firstOrderOnly && <Badge className="ml-1.5">first order</Badge>}
                </Td>
                <Td className="text-xs">
                  {c.scope.toLowerCase()} {c.minSubtotal ? `· min ${rs(c.minSubtotal)}` : ""}
                </Td>
                <Td className="text-xs text-ink-mute">
                  {c.startsAt ? formatStamp(c.startsAt) : "now"} → {c.endsAt ? formatStamp(c.endsAt) : "no end"}
                  {expired && <Badge tone="neutral" className="ml-1">expired</Badge>}
                </Td>
                <Td className="text-right tabular-nums">
                  {c.usedCount}
                  {c.usageLimit != null && ` / ${c.usageLimit}`}
                </Td>
                <Td className="text-right tabular-nums">{rs(c.redemptions.reduce((a, r) => a + r.amount, 0))}</Td>
                <Td className="text-right">
                  <ConfirmAction action={toggleCoupon.bind(null, c.id)} label={c.isActive ? "Disable" : "Enable"} variant="ghost" />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
