import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { addDays, formatDay, isoDate, monthRange, todayKTM, dateOnly } from "@/lib/dates";
import { maskEmail } from "@/lib/phone";
import { INVOICE_STATUS } from "@/lib/labels";
import { PageHeader, Panel, Tabs, Table, Th, Td, EmptyRow, OrderBadge, Callout } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { Kpi, readRange, RangeForm } from "@/components/admin/finance/kit";
import {
  boxPricesOf,
  budgetStatus,
  companyOrderReport,
  companyOutstanding,
  departmentSummary,
  inCompanyScope,
  invoicePaymentHistory,
  minCommitment,
  unpaidInvoices,
  upcomingDeliveries,
} from "@/server/corporate";
import {
  CompanyForm,
  RegenerateCode,
  MemberRow,
  LocationForm,
  LocationToggle,
  ContractForm,
  ActivateContract,
  EndContractForm,
  BudgetForm,
  CompanyMenuForm,
  DeliveryInstructionsForm,
  GenerateInvoiceForm,
  IssueInvoice,
} from "../CompanyForms";

type SP = { tab?: string; status?: string; ym?: string; from?: string; to?: string };

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requirePermission("corporate.view");
  const { id } = await params;
  const sp = await searchParams;
  const { tab = "overview", status } = sp;
  if (!inCompanyScope(user, id)) notFound();
  const c = await db.company.findUnique({ where: { id }, include: { zone: { select: { name: true } } } });
  if (!c) notFound();
  const pii = can(user, "customers.pii");
  const canEdit = can(user, "corporate.edit");
  const canInvoice = can(user, "invoices.edit");
  const today = todayKTM();
  const ym = sp.ym && /^\d{4}-\d{2}$/.test(sp.ym) ? sp.ym : today.slice(0, 7);
  const { start, end } = monthRange(ym);
  const [outstanding, commitment, budgets, unpaid, counts, month] = await Promise.all([
    companyOutstanding(c.id),
    minCommitment(c.id, ym),
    budgetStatus(c.id, ym),
    unpaidInvoices(c.id),
    db.companyMember.groupBy({ by: ["status"], where: { companyId: c.id }, _count: true }),
    db.order.aggregate({ where: { companyId: c.id, deliveryDate: { gte: dateOnly(start), lte: dateOnly(end) }, status: { in: ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED"] } }, _sum: { companyShare: true, customerShare: true, discount: true }, _count: true }),
  ]);
  const n = (s: string) => counts.find((x) => x.status === s)?._count ?? 0;
  const base = `/admin/companies/${c.id}`;
  const overdue = unpaid.filter((u) => u.overdueDays > 0);
  const tabs = [
    { key: "overview", label: "Overview", href: base },
    { key: "members", label: "Members", href: `${base}?tab=members`, count: n("ACTIVE") + n("PENDING") },
    { key: "delivery", label: "Offices & delivery", href: `${base}?tab=delivery` },
    { key: "contracts", label: "Contracts", href: `${base}?tab=contracts` },
    { key: "budgets", label: "Budgets", href: `${base}?tab=budgets` },
    { key: "menu", label: "Company menu", href: `${base}?tab=menu` },
    { key: "invoices", label: "Invoices", href: `${base}?tab=invoices`, count: unpaid.length || undefined },
    { key: "orders", label: "Orders", href: `${base}?tab=orders` },
    { key: "reports", label: "Reports", href: `${base}?tab=reports` },
    { key: "settings", label: "Billing & settings", href: `${base}?tab=settings` },
  ];

  return (
    <div>
      <PageHeader
        title={c.name}
        back={{ href: "/admin/companies", label: "Companies" }}
        description={
          <>
            Join code <span className="font-mono font-semibold">{c.joinCode}</span> · staff enter it in their profile{c.requireApproval ? " and wait for approval" : ""}.
          </>
        }
        actions={canEdit ? <RegenerateCode id={c.id} /> : undefined}
      />
      <Tabs tabs={tabs} current={tab} />

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label={`Orders · ${ym}`} value={month._count} sub={`${commitment.meals} meals`} />
            <Kpi label="Company share this month" value={rs(month._sum.companyShare ?? 0)} sub={month._sum.discount ? `${rs(month._sum.discount)} corporate discount given` : undefined} />
            <Kpi label="Employees paid this month" value={rs(month._sum.customerShare ?? 0)} />
            <Kpi label="Owes now" value={rs(outstanding)} sub={c.creditLimit != null ? `Limit ${rs(c.creditLimit)}` : "No credit limit"} tone={c.creditLimit != null && outstanding > c.creditLimit ? "bad" : "default"} formula="Company share of live meals not yet invoiced + unbilled company adjustments + unpaid balance of issued invoices." />
            <Kpi
              label="Minimum commitment"
              value={commitment.minMealsPerMonth != null ? `${commitment.meals} / ${commitment.minMealsPerMonth}` : "None"}
              sub={commitment.minMealsPerMonth != null ? (commitment.shortfall ? `Shortfall ${commitment.shortfall} meals · ${commitment.contractTitle}` : `Met · ${commitment.contractTitle}`) : "No monthly minimum in a contract"}
              tone={commitment.shortfall ? "warn" : "default"}
              formula="Meals (dabba quantity) on live company orders delivered or booked this month vs the contract's minimum meals per month."
            />
            <Kpi label="Unpaid invoices" value={unpaid.length} sub={overdue.length ? `${overdue.length} overdue · ${rs(overdue.reduce((a, u) => a + u.outstanding, 0))}` : unpaid.length ? "None overdue" : undefined} tone={overdue.length ? "bad" : "default"} />
            <Kpi label="Active members" value={n("ACTIVE")} sub={n("PENDING") ? `${n("PENDING")} waiting for approval` : undefined} tone={n("PENDING") ? "warn" : "default"} />
            <Kpi label="Billing" value={c.billingMode === "SPLIT" ? `${c.subsidyPct}% split` : c.billingMode === "COMPANY_PAID" ? "Company pays" : "Employees pay"} sub={[c.subsidyCap ? `cap ${rs(c.subsidyCap)}/meal` : null, c.monthlyAllowance ? `${rs(c.monthlyAllowance)}/person/month` : null, c.discountPct ? `${c.discountPct}% discount` : null].filter(Boolean).join(" · ") || undefined} />
            <Kpi label="Zone" value={c.zone?.name ?? "—"} sub={c.cutoffOverride ? `Own cut-off ${c.cutoffOverride}` : "Global cut-off"} />
            <Kpi label="Invoice terms" value={`${c.invoiceTermsDays} days`} sub={c.panVat ? `PAN ${c.panVat}` : "PAN/VAT missing"} tone={c.panVat ? "default" : "warn"} />
          </div>
          {budgets.some((b) => b.over) && (
            <Callout tone="warn" title="Department over budget">
              {budgets
                .filter((b) => b.over)
                .map((b) => `${b.department || "No department"}: ${rs(b.spent)} of ${rs(b.budget)}`)
                .join(" · ")}
            </Callout>
          )}
        </div>
      )}

      {tab === "members" && <MembersTab companyId={c.id} status={status} pii={pii} canEdit={canEdit} base={base} />}
      {tab === "delivery" && <DeliveryTab companyId={c.id} instructions={c.deliveryInstructions} canEdit={canEdit} />}
      {tab === "contracts" && <ContractsTab companyId={c.id} canEdit={canEdit} />}

      {tab === "budgets" && (
        <div className="space-y-4">
          <form className="flex items-end gap-2">
            <input type="hidden" name="tab" value="budgets" />
            <input type="month" name="ym" defaultValue={ym} className="field w-40" aria-label="Month" />
            <button className="h-[38px] rounded-lg bg-ink px-3 text-sm font-semibold text-paper">Show</button>
          </form>
          <Table>
            <thead>
              <tr>
                <Th>Department</Th>
                <Th className="text-right">People</Th>
                <Th className="text-right">Spent</Th>
                <Th className="text-right">Remaining</Th>
                <Th>Monthly budget</Th>
              </tr>
            </thead>
            <tbody>
              {budgets.length ? (
                budgets.map((b) => (
                  <tr key={b.department} className={b.over ? "bg-sindoor-light/40" : ""}>
                    <Td className="font-semibold">{b.department || <span className="text-ink-mute">No department</span>}</Td>
                    <Td className="text-right tabular-nums">{b.members}</Td>
                    <Td className="text-right tabular-nums">{rs(b.spent)}</Td>
                    <Td className="text-right tabular-nums">{b.remaining == null ? "—" : rs(b.remaining)}</Td>
                    <Td>{b.department && canEdit ? <BudgetForm companyId={c.id} month={ym} department={b.department} amount={b.budget} /> : b.budget != null ? rs(b.budget) : "—"}</Td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={5}>No departments yet.</EmptyRow>
              )}
            </tbody>
          </Table>
          {canEdit && (
            <Panel title={`Add a department budget for ${ym}`}>
              <BudgetForm companyId={c.id} month={ym} departments={budgets.map((b) => b.department).filter(Boolean)} />
              <p className="mt-2 text-xs text-ink-mute">The company share of a member&apos;s meals is capped by what&apos;s left of their department budget; team orders beyond it are refused unless the admin lets the employee pay the difference.</p>
            </Panel>
          )}
        </div>
      )}

      {tab === "menu" && <MenuTab companyId={c.id} canEdit={canEdit} />}

      {tab === "invoices" && (
        <InvoicesTab companyId={c.id} canInvoice={canInvoice} canView={can(user, "invoices.view")} unpaid={unpaid} today={today} />
      )}

      {tab === "orders" && <OrdersTab companyId={c.id} />}

      {tab === "reports" && <ReportsTab companyId={c.id} sp={sp} />}

      {tab === "settings" && (
        <Panel>
          <CompanyForm company={c} zones={await db.deliveryZone.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } })} />
        </Panel>
      )}
    </div>
  );
}

