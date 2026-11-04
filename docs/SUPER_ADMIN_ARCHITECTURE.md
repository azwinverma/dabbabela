# Super Admin Control Center: architecture

_Status: target design, 2026-11-04._ It describes how the single integrated system works today and how the gaps found in
[FEATURE_AUDIT.md](FEATURE_AUDIT.md) will be closed. Work is sequenced in [ADMIN_IMPLEMENTATION_TRACKER.md](ADMIN_IMPLEMENTATION_TRACKER.md).

## 1. One integrated system (not separate apps)

```
                 ┌──────────────── one Next.js 15 app on Vercel (sin1) ────────────────┐
 Public site  ── │ src/app/(site)    marketing, menu, builder, plans, checkout, /account  │
 Company admins ─│ src/app/team      corporate portal (company-scoped)                   │
 Riders ──────── │ src/app/rider     today's routes, OTP hand-off                        │
 Staff ───────── │ src/app/admin     control room (permission-scoped)                    │
                 │ src/app/api       auth, payment returns, cron, upload, exports, health │
                 │        │                                                              │
                 │ src/lib   auth/RBAC · settings · money · CMS store · i18n · audit      │
                 │ src/server  business services (orders, subscriptions, payments,        │
                 │             kitchen, inventory, dispatch, invoices, reports …)         │
                 └────────┬──────────────────────────────────────────────────────────────┘
                          │ Prisma (one schema)            Vercel Blob (media) · Cron (jobs)
                    Neon PostgreSQL
```

* **The same code paths serve staff and customers.** Business rules live in `src/server/*` and are called by both admin
  server actions and customer server actions. An order placed by staff (manual order, WP-03) goes through
  `quoteCart`/`placeCartOrder`, exactly like a customer checkout. Prices, capacity, coupons and tax are computed once,
  on the server.
* **One identity table.** `User` holds customers, staff and riders. A company admin is a customer with an
  `ADMIN` `CompanyMember` row. Sessions come from Better Auth (DB-backed, revocable).
* **Admin changes show up on the public site straight away.** Public pages read the same tables. Cached reads (`unstable_cache` with tag `cms`, settings
  cache) are invalidated with `revalidateTag`/`revalidatePath` inside the publishing action. No separate deploy is needed.
* **Snapshots protect history.** Orders snapshot price, components, recipe version, tax rule and address, so later catalogue
  edits never rewrite past orders or payments (acceptance criterion 18).

## 2. Authorisation model (granular, backward compatible)

### 2.1 Today
`Role` enum on `User` → fixed matrix `PERMISSIONS` (≈37 coarse keys) in `src/lib/permissions.ts`. Enforcement:
`requirePermission(perm)` in every admin page/action. Kitchen scope comes from `User.kitchenId`. Company scope comes from `requireCompanyAdmin()`.

### 2.2 Target
**Permission = `module.action`.**
- **Modules:** `dashboard, analytics, orders, subscriptions, menu, recipes, builder, plans, kitchen, inventory,
purchasing, dispatch, rider, customers, corporate, leads, support, payments, refunds, invoices, expenses, settlements,
pricing, marketing, content, media, seo, staff, roles, settings, notifications, alerts, audit, privacy, reports`.
- **Actions:** `view, create, edit, delete, publish, approve, export, refund, settings`. Not every pair is meaningful; the
registry lists the valid ones.

```
src/lib/permissions/registry.ts   MODULES × ACTIONS registry (labels for the role editor)
src/lib/permissions/system.ts     SYSTEM_ROLE_GRANTS: Role → Permission[]  (generated from today's matrix)
src/lib/permissions/legacy.ts     LEGACY_MAP: old key → new keys  (e.g. "orders.manage" → orders.edit+orders.delete…)
src/lib/permissions/index.ts      can(user, perm, scope?) · permissionsFor(user) · scopeWhere(user, model)
```

* **System roles stay.** The `Role` enum is the *base* role; its grants equal today's matrix, so nothing changes for
  existing users on day one. Old keys keep working through `LEGACY_MAP`. `requirePermission("orders.manage")` is
  still valid while modules migrate.
* **Custom roles.** `StaffRole { key, name, permissions String[], isSystem }`. `User.staffRoleId` optionally adds a custom role.
  - **Effective permissions** = base-role grants ∪ custom-role grants.
  - **New presets:** "Kitchen Manager" and "Delivery Manager" (brief §14) ship as seeded custom roles, so the `Role` enum doesn't need to change.
