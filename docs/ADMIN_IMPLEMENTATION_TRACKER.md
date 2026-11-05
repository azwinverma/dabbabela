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

## WP-00: Consolidated schema migration ✅ (L)
**Done 2026-11-04.** Migration `20261104100940_super_admin_foundation` (34 tables, additive; checked the SQL has no
DROP/RENAME/SET NOT NULL). Backfill `src/server/foundation.ts` (`ensureFoundationData`), wired into `seedCatalog`,
`npm run db:foundation` (in `vercel-build` after `migrate deploy`) and `/admin/roles` → "Install missing presets".
Tests: `tests/integration/access.test.ts` (backfill re-run adds nothing; presets, prices, nav, categories present).
Deviations from the table below: `LoginEvent` also has `reason` (failure code); `NavItem` has `@@unique([menu, href])`;
`KitchenAvailability` unique on `[kitchenId, boxId, menuItemId, optionId]`; `StockLot` unique on `[kitchenId, code]`;
`InventoryLocation` unique on `[kitchenId, name]`; `GatewayStatementLine` unique on `[provider, providerRef]`.
Note: Postgres treats NULLs as distinct in unique keys, so `DailySettlement(date, kitchenId=null, method)` and
`StaffScope` rows with nulls must be de-duplicated in code (WP-09 / done in `setScopes` by replace-all).

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

## WP-01: Granular RBAC, custom roles, scopes, login activity ✅ (L)
**Done 2026-11-04** (invites deferred, see below).
- `src/lib/permissions/{registry,legacy,system,index}.ts` (old `permissions.ts` removed; `@/lib/permissions` resolves to the folder).
  36 modules, 89 `module.action` keys. Legacy keys still accepted and resolve to their stricter `write` key.
- **Codemod:** every `requirePermission`/`guarded`/`can` call site now uses granular keys — pages use the `view` key, server actions and
  API routes the `write` key, so a view-only custom role can't mutate. Publish actions use `menu.publish` / `content.publish`.
- `getCurrentUser` now carries `customGrants` (custom role) and `kitchenIds` (User.kitchenId ∪ StaffScope); `can(user, …)` everywhere.
  Shared loader `src/lib/user-context.ts` (also used by team orders and tests).
- Scope helpers (`src/components/admin/ops/scope.ts`): `kitchenWhere`, `inScope`, `kitchensFor` handle multi-kitchen scopes; applied to
  orders, kitchen, dispatch manifest, inventory (via `pickKitchen`) and PO detail. **Not yet:** CSV exports and reports (WP-10 owns them).
- Escalation: `canGrantRole` requires holding every permission of the target base role; `ungrantable()` guards role edits and
  custom-role assignment; only SUPER_ADMIN has `roles.edit`; kitchen-scoped editors can't widen scopes.
- `LoginEvent` written from a Better Auth `after` hook (`src/server/login-events.ts`) for email, phone OTP, TOTP and backup-code sign-ins.
- UI: `/admin/roles` (base-role grids, custom roles, create), `/admin/roles/[id]` (permission grid editor, users), `/admin/staff`
  (table), `/admin/staff/[id]` (role, custom role, scope, effective permissions, sessions with revoke one/all, sign-in activity, recovery).
- Sidebar: every planned route is registered in `nav.ts` with `ready: false` (hidden). A unit test fails if a ready entry has no page or a
  not-ready entry gains one — the building package flips `ready` (the only edit allowed in `nav.ts`).
