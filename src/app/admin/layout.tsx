import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { can, ROLE_LABEL } from "@/lib/permissions";
import { db } from "@/lib/db";
import { AdminShell } from "@/components/admin/AdminShell";
import { ADMIN_NAV } from "@/components/admin/nav";
import { signOutAction } from "./_kit/session";

export const metadata: Metadata = { title: "Control room", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const nav = ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(user.role, i.perm)) })).filter((g) => g.items.length);

  const zero = Promise.resolve(0);
  const [leads, messages, tickets, pendingPay, refunds, failedMsgs, kitchen] = await Promise.all([
    can(user.role, "leads") ? db.corporateLead.count({ where: { status: "NEW" } }) : zero,
    can(user.role, "support") ? db.contactMessage.count({ where: { isRead: false, isArchived: false } }) : zero,
    can(user.role, "support") ? db.supportTicket.count({ where: { status: "OPEN" } }) : zero,
    can(user.role, "payments.verify") ? db.payment.count({ where: { status: "PENDING", method: "BANK_TRANSFER", proofUrl: { not: null } } }) : zero,
    can(user.role, "refunds.approve") ? db.refund.count({ where: { status: { in: ["REQUESTED", "APPROVED"] } } }) : zero,
    can(user.role, "settings") ? db.outboundMessage.count({ where: { status: "FAILED" } }) : zero,
    user.kitchenId ? db.kitchen.findUnique({ where: { id: user.kitchenId }, select: { name: true } }) : Promise.resolve(null),
  ]);

  return (
    <AdminShell
      nav={nav}
      user={{ name: user.name, email: user.email, role: user.role }}
      roleLabel={ROLE_LABEL[user.role]}
      kitchen={kitchen?.name ?? null}
      twoFactor={Boolean(user.twoFactorEnabled)}
      logoutAction={signOutAction}
      badges={{
        "/admin/leads": leads,
        "/admin/messages": messages,
        "/admin/support": tickets,
        "/admin/payments": pendingPay,
        "/admin/refunds": refunds,
        "/admin/notifications": failedMsgs,
      }}
    >
      {children}
    </AdminShell>
  );
}
