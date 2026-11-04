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

test.describe("custom roles", () => {
  const roleName = `E2E stock helper ${Date.now().toString(36)}`;
  test.afterAll(async () => {
    const { db } = await import("./db");
    const role = await db().staffRole.findFirst({ where: { name: roleName } });
    if (role) {
      await db().user.updateMany({ where: { staffRoleId: role.id }, data: { staffRoleId: null } });
      await db().staffRole.delete({ where: { id: role.id } });
    }
  });

  test("a super admin grants a chef inventory access through a custom role", async ({ browser }) => {
    const { db } = await import("./db");
    const { OWNER } = await import("./helpers");
    const chef = await db().user.findUniqueOrThrow({ where: { email: "chef@demo.dabbabela.local" } });

    // Before: the chef can't open inventory.
    const chefCtx = await browser.newContext();
    const chefPage = await chefCtx.newPage();
    await login(chefPage, chef.email, undefined, "/admin/kitchen");
    await chefPage.goto("/admin/inventory");
    await expect(chefPage).toHaveURL(/\/admin\/forbidden/);

    // Super admin creates the role with one extra permission and assigns it.
    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    await login(admin, OWNER.email, OWNER.password, "/admin/roles");
    await admin.goto("/admin/roles");
    const create = admin.locator("form", { has: admin.getByRole("button", { name: "Create role" }) });
    await create.getByLabel("Name", { exact: true }).fill(roleName);
    await create.getByLabel("Inventory & stock: View").check();
    await create.getByRole("button", { name: "Create role" }).click();
    await admin.waitForURL(/\/admin\/roles\/[a-z0-9]+$/);
    await expect(admin.getByRole("heading", { name: roleName })).toBeVisible();

    await admin.goto(`/admin/staff/${chef.id}`);
    const assign = admin.locator("form", { has: admin.getByLabel("Custom role (extra permissions)") });
    await assign.getByLabel("Custom role (extra permissions)").selectOption({ label: roleName });
    await assign.getByRole("button", { name: "Save" }).click();
    await expect(admin.getByText("Custom role saved")).toBeVisible();
    await expect(admin.getByText("Inventory & stock")).toBeVisible(); // effective permissions summary

    // After: same chef session, no re-login — permissions are read fresh each request.
    await chefPage.goto("/admin/inventory");
    await expect(chefPage).toHaveURL(/\/admin\/inventory/);
    await expect(chefPage.getByRole("navigation").getByRole("link", { name: "Inventory" })).toBeVisible();
    // View only: the chef still can't open finance.
    await chefPage.goto("/admin/invoices");
    await expect(chefPage).toHaveURL(/\/admin\/forbidden/);

    // The chef's sign-in shows up in their login activity.
    await admin.reload();
    await expect(admin.getByRole("cell", { name: "email" }).first()).toBeVisible();
    await chefCtx.close();
    await adminCtx.close();
  });

  test("non-super-admins can't open the role editor", async ({ page }) => {
    await login(page, "ops@demo.dabbabela.local", undefined, "/admin");
    await page.goto("/admin/roles");
    await expect(page).toHaveURL(/\/admin\/forbidden/);
  });
});
