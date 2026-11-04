import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("anonymous visitors are sent to log in", async ({ page }) => {
  await page.goto("/admin/orders");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("a chef can't open dispatch or finance", async ({ page }) => {
  await login(page, "chef@demo.dabbabela.local", undefined, "/admin/kitchen");
  await page.goto("/admin/dispatch");
  await expect(page).toHaveURL(/\/admin\/forbidden/);
  await page.goto("/admin/invoices");
  await expect(page).toHaveURL(/\/admin\/forbidden/);
  await page.goto("/admin/kitchen");
  await expect(page).toHaveURL(/\/admin\/kitchen/);
});

test("a customer can't open the control room or another company's team portal", async ({ page }) => {
  await login(page, "customer.b@demo.dabbabela.local");
  await page.goto("/admin");
  await expect(page).not.toHaveURL(/\/admin(\/|$)(?!forbidden)/);
  await page.goto("/team");
  await expect(page).not.toHaveURL(/\/team$/);
});

test("a rider only sees the rider app", async ({ page }) => {
  await login(page, "rider@demo.dabbabela.local", undefined, "/rider");
  await page.goto("/rider");
  await expect(page).toHaveURL(/\/rider/);
  await page.goto("/admin/orders");
  await expect(page).toHaveURL(/\/admin\/forbidden/);
});
