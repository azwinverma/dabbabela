import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { acceptDialogs, DEMO_PASSWORD, login, placeOrder, watchErrors } from "./helpers";
import { db } from "./db";

/**
 * A fresh finance user per run: the seeded finance account would accumulate this test's +Rs 1,000 credit in its
 * rolling-24 h money total (`staffDailyMoneyLimit`, default Rs 5,000) across runs, and after a few runs the adjustment
 * would go to maker-checker approval instead. Deactivated at the end.
 */
async function freshFinanceUser(stamp: string) {
  const email = `finance.e2e.${stamp}@test.local`;
  const user = await db().user.create({ data: { name: `E2E Finance ${stamp}`, email, emailVerified: true, role: "FINANCE" } });
  await db().account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(DEMO_PASSWORD) } });
  return { id: user.id, email };
}

test("support requests a refund, finance approves it and can only process it with a reference (credit stays credit)", async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const financeUser = await freshFinanceUser(stamp);
  test.info().annotations.push({ type: "finance-user", description: financeUser.email });

  // finance tops up the customer's credit (audited ledger adjustment)
  const finance = await (await browser.newContext()).newPage();
  const financeErrors = watchErrors(finance);
  acceptDialogs(finance);
  await login(finance, financeUser.email, DEMO_PASSWORD, "/admin");
  await finance.goto(`/admin/refunds?view=ledger&q=${encodeURIComponent("customer.c@demo.dabbabela.local")}`);
  const fm = finance.locator("main");
  await fm.getByLabel("Amount").fill("+1000");
  await fm.getByLabel("Reason").fill(`E2E top-up ${stamp}`);
  await fm.getByRole("button", { name: "Adjust credit" }).click();
  await expect(fm.getByText(`E2E top-up ${stamp}`)).toBeVisible();

  // customer pays for a dabba with that credit → payment is PAID immediately
  const customer = await (await browser.newContext()).newPage();
  await login(customer, "customer.c@demo.dabbabela.local");
  const { paymentId: walletPaymentId } = await placeOrder(customer, /dabba bela credit/i);
  const walletPayment = await db().payment.findUniqueOrThrow({ where: { id: walletPaymentId } });
  expect(walletPayment.status).toBe("PAID");
  // … and a cash-on-delivery dabba, paid at the door (fixture: what the rider's cash collection records)
  const { paymentId } = await placeOrder(customer);
  await db().$transaction([
    db().payment.update({ where: { id: paymentId }, data: { status: "PAID", paidAt: new Date() } }),
    db().order.updateMany({ where: { paymentId }, data: { paymentStatus: "PAID" } }),
  ]);
  const payment = await db().payment.findUniqueOrThrow({ where: { id: paymentId } });
  await customer.context().close();

  const support = await (await browser.newContext()).newPage();
  const supportErrors = watchErrors(support);
  await login(support, "support@demo.dabbabela.local", undefined, "/admin");
  const sm = support.locator("main");
  // closed-loop credit: what was paid with credit can't come back as a bank transfer
  await support.goto(`/admin/payments/${walletPaymentId}`);
  await sm.getByLabel("Amount").fill("50");
  await sm.getByLabel("Refund method").selectOption("BANK");
  await sm.getByLabel("Reason").fill(`E2E cash-out attempt ${stamp}`);
  await sm.getByRole("button", { name: "Request refund" }).click();
  await expect(sm.getByText(/only be refunded as credit/)).toBeVisible();
  expect(await db().refund.count({ where: { paymentId: walletPaymentId } })).toBe(0);

  // support requests a bank refund of Rs 50 on the cash-paid order
  await support.goto(`/admin/payments/${paymentId}`);
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
  await db().user.update({ where: { id: financeUser.id }, data: { isActive: false } });
});