* **Escalation guards.**
  - You can only grant permissions you hold yourself.
  - `roles.*` and `staff.*` with SUPER_ADMIN still require SUPER_ADMIN.
  - The last active super admin can't be removed (existing rule).
  - Every grant change is audited with before/after.
* **Scopes.** `StaffScope { userId, kitchenId?, companyId? }` (many rows), with `User.kitchenId` kept as the primary.
  - `scopeWhere(user, "order" | "stockMovement" | …)` returns a Prisma `where` fragment, and every list/report/export query uses it. Unscoped (`[]`) means all kitchens.
  - Company scope for staff (e.g. an account manager) uses the same table. Company admins in `/team` stay on `requireCompanyAdmin()`.
* **Sessions and login activity.**
  - `LoginEvent { userId, ip, userAgent, method, success, createdAt }` is written from Better Auth hooks (`src/server/auth.ts`).
  - Staff page: list sessions, revoke one, or revoke all.
  - MFA: the `staff2fa` flag already forces TOTP for every staff role in production.
* **UI.** The sidebar (`src/components/admin/nav.ts`) filters by `can(user, item.perm)`, and pages render action buttons only when
  permitted. **The server check is the authority; hiding a button is cosmetic.**

## 3. Request context, audit and correlation
`src/lib/request-context.ts` builds `{ requestId, ip, userAgent }` from `headers()`, with `x-vercel-id` when present, otherwise a random id.
`audit()` reads it automatically and fills `AuditLog.requestId`, `ip` and `userAgent`. Approvals (refund approve, credit over a threshold,
price change after publish) write `approvedById` plus a `reason`. Passwords, tokens, OTPs, signatures and card or gateway credentials never
enter `before`/`after` (the existing logger redaction list is reused for audit payloads).

## 4. Analytics: metric definitions (single source of truth)

All metrics live in `src/server/analytics/metrics.ts` as `{ key, label, definition, sql|prisma query, unit, permission }`.
- **Display:** the dashboard and reports render the definition next to every number, as `KPI_FORMULAS` does today.
- **Calculation:** every metric is computed in the database (aggregate/groupBy/`$queryRaw` with tagged templates), never in the browser.
- **Tests:** each metric has a test that seeds known rows and compares the result against hand-computed SQL.

### 4.1 Revenue bases (the brief requires these to stay distinct)
| Basis | Definition | When it moves |
|---|---|---|
| **Bookings** | Σ `total` of orders + subscriptions **created** in the range, any payment status except CANCELLED. Plans count once, at purchase. | Purchase time |
| **Cash collected** | Σ `Payment.amount` with `paidAt` in range (status PAID / PARTIALLY_REFUNDED / REFUNDED) − Σ refunds processed in range | Money in/out |
| **Recognised revenue (net of tax)** | Σ (`order.total − order.tax − order.refundedAmount`) for orders with status **DELIVERED** and `deliveryDate` in range | Meal handed over |
| **Scheduled (future) revenue** | Same formula for SCHEDULED/CONFIRMED/PREPARING/PACKED/OUT_FOR_DELIVERY orders | Informational |
| **Deferred revenue (liability)** | Recognised-basis value of paid, not-yet-delivered orders + wallet `CreditLedger` balance | Snapshot at date |

**Prepaid plans.** A plan purchase creates one order per meal, each carrying its share of the plan price (`Order.subtotal/discount/tax/total`
allocated with `allocate()` in `src/lib/money.ts`). So:
* the sale shows up **once** in *Bookings* and *Cash* when paid;
* each meal shows up in *Recognised revenue* on its delivery day;
* skipped meals: under EXTEND the order moves to a later date and is recognised then. Under CREDIT the order is SKIPPED (never recognised),
  and the credit sits in deferred revenue until it's spent on another order (recognised then) or refunded;
* a plan is never counted as new revenue each day a meal goes out. The current dashboard "Gross sales" (statuses SCHEDULED→DELIVERED by delivery date) becomes
  **"Booked by delivery date"**, and *Recognised* is added next to it.

### 4.2 Other key definitions
* **AOV** = recognised revenue ÷ count of DELIVERED orders (meal-orders; a plan contributes one order per meal).
* **Plan run-rate ("MRR-equivalent")** = Σ over ACTIVE and PAUSED subscriptions covering today of
  `(total − tax) ÷ planDays × 30`, where `planDays = endDate − startDate + 1`. Corporate contracts add
  `pricePerMeal × minMealsPerDay × service days in the next 30`. Renewal is manual, so it's labelled a *run-rate*, not contracted recurring revenue.
