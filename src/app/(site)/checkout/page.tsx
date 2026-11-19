import type { Metadata } from "next";
import { requireUser, activeCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { availableMethods } from "@/server/payments/methods";
import { walletBalance } from "@/server/ledger";
import { zoneSlots } from "@/server/coverage";
import { toAddressViews } from "../account/_lib/view";
import { CheckoutClient } from "./CheckoutClient";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const user = await requireUser("/checkout");
  const [settings, locale, allSlots, balance, closedKitchens] = await Promise.all([
    getSettings(),
    getLocale(),
    db.deliverySlot.findMany({ where: { isActive: true, kitchen: { isActive: true } }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true, kitchenId: true } }),
    walletBalance(user.id),
    // Kitchens that aren't taking orders (WP-07 status): explain instead of offering windows checkout would refuse.
    db.kitchen.findMany({ where: { OR: [{ isActive: false }, { status: { not: "OPEN" } }] }, select: { id: true, name: true, status: true, statusNote: true } }),
  ]);
  const kitchenNotes: Record<string, string> = Object.fromEntries(
    closedKitchens.map((k) => [k.id, `${k.name} ${k.status === "PAUSED" ? "has paused new orders" : "isn't taking orders right now"}${k.statusNote ? ` — ${k.statusNote}` : ""}.`]),
  );
  const slots = allSlots.filter((s) => !kitchenNotes[s.kitchenId]);
  // Delivery windows per zone of the customer's addresses (zone time windows, WP-13).
  const zoneSlotIds: Record<string, string[]> = {};
  for (const a of user.addresses) if (a.zone?.isActive && a.zoneId) zoneSlotIds[a.zoneId] = zoneSlots(a.zone, slots).map((s) => s.id);
  const company = activeCompany(user);
  const methods = await availableMethods(settings, { hasCompany: Boolean(company), customerShare: 1 });
  return (
    <section className="container py-8 md:py-12">
      <h1 className="text-3xl font-extrabold md:text-4xl">{accountDict(locale).checkout.title}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Same-day orders close at {settings.orderCutoff}. Prices and delivery are re-checked on our side before you pay.
      </p>
      <CheckoutClient
        t={accountDict(locale).checkout}
        addresses={toAddressViews(user)}
        slots={slots}
        zoneSlotIds={zoneSlotIds}
        kitchenNotes={kitchenNotes}
        methods={methods}
        walletBalance={balance}
        user={{ name: user.name, phone: user.phoneNumber ?? "", allergies: user.allergies }}
        company={company ? { name: company.name } : null}
      />
    </section>
  );
}
