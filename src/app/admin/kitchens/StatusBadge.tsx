import { Badge } from "@/components/ui/Badge";

/** Kitchen status: open / paused / shut down; archived kitchens (isActive false) show as archived. */
export function StatusBadge({ status, isActive = true }: { status: string; isActive?: boolean }) {
  if (!isActive) return <Badge tone="neutral">archived</Badge>;
  if (status === "PAUSED") return <Badge tone="warn">paused</Badge>;
  if (status === "CLOSED") return <Badge tone="bad">shut down</Badge>;
  return <Badge tone="good">open</Badge>;
}