* **Churn (plans)** = plans CANCELLED in range ÷ plans ACTIVE at range start (existing).
* **Retention cohorts** = share of customers whose first DELIVERED order fell in month M who have a DELIVERED order in month M+k (existing `cohorts()`,
  switched to DELIVERED).
* **LTV (historical)** = Σ recognised revenue per customer since signup. Shown with its customer count; no predictive LTV.
* **Delayed order** = OUT_FOR_DELIVERY (or PACKED) with now > slot end (Kathmandu).
* **Over capacity** = `capacity.dayCapacity` < live meals for that kitchen-day.
* **Unavailable ingredients** = `kitchen.requirements()` shortage > 0 for a locked or tomorrow's day.

### 4.3 Profitability: estimated vs actual
| Line | Estimated source | Actual (reconciled) source |
|---|---|---|
| Food cost | `Order.costTotal` (recipe snapshot) | Σ USAGE + WASTE `StockMovement` value (lot cost when lots exist) |
| Packaging | `LunchBox.packagingCost` × qty snapshot to `Order.packagingCost` | `Expense` category PACKAGING |
| Delivery | `DeliveryRoute.cost` allocated per stop | `Expense` category DELIVERY (rider wages, fuel) |
| Gateway fees | `Payment.gatewayFee` = amount × fee bps (Setting per method) at verification | Statement import (`GatewayStatement`) sets `feeActual` |
| Discounts / refunds | Order fields | — (already actual) |
| Labour, rent, overhead, marketing | — | `Expense` categories LABOR, RENT, UTILITIES, MARKETING, OTHER (allocated by meals per kitchen) |

The P&L page has three columns: **Estimated** (snapshots only), **Actual** (reconciled ledgers) and **Coverage** (which periods have
reconciled expenses). Net profit is shown only for periods marked closed (`AccountingPeriod.closedAt`); until then it reads
"Operating estimate". Nothing estimated is ever labelled as final accounting profit.

## 5. Finance additions
* **Payables:**
  - `ExpenseCategory { key, name, kind }`, seeded.
  - `Expense { date, categoryId, kitchenId?, supplierId?, amount, tax, method, reference, attachmentUrl, status DRAFT|APPROVED|PAID|VOID, approvedById }`.
  - Expenses are never hard-deleted; they're voided instead.
* **Supplier invoices:** `SupplierInvoice { supplierId, poId?, number, date, dueDate, subtotal, tax, total, paidAmount, status }`,
  plus `SupplierPayment { invoiceId, amount, method, reference, paidAt }`. Three-way match: PO ↔ receipt movements ↔ invoice.
* **Daily settlement:** `DailySettlement { date, kitchenId, method, expected, counted, variance, note, closedById }`.
  - Cash comes from routes (`cashCollected`/`cashHandedIn`).
  - Gateways come from statement import, bank from verified transfers.
* **Duplicate payment detection:** an alert when two PAID payments share user + amount + a 10-minute window, or when one provider ref maps to two attempts.
  `PaymentAttempt.providerRef` is already unique.
* **Accounting export:** a journal CSV (`date, account, debit, credit, memo, reference`) mapped through `Setting.chartOfAccounts`, editable
  by finance. ⛔ The chart of accounts needs the accountant.
* **Tax:** unchanged mechanism (effective-dated `TaxRule`). ⛔ Policy needs registration and tax advice; nothing is hardcoded.

## 6. Menu, builder and subscriptions
* `MealCategory { slug, name, nameNe, sortOrder }` → `LunchBox.categoryId`.
- **Box fields:** `LunchBox.shortDescription(+Ne)`, `isFeatured`, `isVisible`, `maxDailyQty`, `packagingCost`.
- **Kitchen availability:** `KitchenAvailability { kitchenId, boxId?, menuItemId?, optionId?, isAvailable }`. A missing row means available.
* **Weekly menus:**
  - New fields: `WeeklyMenu.kind STANDARD|SEASONAL|PROMO`, `publishAt` (scheduled, picked up by cron), `version`.
  - `WeeklyMenuRevision { menuId, version, snapshot Json, action, actorId }` is written on every publish/unpublish.
  - `MenuDay.cutoffOverride`, `MenuDayItem.replacementBoxId`.
  - Unpublishing is refused while paid non-rotation orders reference the week. Rotation orders re-sync (`syncRotationOrders`).
