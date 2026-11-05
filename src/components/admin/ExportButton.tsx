import { Download } from "lucide-react";
import { buttonClass } from "@/components/ui/Button";
import { hrefWith } from "@/app/admin/_kit/params";

/**
 * Export link that carries the current filters. Render it only after a server-side permission check
 * (`allowed={can(user, "orders.export")}`) — the export route must re-check, mask PII and audit the export.
 */
export function ExportButton({ href, params = {}, allowed, label = "Export CSV", format = "csv" }: { href: string; params?: Record<string, string | undefined>; allowed: boolean; label?: string; format?: string }) {
  if (!allowed) return null;
  const { page: _page, ...rest } = params;
  void _page;
  return (
    <a href={hrefWith(href, rest, { format })} className={buttonClass("outline", "sm", "gap-1.5")} download>
      <Download className="h-3.5 w-3.5" aria-hidden />
      {label}
    </a>
  );
}
