import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { todayKTM } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** The signed-in customer's own data as JSON (no secrets: no password hashes, tokens or session ids). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Log in first" }, { status: 401 });
  const [orders, subscriptions, payments, credit, feedback, tickets, customBoxes, notifications] = await Promise.all([
    db.order.findMany({ where: { userId: user.id }, include: { items: { select: { name: true, quantity: true, unitPrice: true, lineTotal: true, components: true } }, events: { select: { toStatus: true, note: true, createdAt: true } } }, orderBy: { createdAt: "asc" } }),
    db.subscription.findMany({ where: { userId: user.id }, include: { plan: { select: { name: true } }, changes: true } }),
    db.payment.findMany({ where: { userId: user.id }, select: { reference: true, method: true, status: true, amount: true, refundedAmount: true, paidAt: true, createdAt: true } }),
    db.creditLedger.findMany({ where: { userId: user.id }, select: { amount: true, reason: true, note: true, createdAt: true } }),
    db.feedback.findMany({ where: { userId: user.id } }),
    db.supportTicket.findMany({ where: { userId: user.id }, include: { messages: { where: { internal: false }, select: { body: true, createdAt: true, authorId: true } } } }),
    db.customBox.findMany({ where: { userId: user.id } }),
    db.notification.findMany({ where: { userId: user.id }, select: { title: true, body: true, createdAt: true, readAt: true } }),
  ]);
  const body = {
    exportedAt: new Date().toISOString(),
    note: "Amounts are in paisa (100 paisa = Rs 1).",
    profile: {
      name: user.name,
      email: user.email,
      phone: user.phoneNumber,
      locale: user.locale,
      diet: user.diet,
      spiceTolerance: user.spiceTolerance,
      allergies: user.allergies,
      avoidOnionGarlic: user.avoidOnionGarlic,
      dietaryNotes: user.dietaryNotes,
      marketingOptIn: user.marketingOptIn,
      createdAt: user.createdAt,
      company: user.membership ? { name: user.membership.company.name, status: user.membership.status, role: user.membership.role, department: user.membership.department } : null,
    },
    addresses: user.addresses.map(({ zone: _z, userId: _u, ...a }) => a),
    orders,
    subscriptions,
    payments,
    credit,
    feedback,
    supportTickets: tickets,
    savedDabbas: customBoxes,
    notifications,
  };
  await audit({ actorId: user.id, action: "privacy.export", entity: "User", entityId: user.id });
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dabba-bela-my-data-${todayKTM()}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