* **Builder:**
  - `CustomizationPortion { optionId, label, qtyMultiplier, priceDelta }`.
  - `CustomizationGroup.dietRule` (e.g. VEG_ONLY when the base is veg-only).
  - `ComboRule.kind` gains `REQUIRES`.
  - Availability check: `MenuItem.dailyLimit` plus ingredient shortage from inventory (soft warning on the menu, hard block at lock).
* **Plans:**
  - `MealPlanPrice { planId, pricePerMeal, compareAtPrice, effectiveFrom, effectiveTo }`. Quotes use the price effective on the purchase date and
    store `Subscription.priceId`. Changing a price creates a new row; existing subscriptions keep theirs.
  - Plan policy fields: `minWeeks`, `maxWeeks`, `skipPolicy?` (overrides the global setting), `cancelPolicy?`, `renewalReminderDays`.
  - Renewal = "Renew" creates a new subscription pre-filled from the old one (days, picks, address) and goes to checkout. `Subscription.renewedFromId` links them.
  - Swapping a day's pick before the cut-off re-prices the delta (charge or credit via `OrderAdjustment` + `CreditLedger`).

## 7. Kitchen and inventory additions
* **Kitchen fields:** `Kitchen.managerId`, `openTime`, `closeTime`, `workingDays Weekday[]`, `status OPEN|PAUSED|CLOSED`, `statusNote`.
  - A PAUSED or CLOSED kitchen takes no new orders (checked in `calendar.orderableDates` and `capacity`).
* **Inventory:**
  - **Units:** `UnitConversion { ingredientId?, fromUnit, toUnit, factor }`, plus `Ingredient.purchaseUnit` and `purchaseFactor`. Stock stays in the base unit;
    POs and receipts convert.
  - **Lots:** `StockLot { ingredientId, kitchenId, locationId?, code, receivedQty, remainingQty, unitCost, expiresOn, receivedAt, poLineId? }`.
    `StockMovement.lotId` links each movement to a lot.
  - **Consumption:** `postBatchStock` consumes FEFO (first expiry, first out) across lots inside the same transaction with `SELECT … FOR UPDATE` on lots. The idempotency key is unchanged.
  - **Locations and transfers:** `InventoryLocation { kitchenId, name }`. `StockTransfer { fromKitchenId, toKitchenId, status, lines }` posts TRANSFER_OUT/TRANSFER_IN
    movements (new enum values).
  - **Returns:** a purchase return posts RETURN movements against a PO line and optionally a `SupplierInvoice` credit.
  - **Valuation:** Σ `remainingQty × unitCost` over lots (falls back to latest cost × on-hand for unlotted stock).

## 8. Delivery and corporate additions
* `RiderProfile { userId, vehicle, phone, isAvailable, zoneIds String[] }`.
- **Route cost:** `DeliveryRoute.cost` (paisa) for profitability.
- **Distance fees:** `DeliveryZone.distanceRules Json?` (optional bands, used only when lat/lng are known).
* **Corporate:**
  - `DepartmentBudget { companyId, department, month, amount }`.
  - `CompanyMember.mealEligible`, `eligibleDays Weekday[]`.
  - `CompanyMenuItem { companyId, boxId }`: an allow-list; empty means the full menu.
  - `Company.deliveryInstructions`.
  - Contracts: `CorporateContract.version`, `minMealsPerMonth`, `creditTermsDays`, `boxPrices Json` (negotiated per-box), `supersedesId`.

## 9. Alerts center
`Alert { type, severity INFO|WARN|CRITICAL, priority 1–3, source, entity, entityId, dedupeKey @unique, status OPEN|ACK|RESOLVED,
ownerId, message, data Json, firstSeenAt, lastSeenAt, count, ackAt, ackById, resolvedAt, resolvedById, resolutionNote }`.

* **Detectors** (`src/server/alerts/detectors/*.ts`): pure functions that return `{ dedupeKey, … }[]`. `runDetectors()` upserts by dedupe key, bumping
  `lastSeenAt`/`count`, and auto-resolves alerts whose condition has cleared. Detectors:
  - unpaid orders
  - missing plan picks
  - over capacity
  - low and expiring stock
  - delayed production (batches not DONE by slot − prep time)
  - delayed and failed deliveries
  - refund spike (z-score over 28 days)
  - waste spike
  - unpaid corporate invoices
  - contracts expiring within 30 days
  - integration failures (outbox FAILED, JobRun FAILED)
  - security (≥10 failed logins per account per hour; new super admin granted)
