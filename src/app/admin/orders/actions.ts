"use server";

import type { AddressType, OrderStatus, PaymentMethod, RefundMethod } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { parseRupees, rs } from "@/lib/money";
import { adjustOrder, cancelOrder, setOrderStatus, type CartLine, type Settlement } from "@/server/orders";
import { createCorporateBulkOrder, createManualOrder, editOrderLines, quoteManualOrder, reassignDelivery, reassignKitchen, substituteOrderItem } from "@/server/orders-admin";
import { f } from "@/app/admin/_kit/form";
import { requestRefund } from "@/server/payments";
import { TRANSITIONS } from "@/server/transitions";
import { assertKitchen, guard, reasonOf, kitchenWhere } from "@/components/admin/ops/scope";

const STATUSES = Object.keys(TRANSITIONS) as OrderStatus[];

async function loadOrder(id: string, user: { kitchenId: string | null }) {
  const o = await db.order.findUniqueOrThrow({ where: { id } });
  assertKitchen(user, o.kitchenId);
  return o;
}

export async function changeStatusAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.edit");
    const to = String(fd.get("status")) as OrderStatus;
    if (!STATUSES.includes(to) || to === "CANCELLED") return fail("Pick a status (use Cancel for cancellations)");
    const o = await loadOrder(orderId, user);
    const note = String(fd.get("note") ?? "").trim() || null;
    if (to === "FAILED_DELIVERY" && !note) return fail("Say why the delivery failed");
    const r = await setOrderStatus([orderId], to, user.id, note ?? "Changed by staff");
    if (!r.changed.length) return fail(r.rejected[0]?.reason ?? "Nothing changed");
    await audit({ actorId: user.id, action: "order.status", entity: "Order", entityId: orderId, summary: `${o.number}: ${o.status} → ${to}`, reason: note, before: { status: o.status }, after: { status: to } });
    revalidatePath(`/admin/orders/${orderId}`);
    return done(`Moved to ${to.replace(/_/g, " ").toLowerCase()}`);
  });
}

export async function cancelAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.edit");
    const o = await loadOrder(orderId, user);
    const reason = reasonOf(fd);
    const settlement = (["CREDIT", "REFUND", "NONE"].includes(String(fd.get("settlement"))) ? String(fd.get("settlement")) : "CREDIT") as Settlement;
    const r = await cancelOrder(orderId, { id: user.id, isStaff: true }, { reason, settlement });
    await audit({ actorId: user.id, action: "order.cancel", entity: "Order", entityId: orderId, summary: `${o.number} cancelled (${r.settlement}${r.amount ? ` ${rs(r.amount)}` : ""})`, reason, before: { status: o.status }, after: { status: "CANCELLED", settlement: r.settlement, amount: r.amount } });
    revalidatePath(`/admin/orders/${orderId}`);
    return done(r.settlement === "NONE" ? "Cancelled" : r.settlement === "CREDIT" ? `Cancelled — ${rs(r.amount)} credited` : `Cancelled — refund of ${rs(r.amount)} requested`);
  });
}

export async function adjustAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.edit");
    const o = await loadOrder(orderId, user);
    const reason = reasonOf(fd);
    const amount = parseRupees(String(fd.get("amount") ?? ""));
    if (!amount) return fail("Enter an amount, e.g. -50 for a Rs 50 credit or 30 for an extra charge");
    await adjustOrder(orderId, user.id, amount, reason);
    await audit({ actorId: user.id, action: "order.adjust", entity: "Order", entityId: orderId, summary: `${o.number}: adjustment ${rs(amount)}`, reason, after: { amount } });
    revalidatePath(`/admin/orders/${orderId}`);
    return done(amount < 0 ? `${rs(-amount)} credited to the customer's wallet` : `Charge of ${rs(amount)} recorded`);
  });
}

export async function refundAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("refunds.create");
    const o = await loadOrder(orderId, user);
    if (!o.paymentId) return fail("This order has no payment");
    const reason = reasonOf(fd);
    const amount = parseRupees(String(fd.get("amount") ?? ""));
    if (!amount || amount <= 0) return fail("Enter the refund amount");
    const method = (["ORIGINAL", "BANK", "CASH", "WALLET_CREDIT"].includes(String(fd.get("method"))) ? String(fd.get("method")) : "WALLET_CREDIT") as RefundMethod;
    await requestRefund({ paymentId: o.paymentId, orderId, amount, reason, method, actorId: user.id });
    revalidatePath(`/admin/orders/${orderId}`);
    return done(`Refund of ${rs(amount)} requested — finance approves and processes it`);
  });
}

