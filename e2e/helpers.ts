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