* **Schedule:** detectors run in the housekeeping cron and after key actions (e.g. day lock).
* **Escalation:** CRITICAL alerts queue an email/SMS to `notifyEmail` and the owner role via the existing outbox.
* **UI:** `/admin/alerts` with filters, plus ack, assign and resolve (with a note). The dashboard banner reads from `Alert` instead of computing alerts itself.

## 10. CMS page builder
* **Keep the existing system.** The fixed `ContentSection` system and the home layout stay, because they work and are tested. The page builder is added alongside them.
* **Page model:**
  - `CmsPage { slug @unique, title, titleNe, status, seoTitle, seoDescription, ogImage, canonicalUrl, noindex, showInNav }`.
  - `CmsPageVersion { pageId, locale, version, blocks Json, status DRAFT|SCHEDULED|PUBLISHED|ARCHIVED, publishAt, publishedAt, actorId }`.
* **Blocks:** a block registry in `src/lib/cms/blocks/*.ts`, each block = `{ type, label, schema (zod), defaults, Component }`. Types:
  - hero, text (markdown, HTML escaped), image, cta, featureGrid
  - mealShowcase (reads live boxes), pricingTable (reads live plans), testimonials (consented only), faq (published FAQs)
  - partners, banner, gallery, illustration (from the brand art set), stats (from a named metric, never typed-in numbers)

  Blocks are validated on save and on render. Unknown or invalid blocks are skipped and logged. No raw HTML or JS is allowed, links pass the existing URL
  allow-list, and images must come from the `MediaAsset` library.
* **Publishing:**
  - Publish writes a new version and calls `revalidatePath(/<slug>)` + `revalidateTag("cms")`.
  - Scheduled versions are published by the housekeeping cron. A finer cron is possible on Pro; until then the publish time is "at or after".
  - Rollback = re-publish an older version.
* **Preview:** `/preview/<pageId>?v=<versionId>` is staff-only, with a desktop/mobile toggle in an iframe.
* **Routing:** a catch-all `src/app/(site)/[...slug]/page.tsx` resolves a published `CmsPage`, then a `Redirect { from @unique, to, permanent, hits }`, then 404.
  Fixed routes keep precedence.
* **Navigation and branding:**
  - `NavItem { menu HEADER|FOOTER, label, labelNe, href, parentId?, sortOrder, visible }` replaces the hardcoded links in `Header.tsx`/`Footer.tsx`.
  - Branding (logos, favicon, colour preset, fonts preset) lives in `Setting` keys, limited to the approved token sets in `brand/BRAND_GUIDELINES.md`.
* **Policies:** policy `Page` edits gain `PageRevision` history.
* **SEO:** the sitemap includes published CmsPages minus `noindex`, and JSON-LD is extended via `JsonLd.tsx`.

## 11. Jobs and automation on Vercel
* **Cron schedule:**
  - Existing: `cutoff` (04:00 UTC) and `housekeeping` (00:15 UTC).
  - New: housekeeping also runs detectors, scheduled publishes (menus, CMS) and alert escalation.
  - On Pro, add `*/15 * * * *` → `job=frequent` (scheduled publish, outbox, detectors).
* **Idempotency and recovery:** every job step is wrapped in `runOnce(name, key)` (`JobRun`, unique key), so retries are safe. Failures are visible on
  `/api/health`, the alert center and `/admin/jobs` (new list of JobRun with a "re-run" button guarded by `settings.edit`).
* **Durable work:** long or retryable work (emails, SMS) goes through the `OutboundMessage` outbox. No in-memory queues.

## 12. Data and migration rules
* All new money fields are `Int` paisa. Quantities stay `Float` (base unit). All schema changes for this programme go into **one additive migration** (WP-00):
  - new tables and nullable or defaulted columns only, so the live Neon database migrates without downtime;
  - backfills run as idempotent seed steps (system roles, expense categories, the price row per plan, the nav items mirroring today's links).
* No destructive migration. `prisma migrate reset` is never used against shared databases.

## 13. Security checklist for every package
- **Server checks:** `requirePermission` (or the new `can`) at the top of every action and page, plus `scopeWhere` on every query.
- **Validation:** inputs validated (types, ranges, enums) on the server, and money recomputed on the server.
- **Audit:** write `audit()` for create, update and delete on prices, permissions, settings, refunds, inventory adjustments, contracts and published content.
- **Exports:** exports are permission-checked, PII-masked and audited.
- **Tests:** each package ships unit and integration tests, plus Playwright for any new user-facing flow.
