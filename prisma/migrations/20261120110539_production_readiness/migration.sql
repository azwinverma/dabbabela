-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('ORDER', 'SUBSCRIPTION', 'WALLET_TOPUP', 'INVOICE', 'SWAP_DIFFERENCE');

-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('REFUND', 'WALLET_ADJUSTMENT', 'ORDER_ADJUSTMENT', 'EXPENSE', 'SUPPLIER_CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- AlterTable
ALTER TABLE "OrderAdjustment" ADD COLUMN     "invoiceLineId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "purpose" "PaymentPurpose" NOT NULL DEFAULT 'ORDER';

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN     "note" TEXT,
ADD COLUMN     "rewardedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InvoiceReceipt" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "paymentId" TEXT,
    "recordedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "entity" TEXT,
    "entityId" TEXT,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "kitchenId" TEXT,
    "idempotencyKey" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "executedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCredit" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "poId" TEXT,
    "returnKey" TEXT,
    "number" TEXT,
    "amount" INTEGER NOT NULL,
    "appliedAmount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCreditApplication" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCreditApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceReceipt_paymentId_key" ON "InvoiceReceipt"("paymentId");

-- CreateIndex
CREATE INDEX "InvoiceReceipt_invoiceId_idx" ON "InvoiceReceipt"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceReceipt_receivedAt_idx" ON "InvoiceReceipt"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_idempotencyKey_key" ON "ApprovalRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_createdAt_idx" ON "ApprovalRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_kind_status_idx" ON "ApprovalRequest"("kind", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedById_idx" ON "ApprovalRequest"("requestedById");

-- CreateIndex
CREATE INDEX "ApprovalRequest_entity_entityId_idx" ON "ApprovalRequest"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCredit_returnKey_key" ON "SupplierCredit"("returnKey");

-- CreateIndex
CREATE INDEX "SupplierCredit_supplierId_status_idx" ON "SupplierCredit"("supplierId", "status");

-- CreateIndex
CREATE INDEX "SupplierCredit_poId_idx" ON "SupplierCredit"("poId");

-- CreateIndex
CREATE INDEX "SupplierCreditApplication_creditId_idx" ON "SupplierCreditApplication"("creditId");

-- CreateIndex
CREATE INDEX "SupplierCreditApplication_invoiceId_idx" ON "SupplierCreditApplication"("invoiceId");

-- CreateIndex
CREATE INDEX "CouponRedemption_orderId_idx" ON "CouponRedemption"("orderId");

-- CreateIndex
CREATE INDEX "OrderAdjustment_invoiceLineId_idx" ON "OrderAdjustment"("invoiceLineId");

-- CreateIndex
CREATE INDEX "Payment_purpose_status_idx" ON "Payment"("purpose", "status");

-- AddForeignKey
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceReceipt" ADD CONSTRAINT "InvoiceReceipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceReceipt" ADD CONSTRAINT "InvoiceReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditApplication" ADD CONSTRAINT "SupplierCreditApplication_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "SupplierCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditApplication" ADD CONSTRAINT "SupplierCreditApplication_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Backfills (idempotent, data-only; no rows removed) ─────────────

-- Plan payments: anything linked to a subscription pays for the plan.
UPDATE "Payment" SET "purpose" = 'SUBSCRIPTION' WHERE "subscriptionId" IS NOT NULL AND "purpose" = 'ORDER';

-- Company-share adjustments already billed: link them to the invoice line that carries their `[adj:<id>]` tag
-- (non-void invoices; the most recent line if more than one).
UPDATE "OrderAdjustment" a
SET "invoiceLineId" = l."id"
FROM (
  SELECT DISTINCT ON (substring(il."description" from '\[adj:([a-z0-9]+)\]'))
         substring(il."description" from '\[adj:([a-z0-9]+)\]') AS adj_id, il."id"
  FROM "InvoiceLine" il
  JOIN "Invoice" i ON i."id" = il."invoiceId"
  WHERE i."status" <> 'VOID' AND il."description" LIKE '%[adj:%'
  ORDER BY substring(il."description" from '\[adj:([a-z0-9]+)\]'), i."createdAt" DESC
) l
WHERE a."id" = l.adj_id AND a."invoiceLineId" IS NULL;

-- Rewarded referrals: reward time = the wallet credit row's time.
UPDATE "Referral" r
SET "rewardedAt" = c."createdAt"
FROM "CreditLedger" c
WHERE c."id" = r."rewardLedgerId" AND r."rewardedAt" IS NULL;

-- Coupon redemptions recorded with only a payment: set the order when that payment paid exactly one order.
UPDATE "CouponRedemption" cr
SET "orderId" = o."id"
FROM "Order" o
WHERE cr."orderId" IS NULL AND cr."paymentId" IS NOT NULL AND o."paymentId" = cr."paymentId"
  AND (SELECT count(*) FROM "Order" o2 WHERE o2."paymentId" = cr."paymentId") = 1;