export async function bulkStatusAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.bulk");
    const ids = fd.getAll("ids").map(String).filter(Boolean).slice(0, 500);
    const to = String(fd.get("status")) as OrderStatus;
    if (!ids.length) return fail("Tick the orders first");
    if (!STATUSES.includes(to) || to === "CANCELLED") return fail("Pick a status (cancel orders one by one, with a settlement)");
    const reason = reasonOf(fd);
    const scoped = user.kitchenIds ? (await db.order.findMany({ where: { id: { in: ids }, ...kitchenWhere(user) }, select: { id: true } })).map((o) => o.id) : ids;
    const r = await setOrderStatus(scoped, to, user.id, `Bulk: ${reason}`);
    await audit({ actorId: user.id, action: "order.bulk_status", entity: "Order", summary: `${r.changed.length} → ${to}, ${r.rejected.length} rejected`, reason, after: { to, changed: r.changed, rejected: r.rejected } });
    revalidatePath("/admin/orders");
    const skipped = ids.length - scoped.length;
    const rej = r.rejected.slice(0, 6).map((x) => x.reason).join("; ");
    const msg = `${r.changed.length} updated${r.rejected.length ? ` · ${r.rejected.length} not changed: ${rej}${r.rejected.length > 6 ? " …" : ""}` : ""}${skipped ? ` · ${skipped} outside your kitchen` : ""}`;
    return r.changed.length ? done(msg) : fail(msg);
  });
}

// ───────────── WP-03: staff orders, edits, reassignment ─────────────
// Permission and kitchen scope are re-checked inside src/server/orders-admin.ts as well.

const STAFF_METHODS: PaymentMethod[] = ["CASH", "BANK_TRANSFER", "WALLET", "ESEWA", "KHALTI"];

function methodOf(fd: FormData, key: string, fallback: PaymentMethod = "CASH"): PaymentMethod {
  const v = String(fd.get(key) ?? "");
  return (STAFF_METHODS as string[]).includes(v) ? (v as PaymentMethod) : fallback;
}

/** `<prefix><id>` number inputs → [{ id, qty }] with qty > 0 (or ≥ 0 when `keepZero`). */
function qtyInputs(fd: FormData, prefix: string, keepZero = false) {
  const out: { id: string; qty: number }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith(prefix) || typeof v !== "string" || v.trim() === "") continue;
    const qty = Math.floor(Number(v));
    if (!Number.isFinite(qty) || qty < 0 || (!keepZero && qty === 0)) continue;
    out.push({ id: k.slice(prefix.length), qty: Math.min(qty, 25) });
  }
  return out;
}

function manualInput(fd: FormData) {
  const date = f.date(fd, "date");
  const customer = f.opt(fd, "customerId", 64);
  const address = f.opt(fd, "addressId", 64);
  const lines: CartLine[] = date ? qtyInputs(fd, "qty:").map((l) => ({ kind: "box" as const, id: l.id, date, qty: l.qty })) : [];
  return {
    date,
    customerId: customer && customer !== "new" ? customer : null,
    newCustomer: customer === "new" ? { name: f.str(fd, "nc_name", 120), phone: f.str(fd, "nc_phone", 30), email: f.opt(fd, "nc_email", 200) } : null,
    addressId: address && address !== "new" ? address : null,
    newAddress:
      !address || address === "new"
        ? {
            zoneId: f.str(fd, "na_zone", 64),
            line1: f.str(fd, "na_line1", 200),
            area: f.str(fd, "na_area", 120),
            placeName: f.opt(fd, "na_place", 120),
            landmark: f.opt(fd, "na_landmark", 200),
            instructions: f.opt(fd, "na_instructions", 300),
            type: (f.opt(fd, "na_type", 20) as AddressType | null) ?? "OFFICE",
          }
        : null,
    lines,
  };
}

export async function manualOrderAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.create");
    const m = manualInput(fd);
    if (!m.date) return fail("Pick a delivery date");
    if (!m.lines.length) return fail("Enter a quantity for at least one dabba");
    const couponCode = f.opt(fd, "coupon", 40);
    if (fd.get("intent") === "quote") {
      const q = await quoteManualOrder(user, { customerId: m.customerId, addressId: m.addressId, zoneId: m.newAddress?.zoneId || null, lines: m.lines, couponCode });
      if (!q.ok) return fail(q.error ?? "Couldn't price this order");
      return {
        ok: true,
        message: `Total ${rs(q.total)} (dabbas ${rs(q.subtotal)}, delivery ${rs(q.deliveryFee)}${q.discount ? `, discount −${rs(q.discount)}` : ""}${q.tax ? `, VAT ${rs(q.tax)}` : ""}) · customer pays ${rs(q.customerShare)}${q.companyShare ? ` · company ${rs(q.companyShare)}` : ""}${q.couponError ? ` · coupon: ${q.couponError}` : ""}`,
      };
    }
    const r = await createManualOrder(user, {
      customerId: m.customerId,
      newCustomer: m.newCustomer,
      addressId: m.addressId,
      newAddress: m.newAddress,
      lines: m.lines,
      method: methodOf(fd, "method"),
      slotId: f.opt(fd, "slotId", 64),
      couponCode,
      notes: f.opt(fd, "notes", 500),
      idempotencyKey: f.str(fd, "idempotencyKey", 100),
      reason: f.opt(fd, "reason", 500),
    });
    revalidatePath("/admin/orders");
    return done(r.replayed ? "Already placed — opening it" : `Order ${r.orders.map((o) => o.number).join(", ")} placed`, `/admin/orders/${r.orders[0].id}`);
  });
}

