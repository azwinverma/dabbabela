import { expect, test } from "@playwright/test";
import { acceptDialogs, login, watchErrors } from "./helpers";
import type { Prisma } from "@prisma/client";
import { db } from "./db";

const KEY = "home.cta";

test("content editor drafts, publishes, sees it live, then rolls back", async ({ page, browser }) => {
  const before = await db().contentSection.findUnique({ where: { key_locale: { key: KEY, locale: "en" } } });
  const stamp = Date.now().toString(36);
  const first = `Lunch is ready ${stamp}`;
  const second = `Dabba time ${stamp}`;
  const check = watchErrors(page);
  acceptDialogs(page);
  try {
    await login(page, "content@demo.dabbabela.local", undefined, "/admin");
    await page.goto(`/admin/content/${KEY}?locale=en`);
    const main = page.locator("main");
    const title = main.getByLabel("Title", { exact: true });

    // draft → nothing on the public site yet
    await title.fill(first);
    await main.getByRole("button", { name: "Save draft" }).click();
    await expect(main.getByText("Draft vs live")).toBeVisible();
    const visitor = await browser.newPage();
    await visitor.goto("/");
    await expect(visitor.getByText(first)).toHaveCount(0);

    // publish v(n+1)
    await page.goto(`/admin/content/${KEY}?locale=en`);
    await main.getByRole("button", { name: "Publish" }).click();
    await expect(main.getByRole("status")).toContainText(/publish/i);
    await visitor.goto("/");
    await expect(visitor.getByText(first)).toBeVisible();

    // publish another version
    await page.goto(`/admin/content/${KEY}?locale=en`);
    await title.fill(second);
    await main.getByRole("button", { name: "Publish" }).click();
    await expect(main.getByRole("status")).toContainText(/publish/i);
    await visitor.goto("/");
    await expect(visitor.getByText(second)).toBeVisible();

    // roll back to the first one
    await page.goto(`/admin/content/${KEY}?locale=en`);
    const row = main.locator("li").filter({ hasText: /publish/ }).filter({ has: page.getByRole("button", { name: "Roll back" }) }).first();
    await row.getByRole("button", { name: "Roll back" }).click();
    await expect(main.getByText(/rollback ·/).first()).toBeVisible();
    await visitor.goto("/");
    await expect(visitor.getByText(first)).toBeVisible();
    await expect(visitor.getByText(second)).toHaveCount(0);
    await visitor.close();
    check();
  } finally {
    // put the dev database back the way it was
    if (!before) await db().contentSection.deleteMany({ where: { key: KEY, locale: "en" } });
    else {
      await db().contentRevision.deleteMany({ where: { sectionId: before.id, version: { gt: before.version } } });
      await db().contentSection.update({ where: { id: before.id }, data: { data: before.data as Prisma.InputJsonValue, draft: (before.draft ?? null) as Prisma.InputJsonValue, version: before.version } });
    }
  }
});
