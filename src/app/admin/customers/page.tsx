import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatStamp } from "@/lib/dates";
import { PageHeader } from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { FilterForm, Field, DateRangeFields } from "@/components/admin/Filters";
import { SavedViews } from "@/components/admin/SavedViews";
import { ExportButton } from "@/components/admin/ExportButton";
import { Badge } from "@/components/ui/Badge";
import { flatParams, parseListParams, type SearchParamsRecord } from "../_kit/params";
import { listSavedViews } from "../_kit/saved-views";
import { acquisitionSources, CUSTOMER_SORTS, listCustomers, parseCustomerFilters, type CustomerRow } from "@/server/crm";

export const metadata = { title: "Customers" };
const BASE = "/admin/customers";
const DIET_SHORT: Record<string, string> = { ANY: "Any", VEG: "Veg", EGG_OK: "Veg + egg", VEGAN: "Vegan" };

export default async function Customers({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requirePermission("customers.view");
  const sp = await searchParams;
  const filters = parseCustomerFilters(sp);
  const state = parseListParams(sp, { sortable: CUSTOMER_SORTS, sort: "createdAt", per: 50 });
  const params = flatParams(sp);
  const [{ rows, total, pii }, sources, views] = await Promise.all([listCustomers(user, filters, state), acquisitionSources(), listSavedViews(user.id, "customers")]);
  const filtered = Object.keys(params).some((k) => !["page", "sort", "dir", "per"].includes(k));

  const columns: Column<CustomerRow>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      defaultDir: "asc",
      cell: (c) => (
        <>
          <Link href={`${BASE}/${c.id}`} className="font-semibold text-ink hover:text-sindoor">
            {c.name}
          </Link>
          {!c.isActive && (
            <Badge tone="bad" className="ml-2">
              suspended
            </Badge>
          )}
          {c.allergyCount > 0 && (
            <Badge tone="warn" className="ml-2">
              allergies
            </Badge>
          )}
        </>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      className: "text-xs",
      cell: (c) => (
        <>
          <div>{c.email}</div>
          <div className="text-ink-mute">{c.phone || "—"}</div>
        </>
      ),
    },
    { key: "area", header: "Area", className: "text-xs", cell: (c) => c.area ?? "—" },
    { key: "diet", header: "Diet", className: "text-xs", cell: (c) => DIET_SHORT[c.diet] ?? c.diet },
    { key: "company", header: "Company", className: "text-xs", cell: (c) => c.company ?? "—" },
    { key: "source", header: "Came from", className: "text-xs", cell: (c) => c.source ?? <span className="text-ink-mute">not captured</span> },
    {
      key: "orders",
      header: "Orders",
      sortable: true,
      align: "right",
      className: "tabular-nums",
      cell: (c) => (
        <>
          {c.orders}
          {c.plans > 0 && <span className="text-xs text-ink-mute"> · {c.plans} plans</span>}
        </>
      ),
    },
    { key: "lastLoginAt", header: "Last sign-in", sortable: true, className: "whitespace-nowrap text-xs text-ink-mute", cell: (c) => (c.lastLoginAt ? formatStamp(c.lastLoginAt) : "never") },
    { key: "createdAt", header: "Joined", sortable: true, className: "whitespace-nowrap text-xs text-ink-mute", cell: (c) => formatStamp(c.createdAt) },
  ];

  return (
    <>
      <PageHeader
        title="Customers"
        description={`${total.toLocaleString("en-IN")} matching customers${pii ? "" : " · contact details are masked for your role and email/phone search is off"}`}
        actions={<ExportButton href={`${BASE}/export`} params={params} allowed={can(user, "customers.export")} />}
      />
      <SavedViews module="customers" basePath={BASE} current={params} views={views} />
      <FilterForm basePath={BASE} q={filters.q} placeholder={pii ? "Name, email, phone or area" : "Name or area"} keep={{ sort: params.sort, dir: params.dir, per: params.per }} active={filtered}>
        <Field label="Status" htmlFor="flt-status">
          <select id="flt-status" name="status" defaultValue={filters.status ?? ""} className="field w-auto">
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>
        <Field label="Company" htmlFor="flt-company">
          <select id="flt-company" name="company" defaultValue={filters.company ?? ""} className="field w-auto">
            <option value="">Everyone</option>
            <option value="yes">Company members</option>
            <option value="no">Individuals</option>
          </select>
        </Field>
        <Field label="Diet" htmlFor="flt-diet">
          <select id="flt-diet" name="diet" defaultValue={filters.diet ?? ""} className="field w-auto">
            <option value="">Any</option>
            {Object.entries(DIET_SHORT).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Allergies" htmlFor="flt-allergies">
          <select id="flt-allergies" name="allergies" defaultValue={filters.allergies ?? ""} className="field w-auto">
            <option value="">Any</option>
            <option value="yes">Has allergies</option>
          </select>
        </Field>
        <Field label="Plans" htmlFor="flt-plan">
          <select id="flt-plan" name="plan" defaultValue={filters.plan ?? ""} className="field w-auto">
            <option value="">Any</option>
            <option value="active">Active or paused plan</option>
          </select>
        </Field>
        <Field label="Came from" htmlFor="flt-source">
          <select id="flt-source" name="source" defaultValue={filters.source ?? ""} className="field w-auto">
            <option value="">Any</option>
            <option value="unknown">Not captured</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <DateRangeFields from={filters.from} to={filters.to} label="Joined" />
      </FilterForm>
      <DataTable caption="Customers" columns={columns} rows={rows} rowKey={(c) => c.id} basePath={BASE} params={params} state={state} total={total} empty="No customers match these filters." minWidth={980} />
    </>
  );
}
