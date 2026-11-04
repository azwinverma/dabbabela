import { expect, test } from "@playwright/test";
import { watchErrors } from "./helpers";

const PAGES = ["/", "/menu", "/build", "/plans", "/delivery-areas", "/corporate", "/about", "/faq", "/contact", "/journal", "/info/allergens"];

for (const path of PAGES) {
  test(`renders ${path} without errors`, async ({ page }) => {
    const check = watchErrors(page);
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    check();
  });
}

test("unknown pages return 404", async ({ page }) => {
  const res = await page.goto("/this-does-not-exist");
  expect(res?.status()).toBe(404);
});

test("coverage lookup finds a served area and flags an unserved one", async ({ page }) => {
  await page.goto("/delivery-areas?q=Baneshwor");
  await expect(page.getByText(/Baneshwor/).first()).toBeVisible();
  await page.goto("/delivery-areas?q=Biratnagar");
  await expect(page.getByText(/not .*yet|don't deliver|yet/i).first()).toBeVisible();
});

test("switches to Nepali and back", async ({ page, context }) => {
  await context.addCookies([{ name: "lang", value: "ne", url: page.url() === "about:blank" ? (process.env.E2E_BASE_URL ?? "http://localhost:3100") : page.url() }]);
  await page.goto("/menu");
  await expect(page.locator("html")).toHaveAttribute("lang", "ne");
  await expect(page.locator("main h1").first()).toBeVisible();
  await expect(page.locator("main")).toContainText(/[\u0900-\u097F]/);
});
