import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { can, type Permission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, isValidISODate, todayKTM } from "@/lib/dates";
import { maskEmail, maskPhone } from "@/lib/phone";
import { audit } from "@/lib/audit";
import { csv, money } from "@/server/reports";
import { exportUserData } from "@/server/privacy";
import { REVENUE_STATUSES } from "@/server/transitions";

export const dynamic = "force-dynamic";

const PERM: Record<string, Permission> = {
  orders: "reports.export",
  "order-items": "reports.export",
  "dish-sales": "reports.export",
  subscriptions: "reports.export",
  payments: "payments.view",
  refunds: "refunds.view",
  ledger: "refunds.view",
  invoices: "invoices.view",
  customers: "customers.view",
  stock: "inventory.export",
  privacy: "privacy.view",
};

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const user = await requireStaff();
  const perm = PERM[type];
  if (!perm) return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  if (!can(user, perm)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const to = isValidISODate(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : todayKTM();
  const from = isValidISODate(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : addDays(to, -29);
  const pii = can(user, "customers.pii");
  const phone = (p: string | null | undefined) => (pii ? (p ?? "") : maskPhone(p));
  const email = (e: string | null | undefined) => (pii ? (e ?? "") : maskEmail(e));
  const day = { gte: dateOnly(from), lte: dateOnly(to) };
  const stamp = { gte: dateOnly(from), lt: dateOnly(addDays(to, 1)) };

  let rows: (string | number | boolean | null | undefined | Date)[][] = [];

  if (type === "privacy") {
    const id = url.searchParams.get("user") ?? "";
    const data = await exportUserData(id);
    await audit({ actorId: user.id, action: "privacy.export", entity: "User", entityId: id });
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="dabbabela-data-${id}.json"`, "Cache-Control": "no-store" },
    });
  }

  if (type === "orders") {
    const os = await db.order.findMany({ where: { deliveryDate: day }, include: { user: { select: { name: true, email: true } }, zone: { select: { name: true } }, company: { select: { name: true } }, payment: { select: { method: true, reference: true } } }, orderBy: [{ deliveryDate: "asc" }, { number: "asc" }], take: 20000 });
    rows = [["Order", "Delivery date", "Status", "Payment status", "Source", "Customer", "Email", "Phone", "Area", "Zone", "Company", "Slot", "Subtotal", "Delivery", "Discount", "VAT", "Total", "Company share", "Customer share", "Refunded", "Food cost", "Method", "Payment ref", "Placed at"]];
    for (const o of os)
      rows.push([o.number, isoDate(o.deliveryDate), o.status, o.paymentStatus, o.source, o.user.name, email(o.user.email), phone(o.contactPhone), o.area, o.zone?.name, o.company?.name, o.slotLabel, money(o.subtotal), money(o.deliveryFee), money(o.discount), money(o.tax), money(o.total), money(o.companyShare), money(o.customerShare), money(o.refundedAmount), money(o.costTotal), o.payment?.method, o.payment?.reference, o.createdAt]);
  } else if (type === "order-items") {
    const items = await db.orderItem.findMany({ where: { order: { deliveryDate: day } }, include: { order: { select: { number: true, deliveryDate: true, status: true } }, customizations: true }, take: 50000 });
    rows = [["Order", "Delivery date", "Status", "Item", "Details", "Diet", "Qty", "Unit price", "Line total", "Unit cost", "Swaps"]];
    for (const i of items) rows.push([i.order.number, isoDate(i.order.deliveryDate), i.order.status, i.name, i.details, i.diet, i.quantity, money(i.unitPrice), money(i.lineTotal), money(i.unitCost), i.customizations.map((c) => c.label).join("; ")]);
  } else if (type === "dish-sales") {
    const r = await db.$queryRaw<{ name: string; n: bigint }[]>`
      SELECT c->>'name' AS name, SUM((c->>'qty')::int * oi.quantity) AS n
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" CROSS JOIN LATERAL jsonb_array_elements(oi.components) c
      WHERE o."deliveryDate" BETWEEN ${dateOnly(from)} AND ${dateOnly(to)} AND o.status::text = ANY(${REVENUE_STATUSES as string[]})
      GROUP BY 1 ORDER BY 2 DESC`;
    rows = [["Dish", "Portions"], ...r.map((x) => [x.name, Number(x.n)])];
  } else if (type === "subscriptions") {
    const subs = await db.subscription.findMany({ where: { createdAt: stamp }, include: { user: { select: { name: true, email: true } }, plan: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
    rows = [["Reference", "Plan", "Customer", "Email", "Status", "Start", "End", "Meals", "Per meal", "Total", "Discount", "Coupon", "Created"]];
    for (const s of subs) rows.push([s.reference, s.plan.name, s.user.name, email(s.user.email), s.status, isoDate(s.startDate), isoDate(s.endDate), s.mealsTotal, money(s.pricePerMeal), money(s.total), money(s.discount), s.couponCode, s.createdAt]);
  } else if (type === "payments") {
    const ps = await db.payment.findMany({ where: { createdAt: stamp }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } });
    rows = [["Reference", "Method", "Status", "Amount", "Refunded", "Customer", "Email", "Paid at", "Verified by", "Note", "Created"]];
    for (const p of ps) rows.push([p.reference, p.method, p.status, money(p.amount), money(p.refundedAmount), p.user.name, email(p.user.email), p.paidAt, p.verifiedById, p.note, p.createdAt]);
  } else if (type === "refunds") {
    const rs_ = await db.refund.findMany({ where: { createdAt: stamp }, include: { payment: { select: { reference: true } }, order: { select: { number: true } } }, orderBy: { createdAt: "asc" } });
    rows = [["Payment", "Order", "Amount", "Method", "Status", "Reason", "Provider ref", "Processed at", "Requested"]];
    for (const r of rs_) rows.push([r.payment.reference, r.order?.number, money(r.amount), r.method, r.status, r.reason, r.providerRef, r.processedAt, r.createdAt]);
  } else if (type === "ledger") {
    const ls = await db.creditLedger.findMany({ where: { createdAt: stamp }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } });
    rows = [["When", "Customer", "Email", "Amount", "Reason", "Order", "Payment", "Note"]];
    for (const l of ls) rows.push([l.createdAt, l.user.name, email(l.user.email), money(l.amount), l.reason, l.orderId, l.paymentId, l.note]);
  } else if (type === "invoices") {
    const is = await db.invoice.findMany({ where: { createdAt: stamp }, include: { company: { select: { name: true } } }, orderBy: { number: "asc" } });
    rows = [["Number", "Kind", "Company", "Billing name", "PAN/VAT", "Period start", "Period end", "Status", "Subtotal", "VAT", "Total", "Paid", "Due", "Issued"]];
    for (const i of is) rows.push([i.number, i.kind, i.company?.name, i.billingName, i.panVat, isoDate(i.periodStart), isoDate(i.periodEnd), i.status, money(i.subtotal), money(i.tax), money(i.total), money(i.paidAmount), i.dueDate ? isoDate(i.dueDate) : "", i.issuedAt]);
  } else if (type === "customers") {
    const us = await db.user.findMany({ where: { role: "CUSTOMER", deletedAt: null }, include: { membership: { include: { company: { select: { name: true } } } }, _count: { select: { orders: true } } }, orderBy: { createdAt: "asc" }, take: 50000 });
    rows = [["Name", "Email", "Phone", "Diet", "Allergies", "Company", "Orders", "Marketing opt-in", "Active", "Joined"]];
    for (const u of us) rows.push([u.name, email(u.email), phone(u.phoneNumber), u.diet, u.allergies.join(" "), u.membership?.company.name, u._count.orders, u.marketingOptIn, u.isActive, u.createdAt]);
  } else if (type === "stock") {
    const ms = await db.stockMovement.findMany({ where: { createdAt: stamp }, include: { ingredient: { select: { name: true, unit: true, costPerUnit: true } }, kitchen: { select: { code: true } } }, orderBy: { createdAt: "asc" } });
    rows = [["When", "Kitchen", "Ingredient", "Type", "Quantity", "Unit", "Unit cost", "Value", "Reference", "Expires", "Note"]];
    for (const m of ms) rows.push([m.createdAt, m.kitchen.code, m.ingredient.name, m.type, m.quantity, m.ingredient.unit, money(m.unitCost ?? m.ingredient.costPerUnit), money(Math.round(m.quantity * (m.unitCost ?? m.ingredient.costPerUnit))), m.reference, m.expiresOn ? isoDate(m.expiresOn) : "", m.note]);
  }

  await audit({ actorId: user.id, action: "export.csv", entity: "Export", entityId: type, summary: `${type} ${from}→${to} (${rows.length - 1} rows${pii ? ", with contact details" : ""})` });
  return new NextResponse(csv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="dabbabela-${type}-${from}-to-${to}.csv"`, "Cache-Control": "no-store" },
  });
}
