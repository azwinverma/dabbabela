import { expect, test } from "@playwright/test";
import { acceptDialogs, login, OWNER, watchErrors } from "./helpers";
import { dateOnly, db, todayKtm } from "./db";

/**
 * Company invoices in the browser (Phase 2C): generate a draft for a company's delivered, company-paid meal →
 * issue it → record a dated receipt (method, reference, received date) → the receipt shows on the invoice and in the
 * company's "Payments received" history, and an `InvoiceReceipt` row exists.
 *
 * Fixture: a fresh company plus one DELIVERED order two days ago (cloned from any existing order in the seeded dev
 * database, so it needs at least one order — the demo seed has many), company share Rs 180, not invoiced.
 */
test("finance generates a company invoice, issues it and records a receipt", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const d = db();
  const twoDaysAgo = new Date(dateOnly(todayKtm()).getTime() - 2 * 86400_000).toISOString().slice(0, 10);

  const company = await d.company.create({ data: { name: `E2E Invoices ${stamp}`, slug: `e2e-invoices-${stamp}`, billingMode: "COMPANY_PAID", invoiceTermsDays: 15, isActive: true } });
  const template = await d.order.findFirstOrThrow({ where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" } });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, number, createdAt, updatedAt, invoiceId, paymentId, companyId, attribution, officeLocationId, campaignId, ...rest } = template;
  const order = await d.order.create({
    data: {
      ...rest,
      number: `E2E-${stamp}`.toUpperCase(),
      companyId: company.id,
      deliveryDate: dateOnly(twoDaysAgo),
      status: "DELIVERED",
      paymentStatus: "PAID",
      companyShare: 180_00,
      customerShare: 0,
      subtotal: 180_00,
      discount: 0,
      deliveryFee: 0,
      tax: 0,
      total: 180_00,
      refundedAmount: 0,
    },
  });

  const errors = watchErrors(page);
  acceptDialogs(page);
  await login(page, OWNER.email, OWNER.password, "/admin");
  await page.goto("/admin/invoices");
  const main = page.locator("main");
  await main.locator('select[name="companyId"]').selectOption({ label: company.name });
  await main.locator('input[name="periodStart"]').fill(twoDaysAgo);
  await main.locator('input[name="periodEnd"]').fill(todayKtm());
  await main.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(/\/admin\/invoices\/[a-z0-9]+$/, { timeout: 20_000 });

  const invoice = await d.invoice.findFirstOrThrow({ where: { companyId: company.id } });
  expect(invoice.status).toBe("DRAFT");
  expect(invoice.total).toBe(180_00);
  expect((await d.order.findUniqueOrThrow({ where: { id: order.id } })).invoiceId).toBe(invoice.id);

  await main.getByRole("button", { name: "Issue invoice" }).click();
  await expect.poll(async () => (await d.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("ISSUED");
  await page.reload();

  await main.getByLabel("Amount", { exact: true }).fill("100");
  await main.getByLabel("Received by").selectOption("CHEQUE");
  await main.getByLabel("Reference").fill(`CHQ-${stamp}`);
  await main.getByLabel("Receipt note").fill("E2E deposit");
  await main.getByRole("button", { name: "Record payment" }).click();
  await expect.poll(async () => d.invoiceReceipt.count({ where: { invoiceId: invoice.id } })).toBe(1);

  const receipt = await d.invoiceReceipt.findFirstOrThrow({ where: { invoiceId: invoice.id } });
  expect(receipt).toMatchObject({ amount: 100_00, method: "CHEQUE", reference: `CHQ-${stamp}`, note: "E2E deposit" });
  expect((await d.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PARTIALLY_PAID");
  await page.reload();
  await expect(main.getByRole("list", { name: "Receipts" })).toContainText(`CHQ-${stamp}`);

  // Company page: dated history from the receipt.
  await page.goto(`/admin/companies/${company.id}?tab=invoices`);
  await expect(main.getByText(new RegExp(`Cheque · CHQ-${stamp}`)).first()).toBeVisible();
  errors();

  await d.company.update({ where: { id: company.id }, data: { isActive: false } });
});

/**
 * Online invoice payment (purpose INVOICE): the company admin sees the outstanding balance with eSewa/Khalti and the
 * bank details on the invoice; starting eSewa creates a PENDING payment for exactly the balance and posts the signed
 * form to eSewa (intercepted — the sandbox gateway can't complete in E2E; verification is covered by
 * tests/integration/invoice-payment.test.ts). The fixture invoice is voided afterwards (it would count toward the
 * demo company's outstanding balance in other specs).
 */
test("company admin pays an issued invoice online (eSewa start) and sees bank details", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const d = db();
  const admin = await d.user.findUniqueOrThrow({ where: { email: "customer.a@demo.dabbabela.local" }, select: { id: true, membership: { select: { companyId: true, role: true } } } });
  expect(admin.membership?.role).toBe("ADMIN");
  const today = todayKtm();
  const invoice = await d.invoice.create({
    data: {
      number: `INV-E2E-PAY-${stamp}`.toUpperCase(),
      companyId: admin.membership!.companyId,
      status: "PARTIALLY_PAID",
      periodStart: dateOnly(today),
      periodEnd: dateOnly(today),
      billingName: "E2E online pay",
      subtotal: 250_00,
      total: 250_00,
      paidAmount: 50_00,
      issuedAt: new Date(),
      dueDate: dateOnly(today),
    },
  });
  try {
    const errors = watchErrors(page);
    await page.route(/esewa\.com\.np/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>eSewa sandbox (intercepted)</body></html>" }));
    await login(page, "customer.a@demo.dabbabela.local", undefined, "/team");
    await page.goto("/team/invoices");
    await page.locator("main").getByRole("row").filter({ hasText: invoice.number }).getByRole("link", { name: "Pay" }).click();
    await page.waitForURL(new RegExp(`/team/invoices/${invoice.id}`));
    const panel = page.getByTestId("invoice-pay");
    await expect(panel).toContainText("Pay Rs 200 online");
    await expect(panel).toContainText("Or pay by bank transfer");
    const esewa = panel.getByRole("button", { name: "Pay with eSewa" });
    if (await esewa.count()) {
      await esewa.click();
      await page.waitForURL(/esewa\.com\.np/, { timeout: 20_000 });
      const p = await d.payment.findFirstOrThrow({ where: { purpose: "INVOICE", idempotencyKey: { startsWith: `invoice:${invoice.id}:` } } });
      expect(p).toMatchObject({ amount: 200_00, method: "ESEWA", status: "PENDING", userId: admin.id });
      expect(await d.paymentAttempt.count({ where: { paymentId: p.id } })).toBe(1);
    }
    errors();
  } finally {
    await d.payment.updateMany({ where: { purpose: "INVOICE", idempotencyKey: { startsWith: `invoice:${invoice.id}:` } }, data: { status: "CANCELLED" } });
    await d.invoice.update({ where: { id: invoice.id }, data: { status: "VOID" } });
  }
});
