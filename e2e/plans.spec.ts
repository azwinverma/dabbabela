import { expect, test } from "@playwright/test";
import { acceptDialogs, login, watchErrors } from "./helpers";
import { db } from "./db";

test("customer starts a plan, skips a day and brings it back, pauses, resumes and cancels", async ({ page }) => {
  const check = watchErrors(page);
  acceptDialogs(page);
  await login(page, "customer.c@demo.dabbabela.local");

  // buy a one-week plan, paid in cash
  await page.goto("/plans/hapta");
  await page.getByRole("radiogroup", { name: "Payment method" }).getByLabel(/cash on delivery/i).check();
  const start = page.getByRole("button", { name: /start this plan/i });
  await expect(start).toBeEnabled({ timeout: 20_000 });
  await start.click();
  await page.waitForURL(/\/(thank-you|pay)\//, { timeout: 30_000 });
  const paymentId = page.url().split("/").pop()!.split("?")[0];
  const pay = await db().payment.findUniqueOrThrow({ where: { id: paymentId }, select: { subscriptionId: true } });
  expect(pay.subscriptionId).toBeTruthy();
  const subId = pay.subscriptionId!;

  await page.goto(`/account/plans/${subId}`);
  const main = page.locator("main");
  await expect(main.getByText("Active", { exact: true })).toBeVisible();

  // skip the first open day, then undo it
  await main.getByRole("button", { name: "Skip this day" }).first().click();
  await expect(main.getByRole("button", { name: "Bring it back" }).first()).toBeVisible();
  expect(await db().order.count({ where: { subscriptionId: subId, status: "SKIPPED" } })).toBe(1);
  await main.getByRole("button", { name: "Bring it back" }).first().click();
  await expect(main.getByRole("button", { name: "Bring it back" })).toHaveCount(0);
  await expect.poll(() => db().order.count({ where: { subscriptionId: subId, status: "SKIPPED" } })).toBe(0);

  // pause → resume
  await main.getByRole("button", { name: "Pause" }).click();
  await expect(main.getByText("Paused", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Resume" }).click();
  await expect(main.getByText("Active", { exact: true })).toBeVisible();
  const changes = await db().subscriptionChange.findMany({ where: { subscriptionId: subId }, select: { type: true } });
  expect(changes.map((c) => c.type)).toEqual(expect.arrayContaining(["SKIP", "UNSKIP", "PAUSE", "RESUME"]));

  // cancel (also keeps reruns from stacking plans on this demo account)
  await main.getByRole("button", { name: "Cancel plan" }).click();
  await main.getByLabel("Why are you cancelling?").fill("E2E test run");
  await main.getByRole("button", { name: "Cancel plan" }).last().click();
  await expect(main.getByText("Cancelled", { exact: true })).toBeVisible();
  check();
});
