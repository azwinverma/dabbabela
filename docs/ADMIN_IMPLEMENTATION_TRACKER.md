# Admin implementation tracker

_Created 2026-11-04 (Phase 0)._ This file lists only the **gaps** from [FEATURE_AUDIT.md](FEATURE_AUDIT.md); what already works isn't
rebuilt. The design is in [SUPER_ADMIN_ARCHITECTURE.md](SUPER_ADMIN_ARCHITECTURE.md).

**Status values:** ⬜ not started · 🔄 in progress · ✅ done (tests green) · ⛔ blocked-external.
**Size:** S ≤ ½ day · M 1–2 days · L 3+ days.

## Sequencing
```
WP-00 schema (one migration) ──► WP-01 RBAC + nav + permission keys ──► parallel wave A ──► wave B ──► WP-20
                                                                        WP-02 WP-03 WP-04 WP-05      WP-10 (needs 02, 09)
                                                                        WP-06 WP-07 WP-08 WP-09      WP-16 (needs 08, 09, 12)
                                                                        WP-11 WP-12 WP-13 WP-14      WP-18, WP-19
                                                                        WP-15 WP-17
```
* **WP-00 and WP-01 are sequential and must merge first.**
  - WP-00 owns `prisma/schema.prisma`, the migration and seed backfills.
  - WP-01 owns the permission registry and `src/components/admin/nav.ts`. It adds every permission key and sidebar entry that later packages need (pages may show "coming soon" until their package lands), so no later package edits those files.
* **Wave A packages own disjoint files** (see the *Owns* column). Shared helpers they may *call* but not edit: `src/lib/*`
  (except files listed as owned), `src/server/orders.ts` (owned by WP-03), `src/server/pricing.ts` (owned by WP-05).
  If a package needs a change in a file it doesn't own, it records the request under *Cross-package requests* below.
* **Audit:** each package calls `audit()` for its own events. WP-17 owns only the audit infrastructure and UI.

## Phase map (brief §25 → packages)
| Brief phase | Packages |
|---|---|
| 1 Audit, security architecture, roles, permissions, core DB, design system | WP-00, WP-01, WP-19 (admin UI kit) |
| 2 Super Admin layout, executive dashboard, analytics | WP-02 |
| 3 Meal catalogue, recipes, weekly menus, builder, pricing | WP-04, WP-05 |
| 4 Ordering, subscription engine, calendar, frontend | WP-03, WP-06, WP-18 |
| 5 Kitchen, inventory, suppliers, production | WP-07, WP-08 |
| 6 Delivery, corporate | WP-13, WP-12 |
| 7 Payments, refunds, invoices, reconciliation, finance reports | WP-09 |
| 8 CMS, marketing, frontend updates, notification templates | WP-14, WP-15, WP-11 |
| 9 Reporting, audit, alerts, automation | WP-10, WP-17, WP-16 |
| 10 Testing, security review, performance, deployment | WP-20 |

---

## WP-00: Consolidated schema migration ⬜ (L)
**Owns:** `prisma/schema.prisma`, `prisma/migrations/<ts>_super_admin_foundation/`, `src/server/seed.ts` (backfill section only), `docs/DATABASE_SCHEMA.md`.
**Migration type:** additive only (new tables, nullable or defaulted columns, new enum values), safe on the live Neon database.

