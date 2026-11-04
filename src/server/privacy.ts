import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Privacy requests.
 * EXPORT: everything we hold about a person as JSON.
 * DELETE: anonymise personal data. Orders, payments, invoices and the credit ledger are kept
 * (tax/accounting retention) but no longer point to identifiable details.
 */
export async function exportUserData(userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      addresses: true,
      membership: { include: { company: { select: { name: true } } } },
      orders: { include: { items: { select: { name: true, quantity: true, unitPrice: true, details: true } } }, orderBy: { deliveryDate: "desc" } },
      subscriptions: { include: { plan: { select: { name: true } } } },
      payments: { select: { reference: true, method: true, status: true, amount: true, refundedAmount: true, paidAt: true, createdAt: true } },
      credits: { select: { amount: true, reason: true, note: true, createdAt: true } },
      tickets: { include: { messages: { where: { internal: false }, select: { body: true, createdAt: true } } } },
      feedback: true,
      notifications: { select: { title: true, body: true, createdAt: true, readAt: true } },
      notificationPrefs: true,
      customBoxes: true,
      favorites: true,
    },
  });
  return {
    exportedAt: new Date().toISOString(),
    note: "Personal data held by Dabba Bela. Amounts are in paisa (Rs 1 = 100).",
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
      lastLoginAt: user.lastLoginAt,
    },
    company: user.membership ? { company: user.membership.company.name, role: user.membership.role, department: user.membership.department } : null,
    addresses: user.addresses.map((a) => ({ label: a.label, type: a.type, recipientName: a.recipientName, phone: a.phone, placeName: a.placeName, line1: a.line1, area: a.area, ward: a.ward, landmark: a.landmark, instructions: a.instructions })),
    orders: user.orders.map((o) => ({ number: o.number, date: o.deliveryDate, status: o.status, total: o.total, items: o.items, address: `${o.addressLine}, ${o.area}` })),
    plans: user.subscriptions.map((s) => ({ reference: s.reference, plan: s.plan.name, status: s.status, startDate: s.startDate, endDate: s.endDate, total: s.total })),
    payments: user.payments,
    credit: user.credits,
    savedDabbas: user.customBoxes.map((c) => ({ name: c.name, items: c.items })),
    supportTickets: user.tickets.map((t) => ({ number: t.number, subject: t.subject, status: t.status, messages: t.messages })),
    feedback: user.feedback.map((f) => ({ rating: f.rating, comment: f.comment, createdAt: f.createdAt })),
    notifications: user.notifications,
    notificationPreferences: user.notificationPrefs.map((p) => ({ topic: p.topic, channel: p.channel, enabled: p.enabled })),
  };
}

export async function anonymiseUser(userId: string, actorId: string, reason: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.role !== "CUSTOMER") throw new Error("Staff accounts must be demoted to customer before deletion");
  if (u.deletedAt) return u;
  const out = await db.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.twoFactor.deleteMany({ where: { userId } });
    await tx.companyMember.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.notificationPreference.deleteMany({ where: { userId } });
    await tx.customBox.deleteMany({ where: { userId } });
    await tx.favorite.deleteMany({ where: { userId } });
    await tx.address.updateMany({
      where: { userId },
      data: { label: "Removed", recipientName: "Deleted customer", phone: "", placeName: null, line1: "Removed", landmark: null, lat: null, lng: null, instructions: null, archivedAt: new Date(), isDefault: false },
    });
    // Order snapshots keep area/zone for operations history but lose contact details.
    await tx.order.updateMany({
      where: { userId },
      data: { contactName: "Deleted customer", contactPhone: "", placeName: null, addressLine: "Removed", landmark: null, lat: null, lng: null, instructions: null, notes: null, allergenNote: null },
    });
    await tx.feedback.updateMany({ where: { userId }, data: { comment: null, publishConsent: false } });
    await tx.supportTicket.updateMany({ where: { userId }, data: { name: null, email: null, phone: null } });
    return tx.user.update({
      where: { id: userId },
      data: {
        name: "Deleted customer",
        email: `deleted+${userId}@invalid`,
        emailVerified: false,
        phoneNumber: null,
        phoneNumberVerified: false,
        image: null,
        isActive: false,
        allergies: [],
        dietaryNotes: null,
        internalNote: null,
        marketingOptIn: false,
        deletedAt: new Date(),
      },
    });
  });
  await audit({ actorId, action: "privacy.delete", entity: "User", entityId: userId, summary: "Personal data anonymised", reason });
  return out;
}

export async function completeDataRequest(requestId: string, actorId: string, note?: string) {
  const r = await db.dataRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (r.status !== "OPEN") throw new Error("Request already handled");
  if (r.type === "DELETE") await anonymiseUser(r.userId, actorId, note || "Customer request");
  return db.dataRequest.update({ where: { id: requestId }, data: { status: "DONE", handledById: actorId, completedAt: new Date(), note } });
}

export async function rejectDataRequest(requestId: string, actorId: string, note: string) {
  if (!note.trim()) throw new Error("Explain why");
  await audit({ actorId, action: "privacy.reject", entity: "DataRequest", entityId: requestId, reason: note });
  return db.dataRequest.update({ where: { id: requestId }, data: { status: "REJECTED", handledById: actorId, completedAt: new Date(), note } });
}
