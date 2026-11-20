import { expect, test } from "@playwright/test";
import { acceptDialogs, login, OWNER, watchErrors } from "./helpers";
import { dateOnly, db, todayKtm } from "./db";

/**
 * Bandh / disruption wizard in the browser (Phase 2C): preview affected orders for a day + kitchen → the confirmation
 * box is required → run it → the day is closed for that kitchen, its live orders are settled (unpaid ones cancelled),
 * and the run is audited.
 *
 * Fixture: a throwaway kitchen with one unpaid SCHEDULED order (cloned from any order in the seeded dev database) on a
 * service day ~12 days out, so no real kitchen or order is touched. The kitchen is deactivated afterwards.
 */
test("ops previews a bandh day and runs the disruption for one kitchen", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const d = db();
  let day = new Date(dateOnly(todayKtm()).getTime() + 12 * 86400_000);
  if (day.getUTCDay() === 6) day = new Date(day.getTime() + 86400_000); // Saturday is not a service day
  const date = day.toISOString().slice(0, 10);

  const kitchen = await d.kitchen.create({ data: { name: `E2E Bandh Kitchen ${stamp}`, code: `EB${stamp}`.toUpperCase().slice(0, 12), isActive: true } });
  const template = await d.order.findFirstOrThrow({ where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" } });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, number, createdAt, updatedAt, invoiceId, paymentId, companyId, attribution, officeLocationId, campaignId, subscriptionId, slotId, slotLabel, ...rest } = template;
  const order = await d.order.create({
    data: { ...rest, number: `E2E-B-${stamp}`.toUpperCase(), kitchenId: kitchen.id, deliveryDate: dateOnly(date), status: "SCHEDULED", paymentStatus: "UNPAID", refundedAmount: 0, version: 0 },
  });

  try {
    const errors = watchErrors(page);
    acceptDialogs(page);
    await login(page, OWNER.email, OWNER.password, "/admin");
    await page.goto("/admin/holidays");
    const main = page.locator("main");
    await main.getByLabel("Date with orders").fill(date);
    await main.getByLabel("Kitchen", { exact: true }).last().selectOption({ label: kitchen.name });
    await main.getByRole("button", { name: "Preview affected orders" }).click();
    await page.waitForURL(/disrupt=/);
    await expect(main.getByText(/1 order\(s\) affected/)).toBeVisible();
    await expect(main.getByText(order.number)).toBeVisible();

    await main.getByLabel("Reason (customers see this)").fill(`E2E bandh ${stamp}`);
    await main.getByLabel("What happens to orders").selectOption("CREDIT");
    // Without the confirmation tick nothing happens.
    await main.getByRole("button", { name: "Run disruption" }).click();
    await expect(main.getByText("Tick the confirmation box")).toBeVisible();
    expect((await d.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SCHEDULED");

    // The form is reset after a refused submit (React form actions), so fill it again.
    await main.getByLabel("Reason (customers see this)").fill(`E2E bandh ${stamp}`);
    await main.getByLabel("What happens to orders").selectOption("CREDIT");
    await main.getByRole("checkbox").check();
    await main.getByRole("button", { name: "Run disruption" }).click();
    // The page revalidates: the day now has no live orders left for that kitchen.
    await expect.poll(async () => (await d.order.findUniqueOrThrow({ where: { id: order.id } })).status, { timeout: 20_000 }).toBe("CANCELLED");
    await expect(main.getByText(/0 order\(s\) affected/)).toBeVisible();
    const closed = await d.holiday.findFirst({ where: { date: dateOnly(date), kitchenId: kitchen.id } });
    expect(closed?.kind).toBe("BANDH");
    expect(await d.auditLog.count({ where: { action: "service.disruption", summary: { contains: `E2E bandh ${stamp}` } } })).toBe(1);
    errors();
  } finally {
    await d.kitchen.update({ where: { id: kitchen.id }, data: { isActive: false } });
  }
});
