import { expect, test } from "@playwright/test";
import { acceptDialogs, login, OWNER, watchErrors } from "./helpers";
import { db, todayKtm, dateOnly } from "./db";

/**
 * Phase 2C purchasing: a sent PO is received, part is returned to the supplier with a supplier credit (credit-note
 * number), the credit is applied to the supplier's invoice, and payables show the net due. The supplier, ingredient,
 * PO and supplier invoice are created as fixtures (unique names), so the spec doesn't depend on seeded purchasing data —
 * only on an active kitchen and the owner account.
 */
test("PO → receive → return with supplier credit → apply credit to the supplier invoice", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const kitchen = await db().kitchen.findFirstOrThrow({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  const supplier = await db().supplier.create({ data: { name: `E2E Supplier ${stamp}` } });
  const ingredient = await db().ingredient.create({ data: { name: `E2E Basmati ${stamp}`, unit: "KG", costPerUnit: 12000, allergenCodes: [] } });
  const po = await db().purchaseOrder.create({
    data: { number: `PO-E2E-${stamp}`.toUpperCase(), supplierId: supplier.id, kitchenId: kitchen.id, status: "SENT", total: 120000, lines: { create: [{ ingredientId: ingredient.id, quantity: 10, unitCost: 12000 }] } },
  });

  const errors = watchErrors(page);
  acceptDialogs(page);
  await login(page, OWNER.email, OWNER.password, "/admin");

  // receive the full 10 kg
  await page.goto(`/admin/inventory/purchases/${po.id}`);
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: `PO ${po.number}` })).toBeVisible();
  await main.getByLabel("Quantity received").fill("10");
  await main.getByRole("button", { name: "Receive goods" }).click();
  await expect.poll(async () => (await db().purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");

  // return 2 kg with a supplier credit and the supplier's credit-note number
  await page.reload();
  const ret = main.locator("form").filter({ has: page.getByRole("button", { name: "Post return" }) });
  await ret.getByLabel(`Return quantity for ${ingredient.name}`).fill("2");
  await expect(ret.getByLabel("Record a supplier credit for this return")).toBeChecked();
  await ret.getByLabel("Supplier credit-note number").fill(`CN-${stamp}`);
  await ret.getByPlaceholder(/^Reason/).fill("Damp sacks (E2E)");
  await ret.getByRole("button", { name: "Post return" }).click();
  await expect.poll(async () => db().supplierCredit.count({ where: { poId: po.id } })).toBe(1);
  const credit = await db().supplierCredit.findFirstOrThrow({ where: { poId: po.id } });
  expect(credit).toMatchObject({ amount: 24000, number: `CN-${stamp}`, status: "OPEN", supplierId: supplier.id });
  await page.reload();
  await expect(main.getByRole("heading", { name: "Supplier credits" })).toBeVisible();
  await expect(main.getByText(`note CN-${stamp}`)).toBeVisible();

  // the supplier's invoice for the PO (Rs 1,200) — then apply the Rs 240 credit from the invoice page
  const today = todayKtm();
  const inv = await db().supplierInvoice.create({ data: { supplierId: supplier.id, poId: po.id, number: `INV-E2E-${stamp}`, date: dateOnly(today), dueDate: dateOnly(today), subtotal: 120000, tax: 0, total: 120000 } });
  await page.goto(`/admin/payables/${inv.id}`);
  const apply = main.locator("form").filter({ has: page.getByRole("button", { name: "Apply credit" }) });
  await expect(apply.getByLabel("Amount (Rs)")).toHaveValue("240.00");
  await apply.getByRole("button", { name: "Apply credit" }).click();
  await expect.poll(async () => (await db().supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } })).paidAmount).toBe(24000);
  expect((await db().supplierCredit.findUniqueOrThrow({ where: { id: credit.id } })).status).toBe("APPLIED");
  expect((await db().supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PARTIAL");
  await page.reload();
  await expect(main.getByRole("heading", { name: "Supplier credits applied" })).toBeVisible();
  // credits are not cash: no SupplierPayment was written
  expect(await db().supplierPayment.count({ where: { invoiceId: inv.id } })).toBe(0);

  // credits tab lists it as applied; ageing shows the net due for the supplier
  await page.goto(`/admin/payables?tab=credits&all=1&supplier=${supplier.id}`);
  await expect(main.locator("tr").filter({ hasText: `CN-${stamp}` })).toContainText(/applied/i);
  await page.goto("/admin/payables?tab=ageing");
  await expect(main.locator("tr").filter({ hasText: supplier.name })).toBeVisible();

  errors();
});
