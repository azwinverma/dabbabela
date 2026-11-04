import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Panel } from "@/components/admin/ui";
import { CompanyForm } from "../CompanyForms";

export const metadata = { title: "New company" };

export default async function NewCompany() {
  await requirePermission("corporate.view");
  const zones = await db.deliveryZone.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } });
  return (
    <div>
      <PageHeader title="New company" back={{ href: "/admin/companies", label: "Companies" }} />
      <Panel>
        <CompanyForm zones={zones} />
      </Panel>
    </div>
  );
}
