import Link from "next/link";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { formatDay } from "@/lib/dates";
import { rs } from "@/lib/money";
import { ADDRESS_TYPE_LABEL, METHOD_LABEL } from "@/lib/labels";
import { PageHeader, Panel, Callout } from "@/components/admin/ui";
import { Field, FilterForm } from "@/components/admin/Filters";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { kitchenWhere } from "@/components/admin/ops/scope";
import { orderableDates } from "@/server/calendar";
import { getOffersForDates } from "@/server/menu";
import { defaultKitchenId } from "@/server/orders";
import { findCustomers, loadCustomer, staffPaymentMethods } from "@/server/orders-admin";
import { hrefWith, one, type SearchParamsRecord } from "../../_kit/params";
import { manualOrderAction } from "../actions";

export const metadata = { title: "New phone order" };
const BASE = "/admin/orders/new";

/**
 * Staff phone / walk-in order. Step 1 picks the customer (or a new one), step 2 the day; the form then posts lines only —
 * prices, delivery fee, company split, coupon and tax are worked out on the server.
 */
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requirePermission("orders.create");
  const sp = await searchParams;
  const q = one(sp, "q") ?? "";
  const customerParam = one(sp, "customer");
  const settings = await getSettings();
  const customer = customerParam && customerParam !== "new" ? await loadCustomer(customerParam).catch(() => null) : null;
  const isNew = customerParam === "new";
  const kitchenId = customer?.addresses.find((a) => a.zone?.kitchenId)?.zone?.kitchenId ?? (await defaultKitchenId());
  const dates = await orderableDates(settings, 14, kitchenId);
  const date = one(sp, "date") && dates.includes(one(sp, "date")!) ? one(sp, "date")! : dates[0];
  const [found, zones, slots, methods, offer] = await Promise.all([
    q ? findCustomers(user, q) : Promise.resolve([]),
    db.deliveryZone.findMany({ where: { isActive: true, ...kitchenWhere(user) }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.deliverySlot.findMany({ where: { isActive: true, ...kitchenWhere(user) }, orderBy: [{ kitchenId: "asc" }, { sortOrder: "asc" }], select: { id: true, label: true, kitchen: { select: { name: true } } } }),
    staffPaymentMethods(settings),
    date ? getOffersForDates([date], kitchenId).then((m) => m.get(date)) : Promise.resolve(undefined),
  ]);
  const menu = offer && !offer.closed ? offer.items : [];
  const keep = { customer: customerParam, date };

  return (
    <div className="max-w-4xl">
      <PageHeader back={{ href: "/admin/orders", label: "Orders" }} title="New phone order" description="Place an order on a customer's behalf. Prices come from the server, exactly as at checkout." />

      <Panel title="1 · Customer" className="mb-5">
        {customer ? (
          <p className="text-sm">
            <b>{customer.name}</b>
            {customer.membership?.status === "ACTIVE" && <span className="text-akash"> · {customer.membership.company.name} (company billing applies)</span>}{" "}
            <Link href={hrefWith(BASE, { date })} className="ml-2 text-xs text-akash underline">
              Change
            </Link>
          </p>
        ) : isNew ? (
          <p className="text-sm">
            New customer — enter their details below.{" "}
            <Link href={hrefWith(BASE, { date })} className="ml-2 text-xs text-akash underline">
              Search instead
            </Link>
          </p>
        ) : (
          <>
            <FilterForm basePath={BASE} q={q} qLabel="Find customer" placeholder="Name (phone/email with contact access)" keep={{ date }} />
            {q && (
              <ul className="divide-y divide-ink-line/50 text-sm">
                {found.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      <b>{c.name}</b> <span className="text-ink-mute">{c.phone}</span> <span className="text-ink-mute">{c.email}</span>
                      {c.company && <span className="text-akash"> · {c.company}</span>}
                    </span>
                    <Link href={hrefWith(BASE, { customer: c.id, date })} className="rounded-lg border border-ink-line px-3 py-1 text-xs font-semibold hover:border-ink">
                      Select
                    </Link>
                  </li>
                ))}
                {!found.length && <li className="py-2 text-ink-mute">No customers match.</li>}
              </ul>
            )}
            <p className="mt-3 text-sm">
              <Link href={hrefWith(BASE, { customer: "new", date })} className="font-semibold text-akash underline">
                + New customer
              </Link>
            </p>
          </>
        )}
      </Panel>

      {(customer || isNew) && (
        <>
          <Panel title="2 · Delivery day" className="mb-5">
            <form method="get" action={BASE} className="flex flex-wrap items-end gap-2">
              {keep.customer && <input type="hidden" name="customer" value={keep.customer} />}
              <Field label="Day" htmlFor="day">
                <select id="day" name="date" defaultValue={date} className="field w-auto">
                  {dates.map((d) => (
                    <option key={d} value={d}>
                      {formatDay(d, "full")}
                    </option>
                  ))}
                </select>
              </Field>
              <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Show menu</button>
            </form>
          </Panel>

          <Panel title="3 · Order">
            {!date || !menu.length ? (
              <Callout tone="warn">Nothing is on the menu for that day.</Callout>
            ) : (
              <ActionForm action={manualOrderAction} className="space-y-5">
                <input type="hidden" name="customerId" value={customer?.id ?? "new"} />
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />

                {isNew && (
                  <fieldset className="grid gap-3 sm:grid-cols-3">
                    <legend className="label mb-1">New customer</legend>
                    <Field label="Name" htmlFor="nc_name">
                      <input id="nc_name" name="nc_name" required className="field" />
                    </Field>
                    <Field label="Mobile" htmlFor="nc_phone">
                      <input id="nc_phone" name="nc_phone" required inputMode="tel" placeholder="98XXXXXXXX" className="field" />
                    </Field>
                    <Field label="Email (optional)" htmlFor="nc_email">
                      <input id="nc_email" name="nc_email" type="email" className="field" />
                    </Field>
                  </fieldset>
                )}

                <fieldset className="space-y-3">
                  <legend className="label mb-1">Delivery address</legend>
                  {customer && customer.addresses.length > 0 && (
                    <select name="addressId" className="field" defaultValue={customer.addresses[0].id} aria-label="Saved address">
                      {customer.addresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label} — {a.line1}, {a.area}
                          {a.zone ? ` (${a.zone.name})` : " (area not served)"}
                        </option>
                      ))}
                      <option value="new">+ New address (fill in below)</option>
                    </select>
                  )}
                  <div className="grid gap-3 rounded-lg border border-dashed border-ink-line p-3 sm:grid-cols-3">
                    <p className="text-xs text-ink-mute sm:col-span-3">{customer?.addresses.length ? "Only used when “New address” is selected." : "New address"}</p>
                    <Field label="Zone" htmlFor="na_zone">
                      <select id="na_zone" name="na_zone" className="field" defaultValue="">
                        <option value="">Pick…</option>
                        {zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Street / building / floor" htmlFor="na_line1">
                      <input id="na_line1" name="na_line1" className="field" />
                    </Field>
                    <Field label="Area" htmlFor="na_area">
                      <input id="na_area" name="na_area" className="field" />
                    </Field>
                    <Field label="Place name" htmlFor="na_place">
                      <input id="na_place" name="na_place" className="field" />
                    </Field>
                    <Field label="Landmark" htmlFor="na_landmark">
                      <input id="na_landmark" name="na_landmark" className="field" />
                    </Field>
                    <Field label="Type" htmlFor="na_type">
                      <select id="na_type" name="na_type" className="field" defaultValue="OFFICE">
                        {Object.entries(ADDRESS_TYPE_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Rider instructions" htmlFor="na_instructions" className="sm:col-span-3">
                      <input id="na_instructions" name="na_instructions" className="field" />
                    </Field>
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="label mb-1">Dabbas for {formatDay(date, "full")}</legend>
                  <ul className="divide-y divide-ink-line/50">
                    {menu.map((i) => (
                      <li key={i.box.id} className="flex items-center justify-between gap-3 py-2">
                        <label htmlFor={`qty-${i.box.id}`} className="text-sm">
                          <b>{i.box.name}</b> <span className="text-ink-mute">{rs(i.price)} list</span>
                          {i.soldOut && <span className="ml-1 font-semibold text-sindoor">sold out</span>}
                        </label>
                        <input id={`qty-${i.box.id}`} name={`qty:${i.box.id}`} type="number" min={0} max={25} defaultValue={0} className="field w-20" disabled={i.soldOut} />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-ink-mute">Company customers get their negotiated price and split automatically.</p>
                </fieldset>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Payment method" htmlFor="method">
                    <select id="method" name="method" className="field" defaultValue="CASH">
                      {methods
                        .filter((m) => m !== "COMPANY_INVOICE")
                        .map((m) => (
                          <option key={m} value={m}>
                            {METHOD_LABEL[m]}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Delivery window" htmlFor="slotId">
                    <select id="slotId" name="slotId" className="field" defaultValue="">
                      <option value="">Any</option>
                      {slots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} · {s.kitchen.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Coupon" htmlFor="coupon">
                    <input id="coupon" name="coupon" className="field" disabled={isNew} placeholder={isNew ? "Existing customers only" : ""} />
                  </Field>
                  <Field label="Note for the kitchen / rider" htmlFor="notes" className="sm:col-span-2">
                    <input id="notes" name="notes" className="field" maxLength={500} />
                  </Field>
                  <Field label="Why (audit)" htmlFor="reason">
                    <input id="reason" name="reason" className="field" placeholder="Phone order" maxLength={500} />
                  </Field>
                </div>

                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="intent" value="quote" variant="outline" size="sm" pendingText="Pricing…">
                    Preview price
                  </SubmitButton>
                  <SubmitButton name="intent" value="place" variant="dark" size="sm" pendingText="Placing…" confirm="Place this order for the customer?">
                    Place order
                  </SubmitButton>
                </div>
                <p className="text-xs text-ink-mute">Bank transfer and online methods keep the order pending until payment is verified. Pressing “Place order” twice never creates two orders.</p>
              </ActionForm>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