| Area | New models | New fields / enum values |
|---|---|---|
| RBAC | `StaffRole { id, key @unique, name, description, permissions String[], isSystem, createdAt, updatedAt }` · `StaffScope { id, userId, kitchenId?, companyId?, @@unique([userId,kitchenId,companyId]) }` · `LoginEvent { id, userId?, email, ip, userAgent, method, success, createdAt }` | `User.staffRoleId?` |
| Attribution | — | `User.acquisitionSource?`, `User.attribution Json?` · `Order.attribution Json?`, `Order.campaignId?` · `Subscription.campaignId?` |
| Audit | — | `AuditLog.requestId?`, `AuditLog.userAgent?`, `AuditLog.approvedById?` (+ index on `[entity, entityId]`, `[actorId, createdAt]`) |
| Menu | `MealCategory { id, slug @unique, name, nameNe?, sortOrder, isActive }` · `KitchenAvailability { id, kitchenId, boxId?, menuItemId?, optionId?, isAvailable, note? }` · `WeeklyMenuRevision { id, menuId, version, snapshot Json, action, actorId?, createdAt }` | `LunchBox.categoryId?`, `shortDescription?`, `shortDescriptionNe?`, `isFeatured @default(false)`, `isVisible @default(true)`, `maxDailyQty?`, `packagingCost Int @default(0)` · `WeeklyMenu.kind String @default("STANDARD")`, `publishAt?`, `version Int @default(0)` · `MenuDay.cutoffOverride?` · `MenuDayItem.replacementBoxId?` |
| Builder | `CustomizationPortion { id, optionId, label, labelNe?, qtyMultiplier Float @default(1), priceDelta Int @default(0), sortOrder }` | `CustomizationGroup.dietRule?` · ComboRule kinds: add `REQUIRES` (string, no enum change) |
| Plans | `MealPlanPrice { id, planId, pricePerMeal, compareAtPrice?, effectiveFrom @db.Date, effectiveTo? @db.Date, createdById?, createdAt }` | `MealPlan.minWeeks?`, `maxWeeks?`, `skipPolicy?`, `cancelPolicy?`, `renewalReminderDays @default(3)` · `Subscription.priceId?`, `renewedFromId?` |
| Orders | — | `Order.packagingCost Int @default(0)` |
| Kitchen | — | `Kitchen.managerId?`, `openTime?`, `closeTime?`, `workingDays Weekday[] @default([])`, `status String @default("OPEN")`, `statusNote?` |
| Inventory | `UnitConversion { id, ingredientId?, fromUnit StockUnit, toUnit StockUnit, factor Float }` · `InventoryLocation { id, kitchenId, name, isActive }` · `StockLot { id, ingredientId, kitchenId, locationId?, code, receivedQty Float, remainingQty Float, unitCost Int, expiresOn? @db.Date, receivedAt, poLineId? }` · `StockTransfer { id, number @unique, fromKitchenId, toKitchenId, status, note?, createdById?, createdAt, updatedAt }` · `StockTransferLine { id, transferId, ingredientId, quantity Float, receivedQty Float @default(0) }` | `Ingredient.category?`, `purchaseUnit StockUnit?`, `purchaseFactor Float @default(1)`, `reorderPoint Float?` · `StockMovement.lotId?`, `locationId?`, `transferId?` · `StockMovementType`: + `TRANSFER_OUT`, `TRANSFER_IN` |
| Finance | `ExpenseCategory { id, key @unique, name, kind, isActive }` · `Expense { id, number @unique, date @db.Date, categoryId, kitchenId?, supplierId?, description, amount Int, tax Int @default(0), method?, reference?, attachmentUrl?, status String @default("DRAFT"), approvedById?, createdById?, createdAt, updatedAt }` · `SupplierInvoice { id, supplierId, poId?, number, date, dueDate?, subtotal, tax, total, paidAmount @default(0), status, attachmentUrl?, createdAt, updatedAt, @@unique([supplierId, number]) }` · `SupplierPayment { id, invoiceId, amount, method, reference, paidAt, actorId? }` · `DailySettlement { id, date @db.Date, kitchenId?, method PaymentMethod, expected Int, counted Int, variance Int, note?, closedById?, closedAt?, @@unique([date, kitchenId, method]) }` · `GatewayStatementLine { id, provider, providerRef, amount, fee, settledAt, matchedPaymentId?, importedAt, batch }` · `AccountingPeriod { id, month String @unique, closedAt?, closedById?, note? }` | `Payment.gatewayFee Int @default(0)`, `Payment.feeActual Int?` |
| Delivery | `RiderProfile { userId @id, vehicle?, phone?, isAvailable @default(true), zoneIds String[] }` | `DeliveryRoute.cost Int?` · `DeliveryZone.distanceRules Json?` |
| Corporate | `DepartmentBudget { id, companyId, department, month String, amount Int, @@unique([companyId, department, month]) }` · `CompanyMenuItem { companyId, boxId, @@id([companyId, boxId]) }` | `Company.deliveryInstructions?` · `CompanyMember.mealEligible @default(true)`, `eligibleDays Weekday[] @default([])` · `CorporateContract.version @default(1)`, `minMealsPerMonth?`, `creditTermsDays?`, `boxPrices Json?`, `supersedesId?` |
| Marketing | `Campaign { id, name, channel, utmCampaign? @unique, startsAt?, endsAt?, budget Int?, notes?, isActive }` · `CampaignSpend { id, campaignId, date @db.Date, amount Int, note? }` · `ReferralCode { id, userId @unique, code @unique, createdAt }` · `Referral { id, codeId, refereeId @unique, status, rewardLedgerId?, qualifiedOrderId?, createdAt }` | `Coupon.freeDelivery @default(false)`, `boxIds String[] @default([])`, `campaignId?`, `stackable @default(false)` |
| Alerts | `Alert { id, type, severity, priority Int @default(2), source, entity?, entityId?, dedupeKey @unique, status @default("OPEN"), ownerId?, message, data Json?, firstSeenAt, lastSeenAt, count @default(1), ackAt?, ackById?, resolvedAt?, resolvedById?, resolutionNote? }` | — |
| CMS | `CmsPage { id, slug @unique, title, titleNe?, status, seoTitle?, seoDescription?, ogImage?, canonicalUrl?, noindex @default(false), showInNav @default(false), createdAt, updatedAt }` · `CmsPageVersion { id, pageId, locale, version, blocks Json, status, publishAt?, publishedAt?, actorId?, createdAt, @@unique([pageId, locale, version]) }` · `Redirect { id, from @unique, to, permanent @default(true), hits @default(0), createdAt }` · `NavItem { id, menu, label, labelNe?, href, parentId?, sortOrder, visible @default(true) }` · `PageRevision { id, pageId, title, body, bodyNe?, actorId?, createdAt }` | — |
| Admin UX | `SavedView { id, userId, module, name, query Json, createdAt }` | — |

