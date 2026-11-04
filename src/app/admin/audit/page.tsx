import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatStamp, isValidISODate } from "@/lib/dates";
import { ROLE_LABEL } from "@/lib/permissions";
import { PageHeader, Table, Th, Td, EmptyRow, FilterBar, Pagination } from "@/components/admin/ui";

const PER = 50;

function show(v: unknown) {
  if (v === undefined) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 160 ? s.slice(0, 160) + "…" : s;
}

/** Field-level diff of before/after JSON. */
function Diff({ before, after }: { before: unknown; after: unknown }) {
  const b = (before && typeof before === "object" && !Array.isArray(before) ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" && !Array.isArray(after) ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]) && !["updatedAt", "createdAt"].includes(k));
  if (!keys.length) {
    if (after === null && before === null) return null;
    return <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-paper/60 p-2 text-[11px]">{show(after ?? before)}</pre>;
  }
  return (
    <table className="w-full text-[11px]">
      <tbody>
        {keys.slice(0, 30).map((k) => (
          <tr key={k} className="align-top">
            <td className="pr-2 font-mono font-semibold">{k}</td>
            <td className="pr-2 text-sindoor-dark line-through decoration-sindoor/40">{show(b[k])}</td>
            <td className="text-saag-dark">{show(a[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; entity?: string; actor?: string; action?: string; from?: string; to?: string; page?: string }> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const from = sp.from && isValidISODate(sp.from) ? new Date(`${sp.from}T00:00:00+05:45`) : undefined;
  const to = sp.to && isValidISODate(sp.to) ? new Date(`${sp.to}T23:59:59+05:45`) : undefined;
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.entity ? { entity: sp.entity } : {}),
    ...(sp.actor ? { actorId: sp.actor } : {}),
    ...(sp.action ? { action: { startsWith: sp.action } } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(sp.q ? { OR: [{ summary: { contains: sp.q, mode: "insensitive" } }, { action: { contains: sp.q, mode: "insensitive" } }, { entityId: sp.q }, { reason: { contains: sp.q, mode: "insensitive" } }] } : {}),
  };
  const [logs, total, entities, actors] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER, include: { actor: { select: { name: true, role: true } } } }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
    db.user.findMany({ where: { role: { not: "CUSTOMER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Audit log" description={`Who changed what, when and why. Append-only. ${total.toLocaleString("en-IN")} matching entries.`} />
      <FilterBar q={sp.q} placeholder="Search summary, reason or ID">
        <select name="entity" defaultValue={sp.entity ?? ""} className="field w-auto" aria-label="Entity">
          <option value="">All records</option>
          {entities.map((e) => (
            <option key={e.entity} value={e.entity}>
              {e.entity}
            </option>
          ))}
        </select>
        <select name="actor" defaultValue={sp.actor ?? ""} className="field w-auto" aria-label="Who">
          <option value="">Anyone</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input name="action" defaultValue={sp.action ?? ""} placeholder="action e.g. order." className="field w-40" aria-label="Action prefix" />
        <input type="date" name="from" defaultValue={sp.from ?? ""} className="field w-auto" aria-label="From" />
        <input type="date" name="to" defaultValue={sp.to ?? ""} className="field w-auto" aria-label="To" />
      </FilterBar>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>Action</Th>
            <Th>Record</Th>
            <Th>Change</Th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 && <EmptyRow colSpan={5}>No entries.</EmptyRow>}
          {logs.map((l) => (
            <tr key={l.id} className="align-top">
              <Td className="whitespace-nowrap text-xs">{formatStamp(l.createdAt)}</Td>
              <Td className="text-xs">
                {l.actor ? (
                  <>
                    <span className="font-semibold">{l.actor.name}</span>
                    <span className="block text-ink-mute">{ROLE_LABEL[l.actor.role]}</span>
                  </>
                ) : (
                  <span className="text-ink-mute">System</span>
                )}
              </Td>
              <Td className="font-mono text-xs">{l.action}</Td>
              <Td className="text-xs">
                {l.entity}
                {l.entityId && <span className="block max-w-[140px] truncate font-mono text-ink-mute">{l.entityId}</span>}
              </Td>
              <Td className="min-w-[320px] text-xs">
                {l.summary && <p className="font-medium">{l.summary}</p>}
                {l.reason && <p className="text-ink-mute">Reason: {l.reason}</p>}
                {(l.before !== null || l.after !== null) && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-ink-mute">before / after</summary>
                    <Diff before={l.before} after={l.after} />
                  </details>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / PER)} params={{ q: sp.q, entity: sp.entity, actor: sp.actor, action: sp.action, from: sp.from, to: sp.to }} basePath="/admin/audit" />
    </>
  );
}
