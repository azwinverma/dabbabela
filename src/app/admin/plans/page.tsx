import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { rs } from "@/lib/money";
import { isoDate } from "@/lib/dates";
import { PageHeader, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { togglePlan } from "./actions";

export default async function PlansPage() {
  await requirePermission("plans.view");
  const plans = await db.mealPlan.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { subscriptions: true } }, subscriptions: { where: { status: "ACTIVE" }, select: { id: true } } },
  });
  return (
    <>
      <PageHeader title="Plan catalogue" description="Plans count real service days — holidays and closures are left out automatically. Price per meal is what customers pay; compare-at is the regular dabba price used for honest savings." actions={<Link href="/admin/plans/new" className={buttonClass("primary", "sm")}>New plan</Link>} />
      <Table>
        <thead>
          <tr>
            <Th>Plan</Th>
            <Th>Kind</Th>
            <Th>Length</Th>
            <Th className="text-right">Per meal</Th>
            <Th className="text-right">Saving</Th>
            <Th>Effective</Th>
            <Th>Active / sold</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {plans.length === 0 && <EmptyRow colSpan={8}>No plans yet.</EmptyRow>}
          {plans.map((p) => (
            <tr key={p.id} className={p.isActive ? "" : "opacity-60"}>
              <Td>
                <Link href={`/admin/plans/${p.id}`} className="font-semibold hover:text-sindoor">
                  {p.name}
                </Link>
                <div className="flex gap-1.5 text-xs">
                  {p.isPopular && <Badge tone="brand">popular</Badge>}
                  {p.isCorporate && <Badge tone="info">teams</Badge>}
                </div>
              </Td>
              <Td className="text-xs">{p.kind.toLowerCase()}</Td>
              <Td className="text-sm">
                {p.durationWeeks} wk · min {p.minDaysPerWeek} d/wk
              </Td>
              <Td className="text-right font-semibold tabular-nums">{rs(p.pricePerMeal)}</Td>
              <Td className="text-right text-xs tabular-nums text-ink-mute">{p.compareAtPrice ? `${rs(p.compareAtPrice - p.pricePerMeal)} / meal` : "—"}</Td>
              <Td className="text-xs text-ink-mute">{p.effectiveFrom || p.effectiveTo ? `${p.effectiveFrom ? isoDate(p.effectiveFrom) : "…"} → ${p.effectiveTo ? isoDate(p.effectiveTo) : "…"}` : "Always"}</Td>
              <Td className="text-sm tabular-nums">
                {p.subscriptions.length} / {p._count.subscriptions}
              </Td>
              <Td className="text-right">
                <ConfirmAction action={togglePlan.bind(null, p.id)} label={p.isActive ? "Hide" : "Show"} variant="ghost" />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
