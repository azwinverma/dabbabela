import { expect, test } from "@playwright/test";
import { login, watchErrors } from "./helpers";
import { dateOnly, db } from "./db";

test("company admin orders lunch for a team member; the company/staff split is applied", async ({ page }) => {
  const check = watchErrors(page);
  await login(page, "customer.a@demo.dabbabela.local", undefined, "/team");
  await page.goto("/team/order");
  const main = page.locator("main");

  // furthest open day, so the run doesn't collide with other tests' days
  const days = main.getByRole("form", { name: "Delivery date" }).getByRole("button");
  await days.last().click();
  await page.waitForURL(/date=\d{4}-\d{2}-\d{2}/);
  const date = new URL(page.url()).searchParams.get("date")!;

  await main.getByLabel(/Sample Customer D/).check();
  await main.getByRole("button", { name: /^Order 1 dabbas$/ }).click();
  await expect(main.getByRole("listitem").filter({ hasText: "Sample Customer D" })).toContainText(/✓ Sample Customer D: (Order DB|Already ordered)/);

  const member = await db().user.findUniqueOrThrow({ where: { email: "customer.d@demo.dabbabela.local" }, select: { id: true } });
  const admin = await db().user.findUniqueOrThrow({ where: { email: "customer.a@demo.dabbabela.local" }, select: { id: true } });
  const order = await db().order.findFirstOrThrow({ where: { userId: member.id, deliveryDate: dateOnly(date), source: "CORPORATE" }, orderBy: { createdAt: "desc" } });
  expect(order.placedById).toBe(admin.id);
  expect(order.companyId).toBeTruthy();
  expect(order.companyShare).toBeGreaterThan(0);
  expect(order.companyShare + order.customerShare).toBe(order.total);
  check();
});
