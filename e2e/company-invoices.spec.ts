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
