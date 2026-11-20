# Production readiness plan (Nov 2026)

Goal: close every internal gap between the current build and a production launch, across the backend, the web app (customer site + admin), and a new Flutter mobile app. External blockers (live gateway keys, VAT advice, legal review, SMS/email providers, photos/recipes) stay listed as blockers — we build everything so they're configuration, not code.

Ground rules (unchanged from the Super Admin build): one shared database and permission system; integer paisa; no fake numbers; no button that doesn't work; every money movement is append-only, idempotent, audited and reconcilable; additive migrations only (never reset); tests with every change; honest status in `IMPLEMENTATION_STATUS.md`.

## Decisions taken (owner can change later in settings)

| Topic | Decision |
|---|---|
| Company menu scope | When a company has a menu set, it applies to all its members on the public menu, account menu and checkout (company-billed and employee-paid). Build-a-Dabba is blocked only for company-billed orders. |
| Address + slot change together | The window check uses the **new** address's zone. |
| Wallet top-up | Feature flag `walletTopup`, **off by default** until legal advice on NRB e-money rules (closed-loop store credit). Limits in settings: min Rs 100, max Rs 10,000 per top-up, daily Rs 20,000, balance cap Rs 25,000. Credit only after server-side gateway verification. Top-up credit is spendable on Dabba Bela only; refund to source only through the normal refund flow. |
| Maker-checker | Refunds and manual wallet adjustments above a threshold (setting, default Rs 2,000) need a second staff member's approval. Nobody approves their own request. Super admin may approve others'. |
| Mobile app scope | One Flutter app, role-aware: Customer, Rider, Kitchen (production + status), Dispatcher (routes + assign). Super admin / finance / CMS stay on the web admin (desktop operator tools). |

## Phases

1. **Schema foundation** — one additive migration for everything below (payment purpose / wallet top-up, approval requests, device tokens, open schema-change rows from the tracker). Foundation backfill updated.
2. **Money + security + gaps** (parallel):
   - 2A Wallet top-up (eSewa/Khalti/bank), limits, ledger, history, admin view, reconciliation, alerts.
   - 2B Security hardening: Turnstile on auth/public forms (env-gated), nonce CSP, maker-checker approvals, Sentry (env-gated), rate limits review, session/device list.
   - 2C Business gaps: swap "pay the difference", company menu filtering, purchase-return supplier credit, schema-change rows wiring, dead code.
3. **Mobile API** — `/api/v1` REST with bearer sessions, same server functions and permission checks as the web, OpenAPI spec, tests.
4. **Flutter app** — `mobile/` project: customer, rider, kitchen, dispatcher flows on the v1 API; payments via gateway web checkout; analyzer + tests clean.
5. **Verification + launch prep** — full test suites, E2E, security review of new surfaces, docs, deploy.

Progress is logged at the bottom of this file by each phase.

## Progress log

### 2026-11-20 — Phase 1: schema foundation (done)

Migration `prisma/migrations/20261120110539_production_readiness` — additive only (new enums, tables, nullable/defaulted columns, indexes, FKs; SQL reviewed: no DROP / RENAME / SET NOT NULL on existing columns). Applied to local `dabbabela`; the vitest per-run schema applies it too. **Phase 2 agents: do not edit `schema.prisma`; use these names.**