export async function bulkOrderAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.create");
    const date = f.date(fd, "date");
    if (!date) return fail("Pick a delivery date");
    const defaultBox = f.str(fd, "boxId", 64);
    const members = f.all(fd, "member").slice(0, 300);
    if (!members.length) return fail("Tick at least one employee");
    const lines = members.map((memberId) => ({ memberId, boxId: f.str(fd, `box:${memberId}`, 64) || defaultBox, qty: f.int(fd, `qty:${memberId}`, 1, 1, 25) }));
    if (lines.some((l) => !l.boxId)) return fail("Pick a dabba (default or per employee)");
    const r = await createCorporateBulkOrder(user, {
      companyId: f.str(fd, "companyId", 64),
      date,
      lines,
      slotId: f.opt(fd, "slotId", 64),
      memberMethod: fd.get("memberMethod") === "WALLET" ? "WALLET" : "CASH",
      idempotencyKey: f.str(fd, "idempotencyKey", 100),
      notes: f.opt(fd, "notes", 500),
    });
    revalidatePath("/admin/orders");
    const failed = r.results.filter((x) => !x.ok);
    const msg = `${r.totals.orders} order(s) · company ${rs(r.totals.companyShare)} · employees ${rs(r.totals.customerShare)}${failed.length ? ` · ${failed.length} not placed: ${failed.slice(0, 8).map((x) => `${x.name} (${x.message})`).join("; ")}${failed.length > 8 ? " …" : ""}` : ""}`;
    return failed.length === r.results.length ? fail(msg) : done(msg);
  });
}

function deltaMessage(customer: number, company: number, chargeRef?: string | null) {
  const c = customer > 0 ? `extra ${rs(customer)} to collect${chargeRef ? ` (payment ${chargeRef})` : ""}` : customer < 0 ? `${rs(-customer)} back to the customer` : "no price change for the customer";
  return `Saved — ${c}${company ? ` · company share ${company > 0 ? "+" : "−"}${rs(Math.abs(company))}` : ""}`;
}

export async function editLinesAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.edit");
    const items = qtyInputs(fd, "qty:", true).map((x) => ({ itemId: x.id, qty: x.qty }));
    const addBox = f.opt(fd, "addBox", 64);
    const r = await editOrderLines(user, orderId, {
      version: f.int(fd, "version", -1),
      items,
      add: addBox ? [{ kind: "box", id: addBox, qty: f.int(fd, "addQty", 1, 1, 25) }] : [],
      reason: reasonOf(fd),
      chargeMethod: methodOf(fd, "chargeMethod"),
    });
    revalidatePath(`/admin/orders/${orderId}`);
    return done(deltaMessage(r.delta.customer, r.delta.company, r.chargePayment?.reference));
  });
}

export async function substituteAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.edit");
    const [itemId, substitutionId] = f.str(fd, "pick", 140).split("|");
    if (!itemId || !substitutionId) return fail("Pick a substitution");
    const r = await substituteOrderItem(user, orderId, { version: f.int(fd, "version", -1), itemId, substitutionId, reason: reasonOf(fd), chargeMethod: methodOf(fd, "chargeMethod") });
    revalidatePath(`/admin/orders/${orderId}`);
    return done(deltaMessage(r.delta.customer, r.delta.company, r.chargePayment?.reference));
  });
}

export async function reassignKitchenAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.edit");
    await reassignKitchen(user, orderId, { version: f.int(fd, "version", -1), kitchenId: f.str(fd, "kitchenId", 64), slotId: f.opt(fd, "slotId", 64), reason: reasonOf(fd) });
    revalidatePath(`/admin/orders/${orderId}`);
    return done("Moved to the new kitchen");
  });
}

export async function reassignDeliveryAction(orderId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("orders.edit");
    const slot = fd.get("slotId");
    await reassignDelivery(user, orderId, {
      version: f.int(fd, "version", -1),
      slotId: slot === null || slot === "keep" ? undefined : String(slot) === "" ? null : String(slot),
      addressId: f.opt(fd, "addressId", 64),
      reason: reasonOf(fd),
    });
    revalidatePath(`/admin/orders/${orderId}`);
    return done("Delivery updated");
  });
}
