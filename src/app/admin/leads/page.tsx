import Link from "next/link";
import type { LeadStatus } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatDay, isoDate, todayKTM } from "@/lib/dates";
import { LEAD_STATUS } from "@/lib/labels";
import { PageHeader } from "@/components/admin/ui";
import { MoveButton } from "./LeadForms";

export const metadata = { title: "Corporate leads" };

const STAGES: LeadStatus[] = ["NEW", "CONTACTED", "TRIAL", "PROPOSAL", "WON", "LOST"];
const NEXT: Partial<Record<LeadStatus, LeadStatus>> = { NEW: "CONTACTED", CONTACTED: "TRIAL", TRIAL: "PROPOSAL", PROPOSAL: "WON" };

export default async function Leads() {
  await requirePermission("leads");
  const leads = await db.corporateLead.findMany({ orderBy: [{ nextFollowUp: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 300 });
  const today = todayKTM();
  return (
    <div>
      <PageHeader title="Corporate leads" description="Tasting requests and enquiries from the website, from first contact to a signed company account. Overdue follow-ups are highlighted." />
      <div className="flex gap-3 overflow-x-auto pb-3">
        {STAGES.map((st) => {
          const col = leads.filter((l) => l.status === st);
          return (
            <section key={st} className="w-64 shrink-0 rounded-xl border border-ink-line/70 bg-paper/50 p-2">
              <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-bold uppercase tracking-wide text-ink-mute">
                {LEAD_STATUS[st].label}
                <span className="rounded-full bg-white px-2 tabular-nums">{col.length}</span>
              </h2>
              <ul className="space-y-2">
                {col.map((l) => {
                  const due = l.nextFollowUp ? isoDate(l.nextFollowUp) : null;
                  const late = due && due <= today && !["WON", "LOST"].includes(l.status);
                  return (
                    <li key={l.id} className={`rounded-lg border bg-white p-2.5 text-sm shadow-sm ${late ? "border-sindoor" : "border-ink-line/70"}`}>
                      <Link href={`/admin/leads/${l.id}`} className="font-semibold hover:text-sindoor">
                        {l.companyName}
                      </Link>
                      <p className="text-xs text-ink-mute">
                        {l.contactName}
                        {l.headcount ? ` · ${l.headcount} people` : ""}
                        {l.location ? ` · ${l.location}` : ""}
                      </p>
                      {l.quotePerMeal && <p className="text-xs">Quoted {rs(l.quotePerMeal)}/meal</p>}
                      {due && <p className={`text-xs ${late ? "font-bold text-sindoor" : "text-ink-mute"}`}>Follow up {formatDay(due)}</p>}
                      {NEXT[l.status] && <MoveButton id={l.id} to={NEXT[l.status]!} label={`→ ${LEAD_STATUS[NEXT[l.status]!].label}`} />}
                    </li>
                  );
                })}
                {!col.length && <li className="px-1 py-4 text-center text-xs text-ink-mute">—</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