| Area | Added |
|---|---|
| Payment purpose | enum `PaymentPurpose { ORDER, SUBSCRIPTION, WALLET_TOPUP, INVOICE, SWAP_DIFFERENCE }`; `Payment.purpose PaymentPurpose @default(ORDER)` + index `[purpose, status]`; `Payment.invoiceReceipt InvoiceReceipt?` (back-relation). Backfill in SQL: payments with `subscriptionId` → `SUBSCRIPTION`. |
| Wallet ledger | `CreditLedger.reason` stays a string; documented new reasons `TOPUP` (paymentId = the WALLET_TOPUP payment) and `TOPUP_REVERSAL` (negative row, same paymentId). Added both to `LedgerEntry["reason"]` in `src/server/ledger.ts` (type only). |
| Maker-checker | enum `ApprovalKind { REFUND, WALLET_ADJUSTMENT, ORDER_ADJUSTMENT, EXPENSE, SUPPLIER_CREDIT, OTHER }`; enum `ApprovalStatus { PENDING, APPROVED, REJECTED, CANCELLED, EXECUTED, FAILED }`; model `ApprovalRequest { id, kind, status @default(PENDING), amount Int @default(0) (paisa, absolute), entity?, entityId?, payload Json, reason, kitchenId?, idempotencyKey? @unique, requestedById → User "ApprovalRequestedBy", decidedById? → User "ApprovalDecidedBy", decidedAt?, decisionNote?, executedAt?, error?, createdAt, updatedAt }`, indexes `[status, createdAt]`, `[kind, status]`, `[requestedById]`, `[entity, entityId]`. User back-relations `approvalsRequested`, `approvalsDecided`. |
| Mobile push | enum `DevicePlatform { IOS, ANDROID, WEB }`; model `DeviceToken { id, userId → User (cascade), platform, token @unique, appVersion?, lastSeenAt @default(now()), createdAt }`, index `[userId]`; `User.deviceTokens`. Better Auth `bearer` plugin needs **no schema** (it reads the existing `Session.token`). |
| Company-invoice receipts | model `InvoiceReceipt { id, invoiceId → Invoice (restrict), amount Int (negative = reversal), method String (BANK_TRANSFER / CHEQUE / CASH / ESEWA / KHALTI / OTHER), reference, receivedAt, paymentId? @unique → Payment (purpose INVOICE), recordedById?, note?, createdAt }`, indexes `[invoiceId]`, `[receivedAt]`; `Invoice.receipts`. Note: `Invoice.paidAmount` also includes credit-note settlements, so cash = Σ receipts. **Not backfilled**: existing receipts live only in `invoice.payment` audit rows / the invoice note (amount is in formatted text) — Phase 2C should write a receipt in `recordInvoicePayment` and have `invoicePaymentHistory` read receipts plus the legacy audit rows (or backfill by parsing them). |
| Adjustment ↔ invoice line | `OrderAdjustment.invoiceLineId String?` → `InvoiceLine` (onDelete SetNull, so regenerating a draft frees it) + index; `InvoiceLine.adjustments`. Backfill in SQL from the `[adj:<id>]` tag (non-void invoices). Phase 2C: set it in `generateCompanyInvoice` and switch `corporate.ts`/`invoices.ts` "already billed" checks from the tag to the column. |
| Referrals | `Referral.rewardedAt DateTime?` (backfilled from the reward ledger row's time), `Referral.note String?`. Schema comment now lists all statuses (PENDING / HELD / APPROVED / QUALIFIED / REWARDED / REJECTED). Phase 2C: set both in `marketing.ts`. |
| Coupon redemptions | `CouponRedemption.orderId` already existed; added index `[orderId]`. Backfilled where the redemption's payment paid exactly one order. Phase 2C: pass `orderId` from `orders.ts` when recording. |
| Supplier credit | model `SupplierCredit { id, supplierId → Supplier, poId? → PurchaseOrder, returnKey? @unique (one credit per return — idempotency), number? (supplier's credit-note no.), amount, appliedAmount @default(0), status String @default("OPEN") (OPEN / PARTIAL / APPLIED / VOID), reason?, createdById?, createdAt, updatedAt }`, indexes `[supplierId, status]`, `[poId]`; model `SupplierCreditApplication { id, creditId → SupplierCredit, invoiceId → SupplierInvoice, amount, actorId?, createdAt }` (append-only), indexes `[creditId]`, `[invoiceId]`. Back-relations `Supplier.credits`, `PurchaseOrder.supplierCredits`, `SupplierInvoice.creditApplications`. There is no purchase-return table (returns are `StockMovement` RETURN rows, reference `<PO>#return:<lineId>`), so the credit links to the PO and `returnToSupplier` should pass a `returnKey`. Applying a credit settles the invoice (Phase 2C decides whether via `paidAmount`) but is not cash — cash flow keeps using `SupplierPayment`. |
| Settings (no schema) | `src/lib/settings.ts`: flag `walletTopup: false`; `walletTopupMin 10000`, `walletTopupMax 1000000`, `walletTopupDaily 2000000`, `walletBalanceCap 2500000`, `approvalThreshold 200000` (paisa). Editable on `/admin/settings` (flag in Feature flags; new "Wallet top-up & approvals" panel, rupee inputs) and validated in `settings/actions.ts` (min > 0, max ≥ min, daily ≥ max, cap ≥ min, threshold > 0). |

Deferred / decided: `RiderProfile.kitchenId` / `notes` not added (WP-13 uses `User.kitchenId` / `User.internalNote`, which work — no conflicting meaning yet). No `foundation.ts` change (all backfills are in the migration SQL and idempotent). Tracker rows stay open until Phase 2C wires the code. Checks: `prisma validate`, `tsc --noEmit` 0 errors, `vitest run` 33 files / 355 tests pass, eslint clean on touched files.