- Tests: `tests/unit/rbac-granular.test.ts` (frozen legacy snapshot = system grants for every role × key, custom roles, escalation, nav
  registry), `tests/integration/access.test.ts` (role CRUD guards, assignment escalation, scope isolation, session revoke, login events),
  `e2e/permissions.spec.ts` (super admin grants a chef inventory view through a custom role; ops can't open the role editor).
- **Deferred:** email invite links (token, 48 h) — still temporary passwords, because email sending isn't configured (no Resend key);
  build when the email domain is verified.

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

## WP-02: Analytics engine and executive dashboard ✅ (L)
**Done 2026-11-05.**
- **Metrics layer** `src/server/analytics/`: `metrics.ts` (definitions registry shown next to every number), `filters.ts` (one parser +
  Prisma builder + mirrored SQL builder; kitchen scope = requested ∩ `user.kitchenIds`), `revenue.ts` (four bases, periods with growth,
  day/week/month trends, breakdowns, receivables, profitability), `orders.ts` (pipeline, delayed, over-capacity, short ingredients),
  `subscriptions.ts` (status, run-rate incl. contracts, renewals due, expected meals, churn, cancel reasons), `customers.ts` (active/new/
  returning, frequency, historical LTV, top customers, diet preference mix, ratings, complaints), `transactions.ts` (drill-down lists using
  the metric's own where-clause), `export.ts` (CSV; `analytics.view`+`analytics.export`, PII masked without `customers.pii`, audited
  `analytics.export`).
- **Definitions chosen** (where the architecture doc left room): Bookings exclude PENDING_PAYMENT and CANCELLED single orders; a plan stays
  booked if later cancelled (unused part shows as refund/credit). Cash excludes WALLET spends and COMPANY_INVOICE placeholders, and
  WALLET_CREDIT refunds; company invoice receipts aren't dated in the schema, so they're not in cash (outstanding invoices shown under
  receivables). Deferred = paid (PAID/PARTIALLY_REFUNDED) orders Scheduled→Out for delivery or FAILED_DELIVERY, now; wallet balance only when
  no non-date filter. Channel = `User.acquisitionSource` ("not captured yet" until WP-11). Category breakdown = Σ delivered line totals.
  Timestamp ranges use Kathmandu midnight. Profitability shows "No data recorded" (null) per source, never zero-as-fact.
- **UI:** `/admin/analytics` (tabs Revenue / Orders & plans / Customers / Profitability, global filter bar), `/admin/analytics/transactions`
  (paginated drill-down for 14 bases), `/admin/analytics/export` (CSV route). Dashboard relabelled: "Gross/Net sales" → "Booked by delivery
  date"; adds Recognised, Bookings, Net cash, Deferred, run-rate, period growth chips; delayed orders and open `Alert` rows in "Needs
  attention" (WP-16 request). SVG charts in `src/components/admin/charts` (every bar/row is a link). `Kpi` gained `href`.
- `reports.ts`: `Range.kitchenIds` (multi-kitchen scope) honoured by every helper; cohorts on DELIVERED; KPI_FORMULAS gross/net/margin
  reworded. Nav: `/admin/analytics` ready.
- Tests: `tests/integration/analytics.test.ts` (20) — fixed dataset in two new kitchens, March 2021; every metric asserted against
  hand-computed values (incl. prepaid plan once in bookings / per meal in recognised, refunds incl. wallet-credit, cancellations, filters,
  kitchen scope, trends summing to totals, drill totals = metrics, export permission/masking/audit).
- **Deferred:** historical deferred-revenue snapshot "as at date" (now-only); predictive LTV (by design none); XLSX (WP-10).

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

## WP-04: Menu catalogue and weekly menu builder ✅ (L)
**Done 2026-11-05.**
- **Services (`src/server/menu.ts`):** `liveMenuWhere()` — a menu is live when PUBLISHED *or* a DRAFT whose `publishAt` has passed, so
  scheduled menus appear at read time with no cron dependency. `publishMenu` (claim via `updateMany`, archives the other live menu for the
  week/kitchen, revision, rotation re-sync, audit, revalidate), `scheduleMenu`, `cancelSchedule`, `unpublishMenu` (refused while
  `orphanedOrders()` finds booked customer-picked orders whose dabba would vanish; rotation meals re-sync), `publishDueMenus()` (idempotent
  cron hook for WP-16), `menuSnapshot` / `diffSnapshots`, `recordLiveEdit` (editing a live menu writes an EDIT revision),
  `revalidatePublicMenu()` (tag `menu` + `/menu`, `/`, `/boxes/[slug]`, `/plans/[slug]`, `/corporate/sample-menu`, `/build`),
  `bookedBoxes()` (remaining counts), `unavailableBoxIds()` (KitchenAvailability on box or any dish; without a kitchen = unavailable in every
  active kitchen). `DayOffer` gains `cutoff`, `kind`, `menuId`, `replacement`; `capacity` = min(menu-day qty, `LunchBox.maxDailyQty`), so the
  existing capacity checks in `orders.ts`/`subscriptions.ts` enforce max daily qty without edits there. `previewMenuId` / `excludeMenuId` options.
- **Revisions:** `WeeklyMenuRevision` on SCHEDULE, PUBLISH, EDIT (live save) and UNPUBLISH; `WeeklyMenu.version` = latest revision.
  Diff view on the editor page.
- **Admin:** `/admin/categories` (CRUD, ▲▼ ordering, hide, delete only when unused; nav `ready: true`). Dabba form: category, short
  description EN/NE, featured, visible, max per day, packaging cost, per-kitchen availability panel (dishes too). Week editor: kind
  (STANDARD/SEASONAL/PROMO), drag-and-drop between days with a keyboard "Move to" menu + live-region announcements, qty/day, per-day cut-off,
  "if sold out, offer" replacement, read-only when the user lacks `menu.edit`. Editor page: Publish now / Unpublish / Archive / Schedule /
  Cancel schedule (only with `menu.publish`), copy to next week, revision history with diffs, "Preview as customer"
  → `/admin/preview/menu/[id]` (staff-only, ordering disabled). Create form: copy any previous week (quantities, cut-offs, replacements;
  sold-out flags reset), kind, kitchen.
- **Public:** `getPublicWeek` hides `isVisible=false` and kitchen-unavailable dabbas, adds `remaining`, sold-out when the cap is reached,
  replacement link, per-day cut-off ("Order by HH:MM"), week kind, `isFeatured`, `category`, `shortDescription`. `/menu`: category chips,
  featured eyebrow + featured-first sort, "Only N left", "Sold out — try X", This week / Next week links. `/boxes/[slug]`: 404 for hidden
  dabbas, category/featured chips, low-stock dates. Photo vs illustration and nutrition-with-source unchanged (`BoxCard`, `boxFacts`).
- **Audit:** box/dish/category create-update-archive (before/after incl. price, packaging, visibility), availability, menu
  create/update/schedule/publish/unpublish/archive.
- **Tests:** `tests/integration/menu-admin.test.ts` (9): save validation, copy week, scheduled visibility before/after `publishAt`,
  `publishDueMenus` idempotent, revisions + diff, revalidation called, max daily qty → remaining/sold out/replacement, hidden dabbas,
  kitchen availability (box + dish level), unpublish guard with booked orders, publish permission, categories. Full suite 105/105.
- **Limits / deferred:** per-day cut-off is shown and applied to public orderability, but checkout enforcement needs WP-03 (see requests);
  without a kitchen (public site) remaining counts sum all kitchens; scheduled menus are visible at `publishAt` but booked rotation meals
  are only re-assigned when `publishDueMenus()` runs (WP-16 cron) or staff press "Publish now"; E2E acceptance 1–2 (Playwright) not written
  in this run; `LunchBox.packagingCost` is stored but `refreshBoxCosts` (`_kit/costing.ts`) still uses the "dabba" ingredient.

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

## WP-05: Builder engine ✅ (M)
**Done 2026-11-05.**
- **Engine (`builder.ts`):** `priceCustomBox(picks, settings, { kitchenId?, diet?, checkStock? })` (third argument optional; existing callers unchanged). `CustomPick` gains an optional `portionId`.
  - **Portions:** `CustomizationPortion`; unit price = (override ?? dish price) + `priceDelta`; cost × `qtyMultiplier`. With no `portionId` the first portion is used and written back to the picks. An unknown portion is refused.
  - **Diet rules:** `dietRule` takes `VEG_ONLY`/`VEGAN_ONLY`/`NO_MEAT` (options in that step must fit; non-fitting options are hidden and refused) and `VEG_BOX`/`VEGAN_BOX`/`NO_MEAT_BOX` (a pick from that step makes the whole dabba follow the level). The customer can also choose a dabba diet, which the server re-checks.
  - **Combination rules:** `REQUIRE` (and `REQUIRES`) is enforced, and admin refuses contradicting EXCLUDE/REQUIRE pairs.
  - **Kitchen availability:** `KitchenAvailability` rows per option or per dish; a missing row means available.
  - **Stock:** a soft "running low" warning from recipe × portion × `stockOnHand`. It never blocks.
  - **Results:** returns `problems[]` (all of them), `warnings[]` and `lines[]`; `problem` stays the first problem.
- **Admin (`/admin/builder`):** diet rule per step, a portions editor (signed ± Rs, size ×), per-kitchen on/off with a note, badges (no recipe / daily limit / breaks diet rule / off at kitchen), and read-only mode without `menu.edit`. Every change is audited (`builder.portion_*`, `builder.availability`, `builder.rule`, `builder.group_*`, `builder.option*`).
- **Customer (`/build`):** a diet chooser, a portion picker, an instant client preview price that is replaced by the server quote ("Price confirmed by the kitchen"), the full list of validation messages, stock warnings, and options filtered for the default kitchen. Labelled radio groups and `aria-live` make it accessible.
- **Pricing (`pricing.ts`):**
  - `CouponSpec` handles `freeDelivery` (fee → 0 on every day) and `boxIds` scope (discount only on lines whose `boxId` is listed, spread over those days).
  - `stackableCoupons` (no stacking unless all are `stackable`; `priceDays({ coupons })`).
  - Discounts are clamped so no day or total goes negative.
  - `couponDiscount(base, c, eligible?)`; `negotiatedUnitPrice(list, boxId, boxPrices)` helper for WP-12.
  - `quoteCart` already passes the full `Coupon` row and lines with `boxId`, so free delivery and box scope work at checkout with no `orders.ts` change.
- **Tests:**
  - `tests/unit/pricing.test.ts`: free delivery, box scope, no stacking, non-negative total, eligible base, negotiated price.
  - `tests/integration/builder.test.ts`: min/max, EXCLUDE/REQUIRE and contradictions, diet rules, portions, tampered client price ignored in quote and save, kitchen availability, stock warning, permission refusal, box-scoped / free-delivery / huge coupons through `quoteCart`.

**Owns:** `src/server/builder.ts`, `src/server/pricing.ts`, `src/app/admin/builder/**`, `src/app/(site)/build/**`, `src/lib/actions/build.ts`.

**Delivers:**
- **Options:** portions per option; REQUIRES rules; group diet rules; kitchen availability per option.
- **Stock check:** an ingredient-shortage soft warning.
- **Pricing:** the server stays authoritative.

**Tests:** unit pricing tests for portions and REQUIRES; tampered client prices are ignored.

**Depends:** WP-01.

## WP-06: Subscription engine ✅ (L)
**Done 2026-11-05.**
- **Versioned pricing (`subscriptions.ts`):** `planPriceOn(plan, date)` = the `MealPlanPrice` row effective that day (latest
  `effectiveFrom`, then latest created; falls back to the plan fields). Quotes use today's row; `createSubscription` stores `priceId` +
  `pricePerMeal`. `changePlanPrice(planId, { pricePerMeal, compareAtPrice, effectiveFrom ≥ today })` closes the open row the day before,
  replaces unused rows scheduled on/after that date (rows used by a subscription are only end-dated, never edited/deleted), updates the
  `MealPlan` mirror when effective today, and audits `plan.price_change` (before/after). `syncPlanPriceMirrors()` moves the mirror when a
  scheduled version becomes current (called by `/plans` and `/admin/plans`; cron hook for WP-16). `planPriceHistory()`.
- **Policies:** `weeksRange(plan)` (min/max/default weeks; `PlanInput.weeks` validated in the quote), `skipPolicyFor(plan, settings)`
  (plan `skipPolicy` overrides the global setting in `skipMeal`), `cancelPolicyFor(plan)`: `CREDIT` (default) / `REFUND` (customer cancel
  raises a `Refund` request) / `STAFF_ONLY` (no online cancel; staff still can). `renewalReminderDays` drives `completeAndRemind`
  (reminder link → `/account/plans/[id]#renew`, skipped when already renewed). `POLICY_TEXT` shown on the plan page and the customer plan.
- **Policy for modifying existing subscriptions (documented in code above `planMealPrice`):** price per meal, length, days and start are
  fixed at purchase — plan edits (price, weeks, min days) only affect new sales. Swaps and extra meals are priced at the subscription's own
  per-meal price + the dabba's surcharge over that price version's regular price. Skip/cancel policy are read from the plan when the
  action happens; the admin plan form shows how many live plans an edit touches. Staff changes (skip, unskip, pause, resume, cancel, swap)
  are audited.
- **Cut-offs:** per-day `DayOffer.cutoff` (earliest of it and the company override, else global) now applies to plan quotes, skip,
  unskip, swap and add-meal (`mealCutoff`, `earliestCutoff`); quotes also leave out days the kitchen already locked.
- **Swap (`swapMeal`, `swapOptions`):** before the day's cut-off, `SCHEDULED` meals of an `ACTIVE` plan, to any dabba on that day's menu
  (veg-only respected, capacity/sold-out checked under the kitchen-day lock). The order is re-priced (tax delta on the same basis);
  the difference settles once: paid meal → extra from wallet credit (refused when short) / saving back to wallet credit (+ payment
  `refundedAmount`); cash-on-delivery meal → the pending payment amount moves. `OrderAdjustment` + `SubscriptionChange SWAP` + status
  event; `dayChoices` updated (renewals carry it). Idempotent (same dabba → no-op) and version-checked against concurrent swaps.
- **Add a meal (`quoteAddMeal`, `addMealToPlan`, `extraMeals`):** a normal order (`source SINGLE`, `subscriptionId null` → booked once as
  its own sale) at the plan's per-meal price; delivery free when the plan includes it or a plan meal already goes that day; its
  `Payment.subscriptionId` links it to the plan; normal payment flow (`/pay/…`); idempotent on the checkout key.
- **Renewal (`renewSubscription`, `quoteRenewal`):** new subscription at today's price with `renewedFromId`, same days/address/slot/veg,
  weekday picks carried over when the dabba is on the new menu (else chef's rotation), dates from the day after the old end (or today),
  respecting menus, holidays, locks and cut-offs. Payment through the normal flow (PENDING → `/pay/…`, or wallet/cash) — never
  auto-charged. Idempotent: advisory lock on the old plan + "existing non-cancelled renewal" check → clicking twice (even concurrently)
  returns the same subscription. `SubscriptionChange RENEW` on the old plan.
- **Customer:** `src/lib/actions/plans.ts` (`quotePlanLengthAction`, `subscribePlanAction` with weeks, `swapMealAction`,
  `quoteAddMealAction`, `addMealAction`, `renewPlanAction`; user from session, services scoped by `userId`). `/plans/[slug]`: length
  picker, today's price version, policy text. `/account/plans`: renewal links + Renew. `/account/plans/[id]`: renew panel (preview),
  per-meal swap with price difference, extra meals list + add form, renewal chain, history with amounts; cancel button follows the
  cancel policy.
- **Admin:** `/admin/plans/[id]` min/max weeks, reminder days, skip/cancel policy, price versions table (current/scheduled, sold per
  version) + "Save price version" (future date). `/admin/plans` shows weeks range and policies. `/admin/subscriptions/[id]` staff swap
  (audited `plan.swap`), price version, renewal links, extra meals. **`/admin/production-calendar`** (nav ready): committed meals
  (`COOK_STATUSES`) per day × dabba for 1–6 weeks, per-kitchen daily totals, plan-meal share, awaiting-payment row (not counted), kitchen
  scope respected, links into `/admin/kitchen/requirements?kitchen=&date=` (query in `production-calendar/query.ts`).
- **Revenue:** plans still book once at purchase (meal orders carry the plan total); extra meals book once as single orders; unpaid
  renewals aren't bookings until paid; swaps move the meal order's total (recognised on delivery) and the difference sits in the wallet.
- **Tests:** `tests/integration/subscriptions-engine.test.ts` (14): price change after purchase leaves the old subscription/orders
  untouched + audited; scheduled price / no back-dating / re-schedule replaces unused row; add-meal priced at the old subscription's price,
  idempotent, booked once; IDOR on add-meal; swap credit/charge exactly once + retry no-op + adjustments net 0; wallet-short refusal + other
  customer refused; per-day cut-off (07:30) and global cut-off refuse customer swap/skip, staff allowed; renewal concurrent double-click →
  one linked subscription, today's price, PENDING payment, not booked; min/max weeks; plan skip policy CREDIT; cancel policy STAFF_ONLY /
  REFUND; production calendar totals = booked orders (overall, per day, per kitchen) + permission/scope; plan booked once. Full suite 183/183.
- **Limits / deferred:** an up-charge swap on a paid plan needs wallet credit (no "pay the difference" payment yet — see requests); no
  per-plan volume tiers; `maxPauseDays` still not enforced; production calendar counts dabbas (dish portions stay on the kitchen pages);
  E2E acceptance 3 (Playwright) not written in this run; the account home / orders pages (WP-18) still use the global cut-off for skip
  buttons.

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

## WP-08: Inventory upgrade ✅ (L)
**Done 2026-11-05.** All in `src/server/inventory.ts` (no schema change):
- **Units:** `convertQty` (shortest chain over edges, both directions), `conversionEdges` (ingredient rows → purchase unit/factor →
  global rows → KG↔G, L↔ML), `toBaseUnits`, `inPurchaseUnits`, `saveConversion`/`deleteConversion` (audited). Stock stays in the base
  unit; PO lines, receipts, returns, transfers and manual movements accept a `unit` and convert qty + cost (paisa per base unit).
  Ingredient form: category, purchase unit + factor, reorder point; ingredient page: conversions editor, open lots.
- **Lots + FEFO:** every receipt (PO or manual) opens a `StockLot` (cost, expiry, location, `poLineId`, optional supplier lot code).
  `drawStock` takes stock FEFO (expiry asc, nulls last, then receivedAt) under a per-ingredient advisory lock + `SELECT … FOR UPDATE`
  on lots, guarded decrement (a lot can't go negative), then unlotted stock (on hand − Σ lots), then — batch/manual usage only — a
  **recorded shortage** (movement note `SHORTAGE: …`, `stock.shortage` audit, returned to the caller); transfers/returns refuse instead.
  One movement row per lot drawn, with the lot's cost.
- **`postBatchStock` moved** from `kitchen.ts` (re-exported there; `advanceBatch` unchanged). Uses `scaleRecipe` + FEFO; idempotency key
  `batch:<id>:<usage|waste>:<ingredientId>` unchanged, lot splits get `:2`, `:3` in the same transaction. Returns `{ shortages }`.
- **Locations:** `listLocations`, `saveLocation` (unique per kitchen, can't archive with stock), `moveLot` (audited).
- **Transfers:** `transferStock` — one transaction: TRANSFER_OUT rows (FEFO) in the source kitchen + TRANSFER_IN rows opening lots with
  the same cost/expiry in the destination; both kitchens must be in the actor's scope; refuses more than on hand; audited before/after.
  `listTransfers` (either end in scope). One-step (status RECEIVED); no in-transit state.
- **Returns:** `returnToSupplier` — RETURN rows against a PO line (that line's lots first), capped at received − already returned and
  at stock; reason required; audit `po.return` with on-hand before/after + credit (Σ qty × lot cost). `purchaseReturns`,
  `returnedByLine`, `supplierInvoicesForPO` (read-only link to WP-09's `SupplierInvoice`, shown on the PO page).
- **Valuation:** `stockValuation(kitchenIds)` = Σ lot remaining × lot cost + unlotted (≥ 0) × latest cost; used by the stock page.
- **Alert data for WP-16** (all take `kitchenIds | null`, return `InventoryAlert { type, severity, kitchenId, entity, entityId,
  dedupeKey, message, data }`): `lowStockAlerts`, `expiringLotAlerts`, `unexpectedConsumptionAlerts`, `stockDiscrepancyAlerts`
  (negative on-hand = open shortage; lots > ledger drift), `lateDeliveryAlerts`, and `inventoryAlerts` (all of them).
- **Recipe scaling:** `scaleRecipe` (net + gross with waste%), `recipeForProduction(menuItemId, portions, kitchenId)`.
- **Permissions/scope:** new service functions take an actor and check `inventory.*` + kitchen scope themselves; every inventory page
  resolves the kitchen through `pickKitchen` (scope); the PO page 404s out of scope; adjustments/waste/returns/transfers audited with
  before/after + reason (`recordMovement` now audits itself).
- **UI** (`src/app/admin/inventory/**`, own tabs in `_components/`): stock (category filter, purchase-unit display, shortages), stock
  health, lots & expiry (move lot), transfers, locations, recipe scaling, PO page (receive in purchase units + location + lot code,
  returns, invoices), movement form (units, location). No nav change needed (sub-routes of `/admin/inventory`).
- Tests: `tests/integration/inventory-upgrade.test.ts` (10: conversion maths + PO/receipt conversion, FEFO across lots + unlotted +
  shortage, batch FEFO + shortage + idempotent retry, atomic transfer + refusal + concurrent transfers never negative, scope/permission
  refusal, purchase return cap + credit + audit, valuation, alert data scoped). `ops.test.ts` unchanged and green.
- **Deferred:** two-step transfers (SENT → in transit → RECEIVED); valuation CSV export (`inventory.export`); recipe lines in non-base
  units; E2E acceptance 9 (WP-20 Playwright).

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

## WP-09: Finance: expenses, payables, settlement, profitability ✅ (L)
**Done 2026-11-05** (invoice-numbering settings and live gateway formats deferred, see below).
- **Server** `src/server/finance/`: `common.ts` (actor permission checks `assertCan` → `FinanceDenied`, period guard `assertPeriodOpen`,
  finance config in `Setting "finance.config"` = `{ feeBps per method, chartOfAccounts }`, `estimateGatewayFee`), `expenses.ts`,
  `payables.ts`, `settlement.ts` (daily settlement, accounting periods, cash flow), `statements.ts`, `journal.ts`, `profitability.ts`.
  Every write re-checks permissions on the server and is audited; approvals carry `approvedById`.
- **Expenses:** DRAFT → APPROVED → PAID, DRAFT → VOID; numbers `EXP-YYYYMM-NNNN`; receipt upload (existing `storeUpload`, image/PDF);
  effective date + kitchen (kitchen-scoped staff must tag one of theirs). No self-approval (owner / super admin excepted). Approved
  entries are immutable: `reverseExpense` posts a negative mirror (`reference = REV:<number>`, same status) dated in an open month;
  `correctExpense` = reversal + new draft. Reversals net out in every total (analytics `profitability()` sums amounts).
- **Accounting periods:** `closePeriod` (month ended; no drafts; no open settlements) / `reopenPeriod` (owner / super admin, reason).
  A closed month refuses create / edit / approve / void / reversal / supplier invoice / supplier payment / settlement dated in it.
- **Payables:** supplier invoices (unique per supplier + number, optional PO, scan upload), payments ≤ outstanding (advisory lock),
  reversing payments (negative row), void only when nothing paid, ageing by supplier (not due / 1–30 / 31–60 / 61–90 / 90+ from due date
  or invoice date), three-way match hint (PO ordered vs received qty × cost vs invoiced subtotal, Rs 1 / 1 % tolerance).
- **Daily settlement:** cash per kitchen (expected = Σ route `cashCollected`, suggested = Σ `cashHandedIn`), eSewa / Khalti company-wide
  (expected = payments paid that KTM day, suggested = matched statement lines), bank (verified transfers). Expected is recomputed on save
  and close; variance = counted − expected; a non-zero variance needs a note to close; closed rows are locked. NULL-kitchen rows are
  de-duplicated in code (find-first under an advisory lock).
- **Gateway statements:** CSV upload (loose header matching: transaction UUID / pidx / purchase order id / reference, amount, fee, date;
  rupees or paisa; DD/MM/YYYY accepted) → `GatewayStatementLine`, matched by `PaymentAttempt.providerRef`, `Payment.reference` or
  `<reference>-<n>`; idempotent on `(provider, providerRef)`; report: unmatched, wrong-method, repeated in file, duplicate payments (a
  payment on > 1 line), amount differences, settled-but-not-paid-here, row errors. Manual match for unmatched lines.
  `duplicatePaymentSuspects` = same customer + amount paid within 10 minutes (shown on `/admin/payments?view=reconcile`).
- **Fees:** `markPaymentPaid` (and cash `recordCashCollected` completing a payment) sets `Payment.gatewayFee` from the configured rate
  (0 when not configured — nothing invented); statement import sets `feeActual` = Σ matched line fees.
- **Cash flow:** by KTM day: in = eSewa/Khalti/bank/cash payments paid; out = refunds paid out (not wallet), expenses PAID (by expense
  date, incl. VAT), supplier payments, gateway fees (actual else estimate). Company-invoice receipts excluded (no per-payment dates).
- **Journal export** `/admin/settlements/journal` (CSV: date, journal, entry, account_key, account, debit, credit, memo): receipts, gateway
  fees, refunds, expenses (+ input VAT, + payment when PAID; reversals post the opposite way), supplier invoices and payments; every entry
  balances. ⛔ Chart of accounts: lines carry internal keys (`cash.ESEWA`, `expense.RENT`, …) mapped through `chartOfAccounts`
  (editable on `/admin/settlements?tab=settings`, `settlements.approve`); unmapped keys export as `UNMAPPED <key>`. Needs
  `expenses.export`; audited (`finance.journal_export`, with unmapped keys).
- **Profitability** `/admin/profitability`: `profitAndLoss()` wraps analytics `profitability()` (same Estimated / Recorded split) and adds
  column totals, estimated vs recorded profit, per-month coverage (expenses, drafts, settlements, statement lines) and period
  close / re-open. The bottom line reads "Net profit (closed periods)" only when every month in range is closed, else "Operating estimate".
- **UI:** `/admin/expenses` (+ `[id]`: edit draft, approve, pay, void, reverse, correct, receipt, history), `/admin/payables` (invoices,
  ageing; `[id]`: 3-way hint, payments, reverse, void), `/admin/settlements` (daily, statements import, cash flow, journal, fees &
  accounts), `/admin/profitability`; payment detail shows fee estimate / statement fee / statement lines. Nav entries flipped to ready.
- **WP-04 request:** `refreshBoxCosts` uses `LunchBox.packagingCost` when > 0 (falls back to the stocked dabba ingredient).
- **Permissions used:** expenses.{view,create,approve,export}, purchasing.{view,create,approve}, settlements.{view,edit,approve},
  analytics.view (profitability). Period close = settlements.approve + expenses.approve. Journal / cash-flow tabs need expenses.view
  (cash flow also analytics.view).
- Tests: `tests/integration/finance-erp.test.ts` (16): approval + approver in audit + no self-approval, draft edit/void rules, reversal not
  overwrite, closed period blocks back-dated writes / re-open, payables partial pay + reversal + ageing, three-way match, settlement
  variance + note + lock, null-kitchen de-dup, fee estimate on mark-paid, statement import match / unmatched / in-file duplicate /
  duplicate payment / not-paid-here / fee actuals / idempotent re-import, double-checkout detection, profitability estimated vs recorded
  + honest label before/after close, cash flow, journal balance + mapping + permission + audit, box packaging cost.
- **Deferred:** invoice-numbering settings (company invoices are `invoices.ts`, not owned here); live eSewa/Khalti statement formats
  (⛔ merchant keys — header aliases in `statements.ts COLUMNS` to extend); expense allocation of overheads by meals per kitchen;
  automatic Alert rows for duplicates (WP-16, request below).

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

## WP-17: Audit infrastructure ✅ (S)
**Done 2026-11-05.** `src/lib/request-context.ts` (`getRequestContext`, `runWithRequestContext`, `contextFromHeaders`): request id from
`x-request-id` → `x-vercel-id` → `x-correlation-id` (sanitised) or a generated UUID, memoised per request with React `cache()`; IP from
`x-forwarded-for`/`x-real-ip`; user agent (300 chars). `audit()` keeps both signatures and adds optional `approvedById`, `requestId`, `ip`,
`userAgent`; it fills requestId/IP/UA automatically. Redaction (`redactSecrets`, `isSecretKey`) runs on before/after/summary/reason:
password/token/OTP/PIN/CVV/signature/cookie/authorization/API-key/secret keys, Luhn-valid card numbers, Bearer tokens and JWTs. Its own
list, not the logger's (that one also hides `code`/`key`, which would blank order codes, coupon codes and setting keys; `panVat` is kept).
`/admin/audit` on the UI kit: filters for text, person (incl. System), record type, action prefix, record ID, request ID, approvals only
and date range (Kathmandu days); sortable, URL-paginated; saved views; a details drawer (approver, request ID → all entries of that request,
IP, device, full diff); deep links to records (`_kit/links.ts recordHref`). Query/permission logic in `src/app/admin/audit/query.ts`
(`searchAudit` throws without `audit.view`).
Tests: `tests/integration/audit.test.ts` (13: header context, shared request id + approver, legacy signature, redaction, filters, date
range, deep links, permission incl. custom-role grant).
**Owns:** `src/lib/audit.ts`, `src/lib/request-context.ts` (new), `src/app/admin/audit/**`.

**Delivers:** request id, IP and user agent filled automatically; `approvedById`; search by actor, entity, action and date; deep links to records; redaction of secret-looking keys in before/after.

**Tests:** a secret field is redacted; filters work.

**Depends:** WP-00.

## WP-18: Customer dashboard and frontend states ⬜ (M)
**Owns:** `src/app/(site)/account/page.tsx`, `src/app/(site)/account/{orders,wallet,notifications,support,profile}/**`, `src/app/(site)/account/payments/**` (new), and `loading.tsx` files under `src/app/(site)/**` and `src/app/admin/**`.

**Delivers:** an account home with today's lunch (live status), upcoming lunches, a calendar view, active plans, credits and a payment history page; loading, empty and error states.

**Tests:** E2E (acceptance 12): the customer sees status updates through to delivered.

**Depends:** none beyond WP-00. It can start in wave A.

## WP-19: Admin UI kit ✅ (M)
**Done 2026-11-05.** Components (`src/components/admin/`): `DataTable` + `TablePager` (URL sort/paging, compact density, aria-sort),
`Filters.tsx` (`FilterForm`, `Field`, `DateRangeFields`, `StatusSelect`, `TextFilter`), `SavedViews`, `Dialog.tsx` (`Dialog`,
`DialogTrigger`, `Drawer`, `ConfirmDialog` for bulk/destructive actions; native `<dialog>` + `showModal`), `States.tsx` (`LoadingState`,
`Skeleton`, `ErrorState`, `StatusBadge`, `StatusDot`, re-exports `EmptyState`), `Timeline`, `ExportButton`, `CommandPalette` +
`SearchTrigger` (⌘K / Ctrl+K / "/", mounted once in `AdminShell`). Pure helpers `src/app/admin/_kit/params.ts` (list params, date range,
links, saved-view serialization). Server: `_kit/search.ts` (`globalSearch`: orders by code/number within kitchen scope, customers by name
— email/phone only with `customers.pii`, masked otherwise —, dabbas, companies; each group gated by its page permission),
`_kit/saved-views.ts`, `_kit/actions.ts` (server actions), `_kit/links.ts`. Reference adoption: `/admin/audit`.
`loading.tsx` files are WP-18's, so none were added; `LoadingState` is ready for them.
Tests: `tests/unit/admin-kit.test.ts` (11), `tests/integration/search.test.ts` (6: masking, no PII probing, kitchen scope, group
permissions, saved-view privacy/IDOR/cap).
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
| WP-08 | WP-07 | Move `postBatchStock` from `kitchen.ts` to `inventory.ts` (WP-08 does the move first; WP-07 rebases) | done (WP-08: moved, re-exported from `kitchen.ts`; `advanceBatch` unchanged) |
| WP-08 | WP-07 | Production dashboard: surface `postBatchStock(...).shortages` (today ignored by `advanceBatch`) and use `recipeForProduction` / `scaleRecipe` (inventory.ts) instead of the duplicate `bomNeed` in `requirements()` if wanted | open |
| WP-08 | WP-09 | Purchase-return credit: create the supplier credit / reduce payable from `purchaseReturns(poId).credit` (audit `po.return` carries lines + credit); invoices are shown read-only on the PO page via `supplierInvoicesForPO`. Food cost can use lot cost from USAGE/WASTE `StockMovement.unitCost` | open |
| WP-08 | WP-16 | Detectors: call `inventoryAlerts(kitchenIds)` or the single functions (`lowStockAlerts`, `expiringLotAlerts`, `unexpectedConsumptionAlerts`, `stockDiscrepancyAlerts`, `lateDeliveryAlerts`) from `src/server/inventory.ts`; each row has a stable `dedupeKey` | open |
| WP-08 | WP-10 | Inventory valuation report → `stockValuation(kitchenIds)` | open |
| WP-08 | WP-19 | `src/components/admin/ops/InvTabs.tsx` is no longer used (inventory pages use `src/app/admin/inventory/_components/InventoryTabs.tsx`); delete when convenient | open |
| WP-12 | WP-03 / WP-05 | Negotiated per-box company price hook in `quoteCart` (`orders.ts`) → call `corporate.ts priceFor(company, boxId)` | WP-05 part done: pure helper `negotiatedUnitPrice(list, boxId, boxPrices)` in `pricing.ts`. The call must go in `quoteCart` box lines (`unitPrice`) → WP-03 |
| WP-15 | WP-05 | `pricing.ts` must respect `Coupon.freeDelivery` (delivery fee → 0) and `boxIds` scope | done (WP-05) |
| WP-05 | WP-15 | `checkCoupon` (`coupons.ts`) refuses a coupon whose discount is 0, so a pure free-delivery coupon (value 0) is rejected. Allow `freeDelivery` coupons with 0 discount; for `boxIds` coupons, check `minSubtotal`/discount on the eligible lines (needs the lines passed in) | planned |
| WP-05 | WP-03 | `quoteCart` / subscriptions: pass `{ kitchenId }` to `priceCustomBox` so per-kitchen option availability is enforced at checkout (today it's enforced in the builder's quote/save only) | planned |
| WP-05 | WP-11 | `saveCustomBoxAction` (`shop.ts`) drops `portionId` when it re-maps items. Keep `portionId` | planned |
| WP-11 | WP-03 | Pass `attribution` into `placeCartOrder` | planned |
| WP-17 | (middleware owner / WP-20) | `src/middleware.ts`: stamp `x-request-id` on the request (`NextResponse.next({ request: { headers } })`) and echo it on the response, for all routes (matcher today covers only protected paths). Until then `request-context.ts` falls back to `x-vercel-id` or a generated id per request | open |
| WP-19 | WP-18 | Admin `loading.tsx` / `error.tsx` can use `LoadingState` / `ErrorState` from `src/components/admin/States.tsx` | open |
| WP-04 | WP-03 | Enforce per-day cut-off at checkout: in `quoteCart` use `offer.cutoff` (from `getOffersForDates`) — earliest of it and `company.cutoffOverride` — when calling `dateProblem` | open |
| WP-04 | WP-06 | Same per-day cut-off (`DayOffer.cutoff`) for plan picks/swaps (`changeWindowOpen(…, cutoff)`) in `subscriptions.ts` | done (WP-06: quotes, skip, unskip, swap, add-meal) |
| WP-04 | WP-16 | Call `publishDueMenus()` (exported from `src/server/menu.ts`) in the housekeeping / frequent cron so scheduled menus get their revision + rotation re-sync | open |
| WP-04 | WP-09 / WP-03 | Use `LunchBox.packagingCost` (when > 0) in `refreshBoxCosts` (`src/app/admin/_kit/costing.ts`) and snapshot it to `Order.packagingCost` | WP-09 part done (`refreshBoxCosts`). Snapshot `box.packagingCost × qty` to `Order.packagingCost` in `orders.ts` → WP-03 (the profitability "Packaging estimated" line reads it) |
| WP-16 | WP-02 | Dashboard "Needs attention" banner reads open `Alert` rows (`src/app/admin/page.tsx`) | done (WP-02: counts open/ack alerts by severity → `/admin/alerts`; the computed rows stay until WP-16 removes them) |
| WP-02 | WP-10 | `/admin/reports` still labels `salesSummary` "Gross sales"/"Net sales"; relabel to "Booked by delivery date" (formula text already updated in `KPI_FORMULAS`) and reuse `src/server/analytics` for report totals | planned |
| WP-02 | WP-09 | `/admin/profitability` should build on `analytics/revenue.ts profitability()` (same Estimated/Recorded split) and add period close | done (WP-09: `finance/profitability.ts profitAndLoss()` wraps it) |
| WP-09 | WP-16 | Raise `Alert` rows for duplicate payments: call `duplicatePaymentSuspects(since)` and `statementDuplicates()` (`src/server/finance/statements.ts`) from the alerts detector cron; also unmatched statement lines older than 3 days (`unmatchedLines()`) and settlements with a variance left open | open |
| WP-09 | WP-10 | Reports center can reuse `cashFlow`, `payablesAgeing`, `buildJournal`, `expenseTotals` (`src/server/finance/*`) for finance reports instead of re-querying | open |
| WP-09 | `invoices.ts` owner | Company-invoice payments are only `Invoice.paidAmount` (no dated rows), so cash flow and the journal can't include them; record each receipt with a date (e.g. reuse `Payment` with method COMPANY_INVOICE, or a receipt table) | open |
| WP-06 | WP-11 | Renew / swap / add-meal server actions in `src/lib/actions/shop.ts` (WP-06 may add new exported actions in a new file `src/lib/actions/plans.ts` instead) | done (WP-06 in `src/lib/actions/plans.ts`; `shop.ts quotePlanAction/subscribeAction` ignore `weeks` — `/plans/[slug]` now uses the plans.ts versions, WP-11 may drop the old ones) |
| WP-06 | WP-16 | Daily cron: call `syncPlanPriceMirrors()` (scheduled plan price becomes the `MealPlan` mirror read by home/CMS pricing tables) next to `completeAndRemind()` | open |
| WP-06 | WP-09 | "Pay the difference" for a swap up-charge on a paid plan when wallet credit is short: a Payment for the delta whose `markPaymentPaid` applies the pending swap (today WP-06 refuses and asks for credit) | open |
| WP-06 | WP-18 | Account home / orders `MealActions`: use the per-day cut-off (`earliestCutoff(DayOffer.cutoff, company)`) like `/account/plans/[id]`; link "Renew" for plans ending soon (`/account/plans/[id]#renew`) | open |
| WP-06 | WP-00 / WP-20 | `tests/integration/access.test.ts` assumes exactly one `MealPlanPrice` per plan; limit it to seeded plans (WP-06's test trims its plans' history in `afterAll` meanwhile) | open |

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
| 2026-11-05 | WP-05 | Builder engine: portions, diet rules, REQUIRE, kitchen availability, stock warning, preview + server price; pricing: free-delivery and box-scoped coupons, no stacking, non-negative totals |
| 2026-11-05 | WP-17 | Request context, audit requestId/IP/UA/approver, secret redaction, searchable audit UI; 13 tests |
| 2026-11-05 | WP-19 | Admin UI kit, ⌘K global search with permission filtering, saved views; audit page migrated; 17 tests |
| 2026-11-05 | WP-04 | Menu catalogue and weekly menu builder: categories, dabba fields, kitchen availability, DnD editor, scheduled publish (read-time), safe unpublish, revisions + diff, preview, public menu upgrades; 9 integration tests |
| 2026-11-05 | WP-02 | Analytics engine, `/admin/analytics` + drill-down + CSV export, dashboard relabel; 20 integration tests |
| 2026-11-05 | WP-08 | Inventory upgrade: unit conversions, lots + FEFO with recorded shortages, `postBatchStock` moved, locations, kitchen transfers, purchase returns, lot valuation, alert read functions, recipe scaling; 10 integration tests |
| 2026-11-05 | WP-09 | Finance: expenses (approval, reversals), payables + ageing + 3-way hint, daily settlement + lock, statement import + duplicate detection, fee estimate/actual, period close, cash flow, journal CSV (mappable accounts), `/admin/profitability`; 16 integration tests |
| 2026-11-05 | WP-06 | Subscription engine: versioned plan prices, per-plan weeks/skip/cancel/reminder policies, swap with exact-once settlement, add a meal, one-click idempotent renewal, per-day cut-offs, `/admin/production-calendar`; 14 integration tests |