const DAY_LABEL: Record<string, string> = { SUN: "Sun", MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat" };

async function MembersTab({ companyId, status, pii, canEdit, base }: { companyId: string; status?: string; pii: boolean; canEdit: boolean; base: string }) {
  const [members, locations] = await Promise.all([
    db.companyMember.findMany({ where: { companyId, ...(status ? { status: status as "PENDING" | "ACTIVE" | "REMOVED" } : { status: { not: "REMOVED" } }) }, include: { user: { select: { id: true, name: true, email: true } }, officeLocation: { select: { name: true } } }, orderBy: [{ status: "asc" }, { createdAt: "asc" }] }),
    db.officeLocation.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <div className="mb-3 flex gap-2 text-sm">
        {[["", "Current"], ["PENDING", "Pending"], ["ACTIVE", "Active"], ["REMOVED", "Removed"]].map(([k, l]) => (
          <Link key={k} href={`${base}?tab=members${k ? `&status=${k}` : ""}`} className={`rounded-full border px-3 py-1 ${status === k || (!status && !k) ? "border-ink bg-ink text-paper" : "border-ink-line bg-white"}`}>
            {l}
          </Link>
        ))}
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Person</Th>
            <Th>Eligibility</Th>
            <Th>Settings</Th>
          </tr>
        </thead>
        <tbody>
          {members.length ? (
            members.map((m) => (
              <tr key={m.id} className="align-top">
                <Td>
                  <Link href={`/admin/customers/${m.user.id}`} className="font-semibold hover:text-sindoor">
                    {m.user.name}
                  </Link>
                  {m.role === "ADMIN" && <Badge tone="info" className="ml-1">admin</Badge>}
                  <div className="text-xs text-ink-mute">{pii ? m.user.email : maskEmail(m.user.email)}</div>
                  <div className="text-xs text-ink-mute">{m.officeLocation?.name ?? "No office"}</div>
                </Td>
                <Td className="text-xs">{!m.mealEligible ? <Badge tone="bad">not eligible</Badge> : m.eligibleDays.length ? m.eligibleDays.map((d) => DAY_LABEL[d]).join(", ") : "Every service day"}</Td>
                <Td>{canEdit ? <MemberRow m={m} locations={locations} /> : <span className="text-xs">{[m.status.toLowerCase(), m.department, m.costCenter].filter(Boolean).join(" · ")}</span>}</Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={3}>No members here.</EmptyRow>
          )}
        </tbody>
      </Table>
    </>
  );
}

async function DeliveryTab({ companyId, instructions, canEdit }: { companyId: string; instructions: string | null; canEdit: boolean }) {
  const [locations, slots, upcoming] = await Promise.all([
    db.officeLocation.findMany({ where: { companyId }, include: { zone: { select: { name: true } }, slot: { select: { label: true } }, _count: { select: { members: true } } }, orderBy: { createdAt: "asc" } }),
    db.deliverySlot.findMany({ where: { isActive: true }, select: { id: true, label: true }, orderBy: { sortOrder: "asc" } }),
    upcomingDeliveries(companyId),
  ]);
  return (
    <div className="space-y-4">
      <Table>
        <thead>
          <tr>
            <Th>Office</Th>
            <Th>Address</Th>
            <Th>Zone</Th>
            <Th>Slot</Th>
            <Th>Receiver</Th>
            <Th className="text-right">People</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {locations.length ? (
            locations.map((l) => (
              <tr key={l.id} className={l.isActive ? "" : "opacity-50"}>
                <Td className="font-semibold">{l.name}</Td>
                <Td className="text-xs">{[l.line1, l.area, l.ward ? `ward ${l.ward}` : null, l.landmark].filter(Boolean).join(", ")}</Td>
                <Td>{l.zone?.name ?? <Badge tone="bad">not served</Badge>}</Td>
                <Td className="text-xs">{l.slot?.label ?? "—"}</Td>
                <Td className="text-xs">{l.receiverName ?? "—"}</Td>
                <Td className="text-right tabular-nums">{l._count.members}</Td>
                <Td>{canEdit && <LocationToggle id={l.id} active={l.isActive} />}</Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={7}>No offices yet. Team orders deliver to each member&apos;s office.</EmptyRow>
          )}
        </tbody>
      </Table>
      <div className="grid gap-4 lg:grid-cols-2">
        {canEdit && (
          <Panel title="Add an office">
            <LocationForm companyId={companyId} slots={slots} />
          </Panel>
        )}
        <Panel title="Delivery instructions">{canEdit ? <DeliveryInstructionsForm companyId={companyId} value={instructions} /> : <p className="text-sm">{instructions ?? "None"}</p>}</Panel>
      </div>
      <Panel title="Upcoming deliveries by office (14 days)" bodyClass="p-0">
        <DeliveryGroups groups={upcoming.groups} />
      </Panel>
    </div>
  );
}

function DeliveryGroups({ groups }: { groups: Awaited<ReturnType<typeof upcomingDeliveries>>["groups"] }) {
  return (
    <Table className="rounded-none border-0 shadow-none">
      <thead>
        <tr>
          <Th>Day</Th>
          <Th>Office</Th>
          <Th>Slot</Th>
          <Th className="text-right">Orders</Th>
          <Th className="text-right">Dabbas</Th>
          <Th>Receiver</Th>
        </tr>
      </thead>
      <tbody>
        {groups.length ? (
          groups.map((g, i) => (
            <tr key={i}>
              <Td className="text-xs">{formatDay(g.date)}</Td>
              <Td>
                <span className="font-semibold">{g.office}</span>
                <span className="block text-xs text-ink-mute">{g.address}</span>
              </Td>
              <Td className="text-xs">{g.slot ?? "—"}</Td>
              <Td className="text-right tabular-nums">{g.orders}</Td>
              <Td className="text-right tabular-nums">{g.meals}</Td>
              <Td className="text-xs">{g.receiver ?? "—"}</Td>
            </tr>
          ))
        ) : (
          <EmptyRow colSpan={6}>Nothing booked for the next two weeks.</EmptyRow>
        )}
      </tbody>
    </Table>
  );
}

async function ContractsTab({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const [contracts, boxes] = await Promise.all([
    db.corporateContract.findMany({ where: { companyId }, orderBy: [{ version: "desc" }, { startsOn: "desc" }] }),
    db.lunchBox.findMany({ where: { isActive: true }, select: { id: true, name: true, price: true }, orderBy: { name: "asc" } }),
  ]);
  const today = todayKTM();
  const superseded = new Set(contracts.map((k) => k.supersedesId).filter(Boolean));
  const boxName = (id: string) => boxes.find((b) => b.id === id)?.name ?? "Retired dabba";
  return (
    <div className="space-y-4">
      {contracts.map((k) => {
        const view = { ...k, startsOn: isoDate(k.startsOn), endsOn: k.endsOn ? isoDate(k.endsOn) : null, boxPrices: boxPricesOf(k.boxPrices) };
        const inForce = k.status === "ACTIVE" && view.startsOn <= today && (!view.endsOn || view.endsOn >= today);
        const prev = k.supersedesId ? contracts.find((x) => x.id === k.supersedesId) : null;
        return (
          <Panel
            key={k.id}
            title={
              <span>
                {k.title} <span className="text-sm font-normal text-ink-mute">v{k.version}</span>
              </span>
            }
            actions={
              <span className="flex items-center gap-2">
                <Badge tone={inForce ? "good" : k.status === "DRAFT" ? "warn" : "neutral"}>{inForce ? "in force" : k.status.toLowerCase()}</Badge>
                {canEdit && k.status === "DRAFT" && <ActivateContract id={k.id} supersedes={Boolean(k.supersedesId)} />}
              </span>
            }
          >
            <p className="mb-2 text-xs text-ink-mute">
              {formatDay(view.startsOn, "long")} – {view.endsOn ? formatDay(view.endsOn, "long") : "open-ended"}
              {prev ? ` · supersedes v${prev.version}` : ""}
              {superseded.has(k.id) ? " · superseded by a newer version" : ""}
              {k.creditTermsDays != null ? ` · credit terms ${k.creditTermsDays} days` : ""}
              {k.minMealsPerMonth != null ? ` · min ${k.minMealsPerMonth} meals/month` : ""}
              {Object.keys(view.boxPrices).length ? ` · ${Object.entries(view.boxPrices).map(([b, p]) => `${boxName(b)} ${rs(p)}`).join(", ")}` : ""}
            </p>
            {canEdit && k.status === "DRAFT" && <ContractForm companyId={companyId} contract={view} boxes={boxes} />}
            {canEdit && k.status === "ACTIVE" && !superseded.has(k.id) && (
              <div className="space-y-3">
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-sindoor">New version (renegotiate)</summary>
                  <div className="mt-2">
                    <ContractForm companyId={companyId} contract={view} boxes={boxes} mode="version" />
                  </div>
                </details>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">End this contract</summary>
                  <div className="mt-2">
                    <EndContractForm id={k.id} />
                  </div>
                </details>
              </div>
            )}
          </Panel>
        );
      })}
      {canEdit && (
        <Panel title={contracts.length ? "Separate new contract" : "New contract"}>
          <ContractForm companyId={companyId} boxes={boxes} />
        </Panel>
      )}
    </div>
  );
}

async function MenuTab({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const [boxes, selected] = await Promise.all([
    db.lunchBox.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.companyMenuItem.findMany({ where: { companyId }, select: { boxId: true } }),
  ]);
  const ids = selected.map((s) => s.boxId);
  return (
    <Panel title="Company menu">
      <p className="mb-3 text-sm text-ink-mute">{ids.length ? `Members see only these ${ids.length} dabbas (when they're on the day's menu).` : "Nothing ticked — members see the full menu."} Tick none to remove the limit.</p>
      {canEdit ? (
        <CompanyMenuForm companyId={companyId} boxes={boxes.map((b) => ({ ...b, category: null }))} selected={ids} />
      ) : (
        <p className="text-sm">{boxes.filter((b) => ids.includes(b.id)).map((b) => b.name).join(", ") || "Full menu"}</p>
      )}
    </Panel>
  );
}

async function InvoicesTab({ companyId, canInvoice, canView, unpaid, today }: { companyId: string; canInvoice: boolean; canView: boolean; unpaid: Awaited<ReturnType<typeof unpaidInvoices>>; today: string }) {
  const [invoices, payments] = await Promise.all([db.invoice.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 30 }), invoicePaymentHistory(companyId)]);
  const prevMonth = monthRange(addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7));
  return (
    <div className="space-y-4">
      {canInvoice && (
        <Panel title="Generate an invoice">
          <GenerateInvoiceForm companyId={companyId} from={prevMonth.start} to={prevMonth.end} />
          <p className="mt-2 text-xs text-ink-mute">Bills the company share of due, unbilled meals (negotiated prices already applied at checkout) plus company-share adjustments from order edits. Due date comes from the credit terms of the contract in force.</p>
        </Panel>
      )}
      {unpaid.some((u) => u.overdueDays > 0) && (
        <Callout tone="bad" title="Overdue">
          {unpaid
            .filter((u) => u.overdueDays > 0)
            .map((u) => `${u.number}: ${rs(u.outstanding)} (${u.overdueDays} days)`)
            .join(" · ")}
        </Callout>
      )}
      <Table>
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Period</Th>
            <Th>Status</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">Paid</Th>
            <Th>Due</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {invoices.length ? (
            invoices.map((i) => (
              <tr key={i.id}>
                <Td>
                  {canView ? (
                    <Link href={`/admin/invoices/${i.id}`} className="font-mono text-xs text-sindoor hover:underline">
                      {i.number}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{i.number}</span>
                  )}
                  {i.kind === "CREDIT_NOTE" && <span className="ml-1 text-[10px] uppercase text-ink-mute">credit note</span>}
                </Td>
                <Td className="text-xs">
                  {formatDay(isoDate(i.periodStart))} – {formatDay(isoDate(i.periodEnd))}
                </Td>
                <Td>
                  <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                </Td>
                <Td className="text-right tabular-nums">{rs(i.total)}</Td>
                <Td className="text-right tabular-nums">{rs(i.paidAmount)}</Td>
                <Td className="text-xs">{i.dueDate ? formatDay(isoDate(i.dueDate)) : "—"}</Td>
                <Td>{canInvoice && i.status === "DRAFT" && i.kind === "INVOICE" && <IssueInvoice id={i.id} />}</Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={7}>No invoices yet.</EmptyRow>
          )}
        </tbody>
      </Table>
      <Panel title="Payments received" bodyClass="p-0">
        <Table className="rounded-none border-0 shadow-none">
          <thead>
            <tr>
              <Th>Recorded</Th>
              <Th>Invoice</Th>
              <Th>Amount · reference</Th>
            </tr>
          </thead>
          <tbody>
            {payments.length ? (
              payments.map((p, i) => (
                <tr key={i}>
                  <Td className="text-xs">{p.at.toISOString().slice(0, 10)}</Td>
                  <Td className="font-mono text-xs">{p.number}</Td>
                  <Td className="text-xs">{p.summary}</Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={3}>No payments recorded yet (record them on the invoice page).</EmptyRow>
            )}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}

async function OrdersTab({ companyId }: { companyId: string }) {
  const orders = await db.order.findMany({ where: { companyId }, include: { user: { select: { name: true } } }, orderBy: [{ deliveryDate: "desc" }, { number: "desc" }], take: 100 });
  return (
    <Table>
      <thead>
        <tr>
          <Th>Order</Th>
          <Th>Date</Th>
          <Th>Member</Th>
          <Th>Status</Th>
          <Th className="text-right">Company</Th>
          <Th className="text-right">Member</Th>
          <Th>Invoice</Th>
        </tr>
      </thead>
      <tbody>
        {orders.length ? (
          orders.map((o) => (
            <tr key={o.id}>
              <Td>
                <Link href={`/admin/orders/${o.id}`} className="font-semibold text-sindoor hover:underline">
                  {o.number}
                </Link>
              </Td>
              <Td className="text-xs">{formatDay(isoDate(o.deliveryDate))}</Td>
              <Td>{o.user.name}</Td>
              <Td>
                <OrderBadge status={o.status} />
              </Td>
              <Td className="text-right tabular-nums">{rs(o.companyShare)}</Td>
              <Td className="text-right tabular-nums">{rs(o.customerShare)}</Td>
              <Td className="text-xs">{o.invoiceId ? "billed" : o.companyShare ? "not yet" : "—"}</Td>
            </tr>
          ))
        ) : (
          <EmptyRow colSpan={7}>No orders yet.</EmptyRow>
        )}
      </tbody>
    </Table>
  );
}

async function ReportsTab({ companyId, sp }: { companyId: string; sp: SP }) {
  const { from, to } = readRange(sp as Record<string, string | undefined>, 30);
  const rows = await companyOrderReport(companyId, from, to);
  const depts = departmentSummary(rows);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <RangeForm from={from} to={to} presets={false}>
          <input type="hidden" name="tab" value="reports" />
        </RangeForm>
        <a href={`/admin/companies/${companyId}/report?from=${from}&to=${to}`} className="rounded-lg border-2 border-ink px-3 py-1.5 text-sm font-semibold hover:bg-ink hover:text-paper">
          ↓ Download CSV
        </a>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Department</Th>
            <Th className="text-right">Orders</Th>
            <Th className="text-right">Meals</Th>
            <Th className="text-right">Company</Th>
            <Th className="text-right">Employees</Th>
            <Th className="text-right">Discount</Th>
          </tr>
        </thead>
        <tbody>
          {depts.length ? (
            depts.map((d) => (
              <tr key={d.department}>
                <Td className="font-semibold">{d.department || "No department"}</Td>
                <Td className="text-right tabular-nums">{d.orders}</Td>
                <Td className="text-right tabular-nums">{d.meals}</Td>
                <Td className="text-right tabular-nums">{rs(d.company)}</Td>
                <Td className="text-right tabular-nums">{rs(d.employee)}</Td>
                <Td className="text-right tabular-nums">{rs(d.discount)}</Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={6}>No orders in this range.</EmptyRow>
          )}
        </tbody>
      </Table>
    </div>
  );
}
