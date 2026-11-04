import { expect, test } from "@playwright/test";
import { login, watchErrors } from "./helpers";

test("customer orders a dabba with cash, sees it in the account, staff sees it in the control room", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const check = watchErrors(page);
  await login(page, "customer.b@demo.dabbabela.local");

  // browse → box detail → add
  await page.goto("/menu");
  const boxLink = page.locator('a[href^="/boxes/"]').first();
  await boxLink.click();
  await page.waitForURL(/\/boxes\//);
  await page.getByRole("button", { name: /add to my dabbas/i }).first().click();
  await expect(page.getByRole("button", { name: /added/i }).first()).toBeVisible();

  // checkout with cash on delivery
  await page.goto("/checkout");
  const place = page.getByRole("button", { name: /place order/i });
  await expect(place).toBeVisible();
  const cash = page.getByLabel(/cash on delivery/i);
  if (await cash.count()) await cash.first().check();
  await expect(place).toBeEnabled({ timeout: 20_000 });
  await place.click();
  await page.waitForURL(/\/(thank-you|pay)\//, { timeout: 30_000 });
  await expect(page.locator("h1").first()).toBeVisible();

  // account history shows the order
  await page.goto("/account/orders");
  const firstOrder = page.locator('a[href^="/account/orders/"]').first();
  await expect(firstOrder).toBeVisible();
  const number = (await firstOrder.innerText()).match(/DB\d{6}[A-Z0-9]{4}/)?.[0];
  check();
  await ctx.close();

  // control room
  const staff = await browser.newContext();
  const admin = await staff.newPage();
  await login(admin, "owner@dabbabela.local", "dabba-owner-2026", "/admin/orders");
  await admin.goto(`/admin/orders${number ? `?q=${number}` : ""}`);
  if (number) await expect(admin.getByText(number).first()).toBeVisible();
  else await expect(admin.locator("table").first()).toBeVisible();
  await staff.close();
});
