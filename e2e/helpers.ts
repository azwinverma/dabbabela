import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "demo-pass-123";

export async function login(page: Page, email: string, password = DEMO_PASSWORD, next = "/account") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  const main = page.locator("main");
  await main.getByLabel("Email", { exact: true }).fill(email);
  await main.getByLabel("Password", { exact: true }).fill(password);
  await main.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
}

/** Fail the test if the page throws or logs a console error. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource.*(404|401)/i.test(m.text())) errors.push(m.text());
  });
  return () => expect(errors, errors.join("\n")).toEqual([]);
}

export const OWNER = { email: "owner@dabbabela.local", password: "dabba-owner-2026" };

/** Server actions guarded by window.confirm() — accept every dialog on this page. */
export function acceptDialogs(page: Page) {
  page.on("dialog", (d) => void d.accept());
}

/**
 * Customer adds the first dabba on the menu (for the earliest open day) and checks out.
 * Returns the order number shown in the account. `method` is the visible payment label.
 */
export async function placeOrder(page: Page, method: RegExp = /cash on delivery/i) {
  await page.goto("/menu");
  await page.locator('a[href^="/boxes/"]').first().click();
  await page.waitForURL(/\/boxes\//);
  await page.getByRole("button", { name: /add to my dabbas/i }).first().click();
  await expect(page.getByRole("button", { name: /added/i }).first()).toBeVisible();
  await page.goto("/checkout");
  const place = page.getByRole("button", { name: /place order/i });
  await expect(place).toBeVisible();
  await page.getByRole("radiogroup", { name: "Payment method" }).getByLabel(method).check();
  await expect(place).toBeEnabled({ timeout: 20_000 });
  await place.click();
  await page.waitForURL(/\/(thank-you|pay)\//, { timeout: 30_000 });
  const paymentId = page.url().split("/").pop()!.split("?")[0];
  return { paymentId };
}
