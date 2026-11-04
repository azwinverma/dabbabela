import { expect, test } from "@playwright/test";
import { acceptDialogs, login, placeOrder, watchErrors } from "./helpers";
import { db } from "./db";

test("support requests a refund, finance approves it and can only process it with a reference", async ({ browser }) => {
  const stamp = Date.now().toString(36);

  // finance tops up the customer's credit (audited ledger adjustment)
  const finance = await (await browser.newContext()).newPage();
  const financeErrors = watchErrors(finance);
  acceptDialogs(finance);
  await login(finance, "finance@demo.dabbabela.local", undefined, "/admin");
  await finance.goto(`/admin/refunds?view=ledger&q=${encodeURIComponent("customer.c@demo.dabbabela.local")}`);
  const fm = finance.locator("main");
  await fm.getByLabel("Amount").fill("+1000");
  await fm.getByLabel("Reason").fill(`E2E top-up ${stamp}`);
  await fm.getByRole("button", { name: "Adjust credit" }).click();
  await expect(fm.getByText(`E2E top-up ${stamp}`)).toBeVisible();

  // customer pays for a dabba with that credit → payment is PAID immediately
  const customer = await (await browser.newContext()).newPage();
  await login(customer, "customer.c@demo.dabbabela.local");
  const { paymentId } = await placeOrder(customer, /dabba bela credit/i);
  const payment = await db().payment.findUniqueOrThrow({ where: { id: paymentId } });
  expect(payment.status).toBe("PAID");
  await customer.context().close();

  // support requests a bank refund of Rs 50 from the payment page
  const support = await (await browser.newContext()).newPage();
  const supportErrors = watchErrors(support);
  await login(support, "support@demo.dabbabela.local", undefined, "/admin");
  await support.goto(`/admin/payments/${paymentId}`);
  const sm = support.locator("main");
  await sm.getByLabel("Amount").fill("50");
  await sm.getByLabel("Refund method").selectOption("BANK");
  await sm.getByLabel("Reason").fill(`E2E refund ${stamp}`);
  await sm.getByRole("button", { name: "Request refund" }).click();
  await expect(sm.getByRole("status")).toBeVisible();
  await support.goto("/admin/refunds");
  const supportRow = sm.locator("tr").filter({ hasText: payment.reference });
  await expect(supportRow).toContainText("Waiting for finance");
  await expect(supportRow.getByRole("button", { name: "Approve" })).toHaveCount(0);
  supportErrors();
  await support.context().close();

  // finance approves …
  await finance.goto("/admin/refunds");
  await fm.locator("tr").filter({ hasText: payment.reference }).getByRole("button", { name: "Approve" }).click();
  await expect.poll(async () => (await db().refund.findFirstOrThrow({ where: { paymentId } })).status).toBe("APPROVED");

  // … and cannot mark it processed without proof, then can with the bank reference
  await finance.goto("/admin/refunds?view=APPROVED");
  const row = fm.locator("tr").filter({ hasText: payment.reference });
  await row.getByRole("button", { name: "Mark processed" }).click();
  await expect(row.getByRole("alert")).toBeVisible();
  expect((await db().refund.findFirstOrThrow({ where: { paymentId } })).status).toBe("APPROVED");
  await row.getByLabel("Transaction reference").fill(`BANK-${stamp}`);
  await row.getByRole("button", { name: "Mark processed" }).click();
  await expect.poll(async () => (await db().refund.findFirstOrThrow({ where: { paymentId } })).status).toBe("PROCESSED");
  const refund = await db().refund.findFirstOrThrow({ where: { paymentId } });
  expect(refund.providerRef).toBe(`BANK-${stamp}`);
  expect(refund.amount).toBe(5000);
  expect((await db().payment.findUniqueOrThrow({ where: { id: paymentId } })).refundedAmount).toBe(5000);
  financeErrors();
  await finance.context().close();
});