**Seed backfills (idempotent):**
- `StaffRole` presets: Kitchen Manager, Delivery Manager.
- `ExpenseCategory` set: FOOD, PACKAGING, DELIVERY, LABOR, RENT, UTILITIES, MARKETING, GATEWAY_FEES, EQUIPMENT, OTHER.
- One `MealPlanPrice` per existing plan (from the current price, effective from the plan's createdAt).
- `NavItem` rows mirroring today's header and footer links.
- `MealCategory` from the existing box tags.

**Tests:**
- `prisma migrate deploy` on a fresh schema (the test harness already does this).
- The backfill runs twice without duplicates.
- Existing 73 Vitest and 38 Playwright tests stay green.

**Depends:** none.

## WP-01: Granular RBAC, custom roles, scopes, login activity ⬜ (L)
**Owns:**
- `src/lib/permissions.ts` → `src/lib/permissions/{index,registry,system,legacy}.ts` (keep a re-export at the old path)
- `src/lib/auth.ts` (`requirePermission`/`can` signature)
- `src/components/admin/nav.ts`
- `src/app/admin/staff/**`, `src/app/admin/roles/**` (new)
- `src/server/auth.ts` (hooks for `LoginEvent`)
- `tests/unit/rbac-*.test.ts`, `e2e/permissions.spec.ts`

**Delivers:**
- **Permissions:** the module × action registry; system grants equal to today's matrix (a snapshot test proves no role gains or loses access); the legacy key map.
- **Roles and scopes:** custom role editor; `StaffScope` editor; the `scopeWhere()` helper, applied in this package to orders, kitchen, dispatch and inventory list queries.
- **Sessions:** `LoginEvent` capture; staff session list with revoke one / revoke all.
- **Invites:** email invite links (token, 48 h) replace temporary passwords.
- **Navigation:** all new sidebar entries for wave A/B, each behind its permission.

**Tests:**
- Escalation: a user can't grant a permission they don't hold.
- Scope isolation: a kitchen-B user can't read kitchen-A orders or stock.
- Legacy key equivalence.

**Depends:** WP-00.

## WP-02: Analytics engine and executive dashboard ⬜ (L)
**Owns:**
- `src/server/analytics/**` (new: `metrics.ts`, `filters.ts`, `revenue.ts`, `orders.ts`, `subscriptions.ts`, `customers.ts`)
- `src/server/reports.ts` (refactor onto analytics)
- `src/app/admin/page.tsx`, `src/app/admin/analytics/**` (drill-down pages)
- `src/components/admin/charts/**` (new; clickable bars/lines → filtered lists)
- `src/components/admin/finance/kit.tsx`

**Delivers:**
- **Revenue bases and KPIs:** the four revenue bases (Bookings / Cash / Recognised / Deferred) with definitions; period presets with growth %; AOV; cancelled value.
- **Breakdowns:** by plan, method, kitchen, company, zone and channel.
- **Order pipeline:** delayed / over-capacity / unavailable-ingredient counts.
- **Subscription stats:** run-rate, renewals due, cancel reasons, expected meals per day and week.
- **Customer stats:** LTV, top customers, diet mix, ratings, complaint trend.
- **Filters and drill-down:** a global filter bar (date, kitchen, zone, customer type, company, meal type, plan type, payment status, order status); every chart links to the underlying records.

**Customer-facing:** none.

**Tests:** `tests/integration/analytics.test.ts` seeds a fixed dataset and asserts every metric equals hand-written SQL, including a prepaid plan counted once in bookings and per meal in recognised revenue.

**Depends:** WP-00, WP-01. WP-11 (attribution) is only needed for the channel breakdown, which shows "not captured yet" until then.

## WP-03: Order management extensions ⬜ (M)
**Owns:** `src/server/orders.ts`, `src/server/orders-admin.ts` (new), `src/app/admin/orders/**`.

**Delivers:**
- **Manual and bulk orders:** manual order for any customer (source ADMIN, any enabled payment method, notes); staff corporate bulk order (calls `team.ts` services read-only).
- **Edits before the cut-off:** edit lines with re-quote, with the money delta going to an adjustment or a new payment, and `Order.version` checks; staff substitution on an order (new components snapshot plus a customization row).
- **Reassignment:** move an order to another kitchen (capacity check, refused after lock).
- **Order page:** printable staff receipt; audit events on the order page; search by company name; a modification window separate from the cut-off (setting key).

**Tests:**
- Integration tests: manual order totals equal the customer quote; reassigning a locked day is refused; concurrent edits produce a version conflict.
- E2E: staff creates a phone order.

**Depends:** WP-01.

## WP-04: Menu catalogue and weekly menu builder ⬜ (L)
**Owns:**
- `src/server/menu.ts`, `src/lib/public.ts`
- `src/app/admin/dishes/**`, `src/app/admin/boxes/**`, `src/app/admin/weekly-menus/**`, `src/app/admin/categories/**` (new), `src/app/admin/preview/menu/**` (new)
- `src/app/(site)/menu/**`, `src/app/(site)/boxes/**`

**Delivers:**
- **Catalogue fields:** meal categories; featured, visible and max-daily fields; kitchen availability for boxes and dishes.
- **Week editor:** drag-and-drop with a keyboard fallback; seasonal and promo kinds; per-day cut-off override; replacement box when sold out.
- **Publishing:** revisions on publish and unpublish; safe unpublish; scheduled `publishAt` (consumed by WP-16's cron hook: `publishDueMenus()` exported from `menu.ts`); staff draft preview.
- **Customer-facing:** the public menu shows categories, a featured flag, next week, per-day cut-off and the replacement option.

**Tests:**
- Integration: scheduled publish is idempotent; unpublish is refused when paid orders exist; kitchen-unavailable boxes are hidden.
- E2E (acceptance 1–2): create a dish and box, publish next week, see it on `/menu?week=`.

**Depends:** WP-01.

## WP-05: Builder engine ⬜ (M)
**Owns:** `src/server/builder.ts`, `src/server/pricing.ts`, `src/app/admin/builder/**`, `src/app/(site)/build/**`, `src/lib/actions/build.ts`.

**Delivers:**
- **Options:** portions per option; REQUIRES rules; group diet rules; kitchen availability per option.
- **Stock check:** an ingredient-shortage soft warning.
- **Pricing:** the server stays authoritative.

**Tests:** unit pricing tests for portions and REQUIRES; tampered client prices are ignored.

**Depends:** WP-01.

## WP-06: Subscription engine ⬜ (L)
**Owns:**
- `src/server/subscriptions.ts`, `src/server/calendar.ts`
- `src/app/admin/plans/**`, `src/app/admin/subscriptions/**`, `src/app/admin/production-calendar/**` (new)
- `src/app/(site)/plans/**`, `src/app/(site)/account/plans/**`

**Delivers:**
- **Pricing and policies:** versioned `MealPlanPrice` (quotes use the effective price, and changing a price never alters existing subscriptions); per-plan min/max weeks; per-plan skip and cancel policy overrides.
- **Customer actions:** one-click renew (pre-filled new subscription → checkout); swap a day's pick before the cut-off with price delta; an "add a meal" shortcut.
- **Admin view:** an aggregate production calendar (committed meals × dish × day for N weeks).

**Tests:**
- A price change after purchase doesn't affect the old subscription.
- Renewal links `renewedFromId`.
- Swap delta is credited or charged exactly once.
- E2E (acceptance 3): pick the new meal in a plan.

**Depends:** WP-01, WP-04 (box fields, for the swap UI only).

## WP-07: Kitchen management ⬜ (M)
**Owns:** `src/server/kitchen.ts` (except `postBatchStock`, which moves to WP-08), `src/server/capacity.ts`, `src/app/admin/kitchens/**`, `src/app/admin/kitchen/**`.

**Delivers:**
- **Kitchen profile:** manager, hours, working days, status (PAUSED/CLOSED blocks new orders through `capacity.ts`), with audit.
- **Production dashboard:** meals by slot, progress %, packing status, ready for dispatch, ingredient shortages, production issues.
- **Performance:** a per-kitchen panel (waste, on-time, cost per meal).
- **Planning:** a requirements horizon (N days).

**Tests:**
- A closed kitchen refuses orders.
- Dashboard counts match orders.
- E2E (acceptance 8, 10): requirements visible after lock.

**Depends:** WP-01.

## WP-08: Inventory upgrade ⬜ (L)
**Owns:** `src/server/inventory.ts` (+ `postBatchStock` moved here from `kitchen.ts`, re-exported), `src/app/admin/inventory/**`.

**Delivers:**
- **Units:** unit conversions, with purchase units on POs and receipts.
- **Lots:** lots on receipt; FEFO lot-aware consumption with row locks.
- **Locations and transfers:** locations; kitchen-to-kitchen transfers (TRANSFER_OUT/IN).
- **Returns:** purchase returns.
- **Valuation and alerts:** inventory valuation; expiring-soon list; discrepancy report.

**Tests:**
- Concurrent consumption never makes a lot negative.
- Transfers balance.
- Conversion maths.
- Usage stays idempotent per batch.
- E2E (acceptance 9): finishing a batch reduces stock.

**Depends:** WP-01, and coordination with WP-07 on the `postBatchStock` move (done first in WP-08).

## WP-09: Finance: expenses, payables, settlement, profitability ⬜ (L)
**Owns:**
- `src/server/finance/**` (new: `expenses.ts`, `payables.ts`, `settlement.ts`, `profitability.ts`, `statements.ts`, `journal.ts`)
- `src/server/payments/index.ts` (fee capture only)
- `src/app/admin/expenses/**`, `src/app/admin/payables/**`, `src/app/admin/settlements/**`, `src/app/admin/profitability/**`, `src/app/admin/payments/**`

**Delivers:**
- **Expenses:** expense ledger with categories, an approval flow and attachments; void instead of delete.
- **Payables:** supplier invoices and payments, with a three-way match hint.
- **Cash and gateways:** daily settlement (cash from routes, gateway from statements, bank); gateway statement CSV import → match → fee actuals → variance; duplicate-payment detection.
- **Profitability:** a P&L with Estimated / Actual / Coverage columns, labelled honestly; accounting period close.
- **Exports:** journal CSV export (⛔ chart of accounts from the accountant).
- **Settings:** invoice numbering settings.

**Tests:**
- Profitability reconciles to the seeded ledgers.
- A closed period refuses back-dated expenses.
- A statement import twice is idempotent.

**Depends:** WP-01.

## WP-10: Reports center ⬜ (L)
**Owns:** `src/app/admin/reports/**`, `src/app/api/admin/export/**`, `src/server/reports-center/**` (new: one definition per report).

**Delivers:** the 27 reports from brief §16 as server-side, paginated, filterable views with CSV and XLSX export (`exceljs`). Exports are audited and PII-masked.

**Tests:**
- Each report's totals match analytics metrics.
- Export permission is enforced.
- CSV injection is neutralised (existing).

**Depends:** WP-02, WP-09 (profitability reports), WP-08 (valuation).

## WP-11: CRM and attribution ⬜ (M)
**Owns:**
- `src/app/admin/customers/**`, `src/server/crm.ts` (new)
- `src/middleware.ts` (UTM / referrer first-touch cookie)
- `src/lib/actions/auth.ts` (store attribution at registration)
- `src/lib/actions/shop.ts` (attribution onto order/subscription only)

**Delivers:**
- **Profile:** staff edit of permitted fields (audited); communication preference management; credit from the profile; timeline notes.
- **Attribution:** first-touch and last-touch capture (consented, documented in the privacy page draft).

**Tests:** attribution stored once; PII masking in edits and exports.

**Depends:** WP-01.

## WP-12: Corporate ⬜ (M)
**Owns:** `src/server/corporate.ts`, `src/server/team.ts`, `src/app/admin/companies/**`, `src/app/team/**`.

**Delivers:**
- **Contracts:** versions (supersede chain), minimum meals per month, negotiated per-box prices (applied in `corporate.ts` pricing hooks).
- **Budgets and eligibility:** department budgets, with a warning or block at the team order; member eligibility and eligible days.
- **Menus:** company menu allow-list.
- **Delivery:** company delivery instructions editable in `/team`.

**Tests:**
- Isolation (existing, extended).
- Budget enforcement.
- Negotiated price used on the invoice.

**Depends:** WP-01.

## WP-13: Delivery and logistics ⬜ (M)
**Owns:** `src/server/dispatch.ts`, `src/server/coverage.ts`, `src/app/admin/dispatch/**`, `src/app/admin/zones/**`, `src/app/admin/riders/**` (new), `src/app/rider/**`.

**Delivers:**
- **Riders:** rider profiles and availability.
- **Costs and fees:** route cost entry; optional distance fee bands.
- **Reporting:** delivery performance per rider and zone.
- **Rider app:** date picker.

**Tests:** fee bands; performance numbers match events.

**Depends:** WP-01.

## WP-14: CMS page builder, navigation, branding, SEO ⬜ (L)
**Owns:**
- `src/lib/cms/**` (new block registry), `src/lib/cms.ts`, `src/lib/cms-store.ts`
- `src/app/admin/content/**`, `src/app/admin/pages/**`, `src/app/admin/site/**` (new: nav, branding, redirects, SEO)
- `src/app/(site)/[...slug]/**`, `src/app/preview/**`
- `src/components/site/Header*.tsx`, `src/components/site/Footer.tsx`, `src/components/site/JsonLd.tsx`
- `src/app/sitemap.ts`, `src/app/robots.ts`, `src/app/(site)/page.tsx`

**Delivers:**
- **Pages and blocks:** CmsPage plus versions with 14 typed blocks; add, reorder, hide and edit; desktop/mobile preview; scheduled publish (`publishDuePages()` for WP-16); rollback.
- **Site settings:** redirects; NavItem-driven header and footer; branding slots (logo, favicon, colour preset within tokens).
- **SEO and policies:** canonical and noindex; JSON-LD; policy page revisions.
- **Content pages:** seeded Nutrition and Delivery Policy pages, marked "needs review".
- **Customer-facing:** header, footer, new pages, home featured-meals block.

**Tests:**
- Invalid block payloads are rejected.
- Script injection is escaped.
- Scheduled publish is idempotent.
- E2E (acceptance 16): a new page block appears on the public site after publish.

**Depends:** WP-01.

## WP-15: Promotions and marketing ⬜ (M)
**Owns:** `src/server/coupons.ts` (keep the `validateCoupon`/`redeemCoupon` signatures), `src/server/marketing.ts` (new), `src/app/admin/coupons/**`, `src/app/admin/campaigns/**` (new), `src/app/(site)/account/referrals/**` (new).

**Delivers:**
- **Coupons:** free-delivery coupons; box-scoped coupons; explicit no-stacking; a negative-total guard.
- **Campaigns:** spend entries (migrated from `Setting.marketingSpend`); attribution report.
- **Referrals:** referral codes with a qualifying first DELIVERED order, a reward to the wallet, and fraud rules (same phone, address or device → hold).

**Tests:**
- Stacking refused.
- A total can never go below 0.
- A referral is rewarded once.
- Concurrent redemptions respect limits (existing pattern).

**Depends:** WP-01, WP-11 (attribution).

## WP-16: Alerts center and automation ⬜ (M)
**Owns:** `src/server/alerts/**` (new), `src/server/jobs.ts`, `src/app/api/cron/**`, `vercel.json`, `src/app/admin/alerts/**`, `src/app/admin/jobs/**` (new).

**Delivers:**
- **Alerts:** the Alert model service; 14 detectors; dedupe and auto-resolve; ack, assign and resolve with a note; escalation emails.
- **Dashboard:** the banner reads `Alert`.
- **Jobs:** scheduled publish hooks (menus WP-04, CMS WP-14); a job runs list with re-run.

**Tests:**
- Detectors are idempotent.
- Auto-resolve works.
- Escalation is queued once.

**Depends:** WP-04, WP-08, WP-09, WP-12, WP-14 (detectors read their data, through exported read functions).

## WP-17: Audit infrastructure ⬜ (S)
**Owns:** `src/lib/audit.ts`, `src/lib/request-context.ts` (new), `src/app/admin/audit/**`.

**Delivers:** request id, IP and user agent filled automatically; `approvedById`; search by actor, entity, action and date; deep links to records; redaction of secret-looking keys in before/after.

**Tests:** a secret field is redacted; filters work.

**Depends:** WP-00.

## WP-18: Customer dashboard and frontend states ⬜ (M)
**Owns:** `src/app/(site)/account/page.tsx`, `src/app/(site)/account/{orders,wallet,notifications,support,profile}/**`, `src/app/(site)/account/payments/**` (new), and `loading.tsx` files under `src/app/(site)/**` and `src/app/admin/**`.

**Delivers:** an account home with today's lunch (live status), upcoming lunches, a calendar view, active plans, credits and a payment history page; loading, empty and error states.

**Tests:** E2E (acceptance 12): the customer sees status updates through to delivered.

**Depends:** none beyond WP-00. It can start in wave A.

## WP-19: Admin UI kit ⬜ (M)
**Owns:** `src/components/admin/ui.tsx`, `src/components/admin/*` (except `nav.ts` and the chart folders owned by WP-02), `src/app/admin/layout.tsx`, `src/app/admin/_kit/**`.

**Delivers:** global search (⌘K across orders, customers, companies, boxes); `SavedView` saved filters; drawer and modal pattern; bulk-action confirmation component; table density and pagination helpers.

Packages adopt these opportunistically; no package depends on WP-19.

**Depends:** WP-00.

## WP-20: Acceptance, security, performance, launch ⬜ (L)
**Owns:** `e2e/acceptance.spec.ts` (new), `tests/integration/acceptance.test.ts`, `docs/*` final updates.

**Delivers:**
- **Acceptance E2E:** the brief §26 flow end to end (meal created → published → subscribed → paid sandbox → kitchen → stock → dispatch → delivered → reports → audit).
- **Reconciliation:** a metric-to-record reconciliation test.
- **Security and performance:** a security review pass (authz on every new action, IDOR checks, upload checks); `npm audit` triage; query plans and indexes for reports.
- **Release:** a staging deploy; the status doc updated honestly.

**Depends:** all.

---

## Cross-package requests
_Record here when a package needs a change in a file owned by another package._
| From | To | Request | Status |
|---|---|---|---|
| WP-08 | WP-07 | Move `postBatchStock` from `kitchen.ts` to `inventory.ts` (WP-08 does the move first; WP-07 rebases) | planned |
| WP-12 | WP-03 / WP-05 | Negotiated per-box company price hook in `quoteCart` (`orders.ts`) → call `corporate.ts priceFor(company, boxId)` | planned |
| WP-15 | WP-05 | `pricing.ts` must respect `Coupon.freeDelivery` (delivery fee → 0) and `boxIds` scope | planned |
| WP-11 | WP-03 | Pass `attribution` into `placeCartOrder` | planned |
| WP-16 | WP-02 | Dashboard "Needs attention" banner reads open `Alert` rows (`src/app/admin/page.tsx`) | planned |
| WP-06 | WP-11 | Renew / swap / add-meal server actions in `src/lib/actions/shop.ts` (WP-06 may add new exported actions in a new file `src/lib/actions/plans.ts` instead) | planned |

## External blockers (⛔)
| Blocker | Affects |
|---|---|
| eSewa / Khalti live merchant keys; Khalti refund API access | WP-09 live reconciliation, refunds through API |
| Tax registration and advice (VAT rate, invoice format, IRD rules) | Tax rules, invoice numbering, journal export |
| Accountant's chart of accounts | WP-09 journal export |
| Email domain (Resend) and SMS sender ID | Escalation and notification delivery |
| Legal review of policies, the attribution/cookie notice, the referral terms | WP-11, WP-14, WP-15 |
| Sentry (or other) account | Error monitoring in WP-20 |
| Push notification provider | Not planned |
| Real recipe weights, suppliers, photos | Costing accuracy, menu imagery |

## Progress log
| Date | Package | Change |
|---|---|---|
| 2026-11-04 | Phase 0 | Audit, architecture and tracker written; no code changed |
