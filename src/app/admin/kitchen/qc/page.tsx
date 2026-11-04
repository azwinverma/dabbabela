import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { dateOnly, formatStamp } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { DayPicker } from "@/components/admin/ops/DayPicker";
import { pickDate, pickKitchen } from "@/components/admin/ops/scope";
import { qcAction } from "../actions";

export const metadata = { title: "QC log" };

export default async function QcPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; date?: string }> }) {
  const user = await requirePermission("kitchen");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const date = pickDate(sp.date);
  const [logs, batches, actors] = await Promise.all([
    db.qcLog.findMany({ where: { kitchenId: kitchen.id, date: dateOnly(date) }, include: { batch: { include: { menuItem: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } }),
    db.productionBatch.findMany({ where: { kitchenId: kitchen.id, date: dateOnly(date) }, include: { menuItem: { select: { name: true } } } }),
    db.user.findMany({ where: { role: { not: "CUSTOMER" } }, select: { id: true, name: true } }),
  ]);
  const who = new Map(actors.map((a) => [a.id, a.name]));
  return (
    <div>
      <PageHeader back={{ href: `/admin/kitchen?kitchen=${kitchen.id}&date=${date}`, label: "Kitchen" }} title="Quality checks" description="Temperature before dispatch, taste, hygiene and packaging. A failed check needs a note of what was done." />
      <DayPicker path="/admin/kitchen/qc" date={date} kitchenId={kitchen.id} kitchens={kitchens} />
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <Panel title="Log a check">
          <ActionForm action={qcAction} className="space-y-3" resetOnSuccess>
            <input type="hidden" name="kitchenId" value={kitchen.id} />
            <input type="hidden" name="date" value={date} />
            <select name="type" className="field" aria-label="Check type">
              <option value="TEMPERATURE">Temperature</option>
              <option value="TASTE">Taste</option>
              <option value="HYGIENE">Hygiene</option>
              <option value="PACKAGING">Packaging</option>
              <option value="OTHER">Other</option>
            </select>
            <select name="batchId" className="field" aria-label="Batch">
              <option value="">Whole kitchen</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.menuItem.name}
                </option>
              ))}
            </select>
            <input name="value" placeholder='Reading, e.g. "74°C"' className="field" />
            <div className="grid grid-cols-2 gap-2">
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-ink-line px-3 font-semibold"><input type="radio" name="result" value="PASS" defaultChecked className="h-5 w-5 accent-saag" /> Pass</label>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-ink-line px-3 font-semibold"><input type="radio" name="result" value="FAIL" className="h-5 w-5 accent-sindoor" /> Fail</label>
            </div>
            <textarea name="note" rows={2} placeholder="Note (required for a fail)" className="field" />
            <SubmitButton className="w-full">Save check</SubmitButton>
          </ActionForm>
        </Panel>
        <Table>
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Check</Th>
              <Th>Result</Th>
              <Th>Note</Th>
              <Th>By</Th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <Td className="text-xs">{formatStamp(l.createdAt)}</Td>
                <Td>{l.type.toLowerCase()}{l.batch ? ` · ${l.batch.menuItem.name}` : ""}{l.value ? ` · ${l.value}` : ""}</Td>
                <Td><Badge tone={l.result === "PASS" ? "good" : "bad"}>{l.result.toLowerCase()}</Badge></Td>
                <Td className="text-xs">{l.note}</Td>
                <Td className="text-xs">{l.actorId ? who.get(l.actorId) : ""}</Td>
              </tr>
            ))}
            {!logs.length && <EmptyRow colSpan={5}>No checks logged for this day.</EmptyRow>}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
