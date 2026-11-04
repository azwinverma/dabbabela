import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { formatStamp, isoDate } from "@/lib/dates";
import { rupeesInput } from "@/lib/money";
import { formatNepalPhone, whatsappLink } from "@/lib/phone";
import { PageHeader, Panel, KV, LeadBadge } from "@/components/admin/ui";
import { LeadForm, ConvertButton } from "../LeadForms";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("leads.view");
  const { id } = await params;
  const l = await db.corporateLead.findUnique({ where: { id }, include: { company: { select: { id: true, name: true } } } });
  if (!l) notFound();
  return (
    <div>
      <PageHeader title={l.companyName} back={{ href: "/admin/leads", label: "Leads" }} description={`Received ${formatStamp(l.createdAt)} via ${l.source}`} actions={<LeadBadge status={l.status} />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Enquiry">
          <KV
            items={[
              ["Contact", l.contactName],
              ["Email", <a key="e" className="text-sindoor underline" href={`mailto:${l.email}`}>{l.email}</a>],
              ["Phone", <span key="p">{formatNepalPhone(l.phone) || l.phone} · <a className="text-sindoor underline" href={whatsappLink(l.phone)} target="_blank" rel="noreferrer">WhatsApp</a></span>],
              ["Headcount", l.headcount],
              ["Location", l.location],
              ["Meals / week", l.mealsPerWeek],
              ["Budget", l.budget],
              ["Message", l.message],
            ]}
          />
        </Panel>
        <Panel title="Pipeline" className="lg:col-span-2">
          <LeadForm lead={{ id: l.id, status: l.status, quotePerMeal: l.quotePerMeal != null ? rupeesInput(l.quotePerMeal) : "", quoteValidUntil: l.quoteValidUntil ? isoDate(l.quoteValidUntil) : "", nextFollowUp: l.nextFollowUp ? isoDate(l.nextFollowUp) : "" }} />
          <div className="mt-4 border-t border-ink-line/60 pt-3">
            {l.company ? (
              <p className="text-sm">
                Converted to <Link className="font-semibold text-sindoor underline" href={`/admin/companies/${l.company.id}`}>{l.company.name}</Link>.
              </p>
            ) : can(user, "corporate.edit") ? (
              <ConvertButton id={l.id} />
            ) : null}
          </div>
          {l.notes && <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-paper p-3 text-xs text-ink-soft">{l.notes}</pre>}
        </Panel>
      </div>
    </div>
  );
}
