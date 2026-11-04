# Feature audit: Super Admin / ERP / CMS brief vs. current code

_Audited 2026-11-04 against commit `abf91f4` plus the uncommitted E2E work. Status is based on the code, not on earlier docs._
Companion docs: [SUPER_ADMIN_ARCHITECTURE.md](SUPER_ADMIN_ARCHITECTURE.md) (target design) ·
[ADMIN_IMPLEMENTATION_TRACKER.md](ADMIN_IMPLEMENTATION_TRACKER.md) (work packages).

**Legend**
- **Status:** ✅ Done (works end to end, real DB) · 🟡 Partial · ❌ Missing · ⛔ Blocked-external.
- **Work package:** **WP** = the package in the tracker that closes the gap.
- **Columns:**
  - **Need** lists, in order: backend · DB · admin UI · customer-frontend impact.
  - **Sec / Tests** = security and tests required.
  - "—" = nothing beyond the existing pattern.

**Baseline facts the whole matrix relies on**
* **One app, one database, one permission system:** a single Next.js 15 application (`src/app`) on one PostgreSQL schema (`prisma/schema.prisma`, 2 migrations) with one auth/RBAC layer (`src/lib/auth.ts`, `src/lib/permissions.ts`). `/admin`, `/team`, `/rider` and the public site share all of it.
* **Server-side permission checks:** every admin page and server action calls `requirePermission` (verified by grep across `src/app/admin/*/actions.ts`), and `middleware.ts` only checks that a session cookie exists.
* **Money:** integer paisa everywhere (`src/lib/money.ts`).
* **Order lifecycle:** a state machine in `src/server/transitions.ts`; changes are recorded in `OrderStatusEvent` and audited.
* **Plan purchase:** buying a plan **creates every meal `Order` up front**, inside one transaction (`src/server/subscriptions.ts` `createSubscription`). That's why "daily order generation" isn't a cron job: the orders already exist exactly once.

---

## 1. Executive dashboard
| Feature | Status | Evidence | Need (backend · DB · admin UI · customer FE) | Sec / Tests | WP |
|---|---|---|---|---|---|
| Revenue: range gross / discounts / refunds / net / VAT | 🟡 | `src/server/reports.ts` `salesSummary`, `KPI_FORMULAS`; `src/app/admin/page.tsx` | "Gross" counts SCHEDULED→DELIVERED by delivery date, so it's really *booked-by-delivery-date*, not recognised revenue. Add recognised (DELIVERED), deferred and cash views, with a definitions registry. | `dashboard.finance`; metric-vs-SQL tests | WP-02 |
| Today / yesterday / week / month / YTD tiles | ❌ | Only one date range (`readRange`) | Period presets, comparison and growth % · — · tiles | tests per preset | WP-02 |
| Cancelled order value | ❌ | Not computed | aggregate on CANCELLED | — | WP-02 |
| Net excl. tax, AOV | 🟡 | net includes VAT; no AOV | add | — | WP-02 |
| Revenue by meal (box) | ✅ | `popularBoxes` | drill-down to orders | — | WP-02 |
| Revenue by plan / payment method / kitchen / company / zone / channel | 🟡 | method: `collections` byMethod (cash basis); kitchen filter only; no plan/company/zone/channel breakdown | group-bys · channel needs `User.acquisitionSource`, `Order.attribution` · breakdown panels | — | WP-02, WP-11 |
| Paid vs unpaid, outstanding receivables | 🟡 | `collections` pending; invoices `ageing()` in `src/server/invoices.ts` | merge into dashboard | — | WP-02 |
| Trends daily/weekly/monthly | 🟡 | `dailySeries` daily only | weekly/monthly buckets | — | WP-02 |
| Drill-down chart → transactions | ❌ | Charts are static (`BarChart`, `RankBars` in `src/components/admin/ui.tsx`) | link to filtered `/admin/orders` and payments | — | WP-02 |
| Orders pipeline (counts per status, today, scheduled, awaiting payment…) | 🟡 | `mealsDue`, alerts; `/admin/orders` filters by status | pipeline component; delayed orders = OUT_FOR_DELIVERY past slot end; "over capacity" from `capacity.ts`; "unavailable ingredients" from `kitchen.requirements` shortages | — | WP-02 |
| Subscription stats (active/paused/expired/cancelled, renewals due, plan popularity, cancel reasons, expected meals) | 🟡 | `customerMetrics` (activePlans, churn); `cancelReason` stored | aggregates · renewal-due needs `Subscription.renewalDueAt` (or derive from endDate) | — | WP-02, WP-06 |
| MRR | ❌ | none | clearly defined run-rate (architecture §4) | — | WP-02 |
| Failed renewal payments | ⛔/❌ | renewal is MANUAL by design (`Subscription.renewal`) | only meaningful once auto-debit is approved; until then "renewal checkout abandoned" | — | WP-06 |
| Customer stats (new, active, returning, frequency, LTV, cohorts, top customers, diet mix, ratings, complaints) | 🟡 | `customerMetrics`, `cohorts`, `Feedback`, `SupportTicket.category` | LTV, top-N, diet mix, complaint trend · — · panels | consent: only collected fields | WP-02 |
| Acquisition source | ❌ | no field on User/Order | capture UTM/referrer at signup and order | privacy notice | WP-11 |
| Profitability: recipe cost, food cost expected vs actual, waste | 🟡 | `costTotal` snapshot, `actualFoodCost`, `wasteRate` | — | — | WP-09 |
| Packaging, delivery, gateway fees, labour, overhead, expenses, net profit | ❌ | none | `Expense` ledger + categories, `Payment.gatewayFee`, packaging cost per box, P&L marked *estimated* vs *reconciled* | `finance.view` | WP-09 |
| CAC | ✅ | `cac()`; spend stored in `Setting` | move spend into `Campaign` | — | WP-15 |
| Global filters (date, kitchen, zone, customer type, company, meal type, plan type, payment status, order status) | 🟡 | date + kitchen | shared filter bar + query builder | — | WP-02 |
| CSV / Excel export | 🟡 | 10 CSV exports `src/app/api/admin/export/[type]/route.ts`, permission-checked, formula-injection safe | XLSX + export per report | audited exports | WP-10 |

## 2. Order management
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| List, search, filter, sort | ✅ | `src/app/admin/orders/page.tsx` | search by company name | — | WP-03 |
| Detail: items, customizations, components, instructions, payment, kitchen, rider, timeline | ✅ | `src/app/admin/orders/[id]/page.tsx` | audit events inline | — | WP-03 |
| Controlled status transitions, bulk | ✅ | `transitions.ts`, `setOrderStatus`, `bulkStatusAction` | — | unit tests exist | — |
| Cancel with reason + settlement | ✅ | `cancelOrder`, `cancelAction` | — | tested | — |
| Money adjustments (never silent edits) | ✅ | `OrderAdjustment`, `adjustOrder` | — | — | — |
| Refund request / approve | ✅ | `src/app/admin/refunds`, E2E `refunds.spec.ts` | — | tested | — |
| Issue credits | ✅ | `adjustCreditAction` + `CreditLedger` | — | — | — |
| Modify eligible order items (before cut-off) | ❌ | only status/adjustments | edit-lines flow with re-quote, delta via adjustment/payment | version check (`Order.version`) | WP-03 |
| Process substitutions on an order | ❌ | substitutions only at purchase (`BoxSubstitution`) | staff substitution writes new `components` snapshot + `OrderItemCustomization` | audit | WP-03 |
| Reassign kitchen | ❌ | none | move order to another kitchen (capacity check, not after lock) | `orders.manage` | WP-03 |
| Reassign delivery | 🟡 | dispatch `assignAction`/`moveAction` | — | — | WP-13 |
| Manual order (phone/walk-in) | ❌ | `OrderSource.ADMIN` exists, no action | admin create-order form reusing `quoteCart`/`placeCartOrder` for a chosen customer | `orders.create`; tests | WP-03 |
| Corporate bulk order (admin) | 🟡 | company admin can (`teamOrderAction`); staff cannot | staff bulk order for a company | — | WP-03 |
| Download invoice / receipt | 🟡 | customer receipt `account/orders/[id]/receipt`; company invoices | staff printable receipt per order | — | WP-03 |
| Export orders | ✅ | export `orders`, `order-items` | — | — | — |
| Related audit events | ❌ | audit page is global | filter audit by entityId on order page | — | WP-03, WP-17 |
| Duplicate-processing protection | ✅ | idempotency keys on Payment, JobRun, StockMovement | — | race tests exist | — |

## 3. Subscription engine
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| Weekly / monthly / office / custom plans | ✅ | `MealPlan.kind`, `/admin/plans` | — | — | — |
| 5-day / 6-day / flexible days | ✅ | `Subscription.days`, `MealPlan.minDaysPerWeek` | — | — | — |
| Min/max duration | 🟡 | `durationWeeks` fixed per plan | `minWeeks`/`maxWeeks` choice | — | WP-06 |
| Pricing + discount rules | 🟡 | `pricePerMeal`, `compareAtPrice`, coupons scope SUBSCRIPTIONS | volume tiers optional | — | WP-06 |
| Versioned plan pricing | 🟡 | price snapshot on Subscription; `effectiveFrom/To` on plan | `MealPlanPrice` history so a price change never rewrites old subscriptions; UI shows versions | audit | WP-06 |
| Pause / skip / cancel policies | ✅ | `maxPauseDays`, `skipPolicy` (global setting), `cancelSubscription`; E2E `plans.spec.ts` | per-plan override of the skip policy | — | WP-06 |
| Renewal rules | 🟡 | manual; reminders in `completeAndRemind` | one-click renew (clone days/picks into a new subscription and checkout) | — | WP-06 |
| Expiration | ✅ | `completeAndRemind` marks COMPLETED | — | — | — |
| Holiday handling | ✅ | `disruption.ts` MOVE/CREDIT; locked days skipped (`calendar.ts`) | — | tested | — |
| Credits | ✅ | `CreditLedger` | — | — | — |
| Additional meal purchases | 🟡 | a normal single order works alongside a plan | "add a meal to my plan" shortcut | — | WP-06 |
| Customer date-by-date calendar with per-day picks | ✅ | `plans/[slug]` calendar, `dayChoices`, `resolveMeals` | — | — | — |
| Change a pick after purchase | 🟡 | skip/unskip only; rotation re-sync on menu publish (`syncRotationOrders`) | swap the day's dabba before cut-off (re-price delta) | — | WP-06 |
| Aggregate production calendar (admin) | 🟡 | `kitchen.forecast` per day | multi-week calendar of committed meals × dish | — | WP-06 |
| Automatic ingredient requirements | ✅ | `kitchen.requirements` (BOM) | horizon > 1 day | — | WP-07 |
| Idempotent daily order generation | ✅ (by design) | orders created at purchase; cut-off job uses `JobRun` keys | document | — | — |

## 4. Menu management
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| Dish EN/NE name, description, category, diet, allergens, portion, prep time, station, nutrition with source, price, cost, active | ✅ | `MenuItem`, `/admin/dishes` | — | — | — |
| Box (customer meal) EN/NE, tagline, description, health note, photo, price, tags, special | ✅ | `LunchBox`, `/admin/boxes` | short description field | — | WP-04 |
| Customer meal category | 🟡 | `ItemCategory` enum is component-level; boxes have `tags` | `MealCategory` table | — | WP-04 |
| Recipes (versioned, costed, restricted) | ✅ | `Recipe/RecipeVersion`, perm `recipes` | — | tested | — |
| Applicable tax per item | 🟡 | single active `TaxRule` (global) | keep global until tax advice; optional tax class | ⛔ tax advice | WP-09 |
| Featured / visibility / kitchen availability / max daily qty | 🟡 | `isSpecial`, `isActive`; capacity per `MenuDayItem`; `MenuItem.dailyLimit` | `LunchBox.isFeatured`, `isVisible`, `maxDailyQty`, `KitchenAvailability` | — | WP-04 |
| Weekly menu: any future week, copy week, publish, capacity, sold-out, chef's pick | ✅ | `/admin/weekly-menus`, `duplicateMenu`, `setMenuStatus`; publish re-assigns rotation (`syncRotationOrders`) | — | tested (`catalog.test.ts`) | — |
| Drag-and-drop between dates | ❌ | `WeekEditor.tsx` has no DnD | DnD with keyboard fallback | a11y | WP-04 |
| Preview | 🟡 | public `/menu?week=` shows published only | draft preview route (staff-only) | auth | WP-04 |
| Scheduled publish | ❌ | — | `WeeklyMenu.publishAt` + cron | — | WP-04, WP-16 |
| Unpublish when safe | 🟡 | status ARCHIVED possible | guard: block when paid orders reference it, or re-sync | — | WP-04 |
| Seasonal / promo weeks | ❌ | — | `WeeklyMenu.kind` | — | WP-04 |
| Kitchen-specific menus | ✅ | `WeeklyMenu.kitchenId` | — | — | — |
| Per-day cut-off | ❌ | global `orderCutoff`; company `cutoffOverride` | `MenuDay.cutoffOverride` (optional) | — | WP-04 |
| Replacement options | 🟡 | `BoxSubstitution` per box | per-day replacement when sold out | — | WP-04 |
| Menu revisions | ❌ | only `publishedAt/By` | `WeeklyMenuRevision` snapshots | — | WP-04 |
| Historical orders keep past versions | ✅ | `OrderItem.components` snapshot + `recipeVersionId` | — | — | — |

## 5. Custom lunchbox builder
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| Groups, min/max, options with price overrides, defaults | ✅ | `CustomizationGroup/Option`, `/admin/builder`, `src/server/builder.ts` | — | tested | — |
| Compatibility rules | 🟡 | `ComboRule` (EXCLUDE) | REQUIRES kind | — | WP-05 |
| Server-side authoritative price, min price | ✅ | `quoteBuildAction` → `builder.ts`, `builderMinPrice` | — | tested | — |
| Live price on client | ✅ | `src/app/(site)/build` | — | — | — |
| Portion options | ❌ | — | `CustomizationPortion` (label, priceDelta, qty multiplier) | — | WP-05 |
| Stock requirements / production limits | 🟡 | `MenuItem.dailyLimit` | ingredient-availability check from inventory | — | WP-05 |
| Diet rules | 🟡 | diet derived via `combineDiet`; veg filters | group-level diet restrictions | — | WP-05 |
| Kitchen availability per option | ❌ | — | `KitchenAvailability` | — | WP-05 |

## 6. Kitchen management
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| Multiple kitchens, capacity, overrides, slots, holidays | ✅ | `Kitchen`, `KitchenCapacity`, `DeliverySlot`, `Holiday`; `/admin/kitchens` | — | — | — |
| Manager, working hours, status/shutdown & reopen | ❌ | — | `Kitchen.managerId`, `openTime/closeTime`, `status`, `statusNote` | audit | WP-07 |
| Staff assignment | 🟡 | `User.kitchenId` (single kitchen) | `StaffScope` (multi-kitchen) | scoping tests | WP-01 |
| Kitchen inventory | ✅ | `StockMovement.kitchenId` | — | — | — |
| Order queue, day lock, forecast, batches, prep sheets, KOT, labels, packing, QC | ✅ | `src/server/kitchen.ts`, `/admin/kitchen/*`; E2E `fulfilment.spec.ts` | — | tested | — |
| Meals by delivery slot, progress %, unavailable ingredients on board | 🟡 | data available (`requirements` shortages) | production dashboard panels | — | WP-07 |
| Performance, operating costs, waste, efficiency | 🟡 | waste rate global | per-kitchen KPIs, expenses by kitchen | — | WP-07, WP-09 |

## 7. Ingredients, suppliers, inventory
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| Catalogue, unit, cost, safety stock, reorder qty, shelf life, allergens, supplier | ✅ | `Ingredient`, `/admin/inventory/ingredients` | ingredient category | — | WP-08 |
| Unit conversions (buy in sacks, cook in grams) | ❌ | single `StockUnit` | `UnitConversion`, purchase unit on supplier item | conversion tests | WP-08 |
| Batches/lots with expiry, FEFO consumption | 🟡 | `StockMovement.expiresOn` on receipts only | `StockLot` + lot-aware consumption | concurrency tests | WP-08 |
| Locations, kitchen transfers | ❌ | — | `InventoryLocation`, `StockTransfer` (+ TRANSFER_OUT/IN) | — | WP-08 |
| Ledger-based history (no overwrite) | ✅ | `StockMovement` append-only, idempotent usage `batch:<id>:usage` | — | tested | — |
| Recipe-based consumption on production | ✅ | `postBatchStock` | lot-aware | — | WP-08 |
| POs, receiving | ✅ | `PurchaseOrder`, `receiveAction` | — | tested | — |
| Purchase returns | 🟡 | `RETURN` movement type, no workflow | return against PO line | — | WP-08 |
| Supplier invoices & payments | ❌ | — | `SupplierInvoice`, `SupplierPayment` | finance perms | WP-09 |
| Alerts: low, expiring, variance | 🟡 | low stock in `alerts()`, `/admin/inventory/variance` | expiring, delayed supplier → Alert center | — | WP-08, WP-16 |
| Inventory valuation | ❌ | — | Σ lots × cost | — | WP-08 |

## 8. CRM
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| Directory, search, 360 view (orders, plans, payments, credits, tickets, feedback, company) | ✅ | `/admin/customers/[id]` | — | PII masking by `customers.pii` | — |
| Suspend / reactivate | ✅ | `setActiveAction` | — | — | — |
| Internal notes | ✅ | `saveNoteAction` (`User.internalNote`) | structured timeline notes | — | WP-11 |
| Edit permitted details, communication prefs | ❌ | — | staff edit form (name/phone/prefs), audited | audit | WP-11 |
| Issue credit from profile | 🟡 | in `/admin/refunds` | shortcut on profile | — | WP-11 |
| Deletion requests | ✅ | `privacy.ts`, `/admin/privacy` | — | tested | — |
| Export permitted data | ✅ | export `customers` (masked) | — | — | — |
| Account activity | 🟡 | `lastLoginAt` | `LoginEvent` | — | WP-01 |

## 9. Corporate / B2B
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| Orgs, offices, admins, members, invites, CSV import, join codes | ✅ | `Company*`, `src/server/team.ts`, `/team` | — | isolation test exists | — |
| Billing modes, split, allowance, discount, credit limit, terms | ✅ | `Company` fields, `corporate.ts` | — | tested | — |
| Contracts | 🟡 | `CorporateContract` (price, minMealsPerDay, dates, doc) | contract versions, min commitment per month, per-box negotiated prices | audit | WP-12 |
| Department budgets | ❌ | `department` on member only | `DepartmentBudget` | — | WP-12 |
| Employee eligibility | 🟡 | member status | `CompanyMember.mealEligible`, eligible days | — | WP-12 |
| Company-specific menus | ❌ | — | `CompanyMenuItem` allow-list | — | WP-12 |
| Invoices, payments, ageing, credit notes | ✅ | `invoices.ts`, `/admin/invoices`, `/team/invoices` | — | tested | — |
| Delivery instructions per company | 🟡 | `OfficeLocation.receiver*` | `Company.deliveryInstructions` editable in `/team` | — | WP-12 |
| Corporate reports | ✅ | `/team/reports` (+ CSV) | — | — | — |

## 10. Delivery & logistics
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| Zones, areas/wards, fee, free-above, min order, kitchen mapping | ✅ | `DeliveryZone`, `/admin/zones`, `coverage.ts` | — | — | — |
| Distance-based fees | ❌ | — | optional `DeliveryZone.distanceRules` (needs lat/lng) | — | WP-13 |
| Slots/windows | ✅ | `DeliverySlot` | — | — | — |
| Riders, routes, assignment, sequence, OTP/photo proof, failed reasons, cash custody | ✅ | `dispatch.ts`, `/admin/dispatch`, `/rider`; E2E | — | tested | — |
| Rider profiles (vehicle, availability, zones) | ❌ | riders are plain Users | `RiderProfile` | — | WP-13 |
| Delivery cost | ❌ | — | `DeliveryRoute.cost` for profitability | — | WP-13 |
| Performance reporting | 🟡 | `deliveryMetrics` on-time % | per-rider/zone | — | WP-13 |
| Customer notifications | ✅ | `notify()` on status changes | — | — | — |
| GPS tracking | n/a | intentionally not built or advertised | — | — | — |

## 11. Finance
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| eSewa (signature + status API) | ✅ sandbox / ⛔ live keys | `src/server/payments/esewa.ts` | — | replay/tamper tests | — |
| Khalti (lookup) | 🟡 / ⛔ key | `khalti.ts`, mocked lookup test only | live test | — | — |
| Bank transfer with proof, cash, wallet, company invoice | ✅ | `methods.ts`, `/admin/payments` | — | — | — |
| Never paid from redirect alone | ✅ | `markPaymentPaid` after verification | — | tested | — |
| Webhooks | 🟡 | return-URL + status lookup + cron reconcile; no provider webhooks (eSewa/Khalti don't push them in the standard flow) | — | — | — |
| Refund approval workflow | ✅ | `/admin/refunds` | — | E2E | — |
| Reconciliation, duplicate detection | 🟡 | `PaymentProviderEvent` dedupe, cron reconcile; no statement import | gateway statement CSV import → match → variance | — | WP-09 |
| Immutable ledgers | ✅ | `CreditLedger` append-only; Payment/Refund/Invoice restrict-delete | — | — | — |
| Credit notes, invoices | ✅ | `invoices.ts` | — | tested | — |
| Expenses, cost categories, vendor payments, daily settlement, cash flow | ❌ | — | `Expense`, `ExpenseCategory`, `SupplierPayment`, `DailySettlement` | `finance.*` perms | WP-09 |
| Tax configuration | ✅ (mechanism) / ⛔ policy | `TaxRule` effective-dated, off by default | — | — | — |
| Accounting exports | 🟡 | CSV exports | journal-style export (date, account, debit, credit) | ⛔ accountant's chart of accounts | WP-09 |

## 12. CMS
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| Fixed sections per page, per-locale draft/publish/rollback, cache revalidation | ✅ | `src/lib/cms.ts` (≈25 section defs), `src/lib/cms-store.ts` (`revalidateTag("cms")`); E2E `cms.spec.ts` | — | tested | — |
| Home layout ordering/visibility | ✅ | `getHomeLayout/saveHomeLayout` | — | — | — |
| Pages & policies (markdown, escaped HTML) | ✅ | `Page`, `/info/[slug]` | version history | — | WP-14 |
| Blog, FAQ, testimonials (consent), banners (scheduled), media | ✅ | `/admin/blog`, `faqs`, `testimonials`, `banners`, `media` | — | — | — |
| Block page-builder (add/rearrange blocks, new pages) | ❌ | sections are fixed schemas | `CmsPage` + `CmsPageVersion` with typed blocks | zod-validated, no raw HTML/JS | WP-14 |
| Preview desktop/mobile | 🟡 | side-by-side compare | iframe preview with draft token | — | WP-14 |
| Scheduled publication | 🟡 | banners only | `publishAt` on versions + cron | — | WP-14 |
| Branding: logos, favicon, colours (tokens), footer, contact, socials, hours, SEO | 🟡 | `Setting` (brandName, contact, socials, seo, ogImage); `footer`/`announcement` sections | logo/favicon upload slots; colour preset within approved tokens | — | WP-14 |
| Navigation management | ❌ | header/footer links hardcoded in `src/components/site/*` | `NavItem` | — | WP-14 |
| Canonical, noindex, redirects | ❌ | — | per-page SEO fields; `Redirect` + catch-all resolver | — | WP-14 |
| Sitemap, robots, OG | ✅ | `src/app/sitemap.ts`, `robots.ts`, `opengraph-image.tsx` | include CmsPages | — | WP-14 |
| Structured data | 🟡 | `src/components/site/JsonLd.tsx` used on home, box, FAQ, journal post | extend to CmsPages, plans | — | WP-14 |
| Nutrition info page, delivery policy page | 🟡 | no seeded `nutrition` or `delivery` Page | seed as Pages (needs content) | ⛔ legal review | WP-14 |

## 13. Promotions & marketing
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| Promo codes: %/flat, scope, min subtotal, cap, window, usage & per-user limits, first-order | ✅ | `Coupon`, `src/server/coupons.ts` (advisory lock per user) | — | race test exists | — |
| Free delivery, box-specific, bundle offers, stacking rules | ❌ | single coupon per order, no free-delivery type | `Coupon.freeDelivery`, `boxIds`, `stackable=false` explicit | negative-total guard test | WP-15 |
| Referral codes | ❌ | — | `ReferralCode`, `Referral` + fraud rules | — | WP-15 |
| Campaigns, spend, attribution, conversions | 🟡 | marketing spend per month in `Setting` | `Campaign` + attribution on orders | — | WP-15 |
| Email/SMS templates | ✅ | `NotificationTemplate`, `/admin/notifications` | — | — | — |
| Push notifications | ⛔ | no push provider | backlog | — | — |
| Loyalty | ❌ | — | backlog after referrals | — | — |

## 14. Staff, roles, permissions
| Feature | Status | Evidence | Need | Sec / Tests | WP |
|---|---|---|---|---|---|
| 11 staff roles + customer + company admin (via `CompanyMember.role`) | ✅ | `Role` enum, `PERMISSIONS` matrix | Kitchen Manager & Delivery Manager map to custom roles | — | WP-01 |
| Invite/create staff, assign role, suspend (revokes sessions), reset password/2FA | ✅ | `src/app/admin/staff/actions.ts` | email invite link instead of temp password | — | WP-01 |
| Custom roles, granular module × action permissions | ❌ | fixed matrix of ~37 coarse keys | `StaffRole` (permissions[]), resolver merges system role + custom role | escalation tests | WP-01 |
| Kitchen / org scoping | 🟡 | `User.kitchenId` honoured in orders, kitchen, dispatch manifest, dashboard (13 call sites); not in inventory lists/reports | `StaffScope` + `scopeWhere()` helper used everywhere | isolation tests | WP-01 |
| Revoke a specific session, login activity | 🟡 | customer can revoke own sessions (`revokeSessionAction`); staff page shows session count, last login | `LoginEvent`, revoke-all per user | — | WP-01 |
| MFA for privileged users | ✅ | `staff2fa` flag, TOTP | — | — | — |
| Last super admin protection, grant rules | ✅ | `canGrantRole`, `activeSuperAdmins` | — | — | — |

## 15. Settings
| Area | Status | Evidence | Need | WP |
|---|---|---|---|---|
| Business identity, contact, PAN, hours | ✅ | `src/lib/settings.ts` | invoice numbering prefix/sequence settings | WP-09 |
| Orders: cut-off, advance window, delivery days, min order, free delivery | ✅ | settings | cancellation/modification window distinct from cut-off; max daily orders (kitchen capacity covers it) | WP-03 |
| Subscription: skip policy, cancel settlement | ✅ | settings | per-plan overrides | WP-06 |
| Kitchen capacity, lead times | 🟡 | per kitchen | lead time / out-of-stock behaviour | WP-07 |
| Delivery zones, fees | ✅ | zones | — | — |
| Payment methods on/off, gateway status (keys hidden) | ✅ | `paymentMethods`, `/api/health` integration booleans | — | — |
| Notification templates, outbox, failures | ✅ | `/admin/notifications` | escalation rules → alerts | WP-16 |

## 16. Reports
Exists: summary, by box, daily, collections by method, cohorts, CAC, 10 CSV exports (`src/app/admin/reports/page.tsx`).
Missing as dedicated, filterable reports:
- Sales and revenue: weekly/monthly/annual sales, revenue by kitchen/company, meal profitability.
- Order outcomes: cancellation report, refund report, order status report.
- Subscriptions and customers: renewals, retention, LTV, complaints/feedback.
- Kitchen and stock: ingredient consumption, inventory valuation, wastage, supplier purchases, kitchen production.
- Delivery: delivery performance.
- Staff: employee activity.
- Money owed and marketing: outstanding payments, campaign performance.

All are server-side aggregations (WP-10, using WP-02's metric layer).

## 17. Alerts & automation
| Feature | Status | Evidence | Need | WP |
|---|---|---|---|---|
| Computed alerts (transfers, stuck payments, low stock, failed jobs/messages, tickets) | 🟡 | `reports.alerts()`, dashboard banner | persistent `Alert` with severity, owner, ack, resolution, dedupe | WP-16 |
| Scheduled jobs (cut-off lock, expire unpaid, reconcile, complete plans, reminders, outbox) | ✅ | `src/server/jobs.ts`, `JobRun` idempotency, `vercel.json` crons | alert detectors run in housekeeping | WP-16 |
| Expiring contracts, unpaid invoices, refund spikes, waste spikes, delayed production/delivery, security incidents | ❌ | — | detectors | WP-16 |

## 18. Audit
| Feature | Status | Evidence | Need | WP |
|---|---|---|---|---|
| Actor, action, entity, summary, reason, before/after, timestamp | ✅ | `AuditLog`, `src/lib/audit.ts`; `/admin/audit` diff | — | — |
| IP | 🟡 | column exists, rarely filled | fill from request headers | WP-17 |
| Correlation id, approval info | ❌ | — | `requestId`, `approvedById` | WP-17 |
| Search/filter by entity, actor, date | 🟡 | basic list | filters + entity deep-links | WP-17 |
| Secrets never logged | ✅ | `src/lib/logger.ts` redaction | — | — |

## 19. Customer frontend
| Area | Status | Evidence | Gap | WP |
|---|---|---|---|---|
| Homepage CMS-driven (hero, how, week, build, plans, coverage, teams, testimonials, FAQ, CTA) | ✅ | `src/app/(site)/page.tsx` + `getSections`/`getHomeLayout` + DB | featured meals block, promo banner placement HOME | WP-04, WP-14 |
| Weekly menu: current/next week, photos/illustrations, allergens, prices, availability, filters | ✅ | `/menu?week=`, `getPublicWeek` (locked days flagged) | nutrition shown when source set; per-day cut-off | WP-04 |
| Plans: compare, calendar picks, price breakdown, subscribe, pause/resume/skip/cancel, history | ✅ | `/plans`, `/plans/[slug]`, `/account/plans` | renew, swap pick | WP-06 |
| Customer dashboard (upcoming, today, status, plans, payments, addresses, prefs, notifications, credits, feedback, support) | 🟡 | `/account/*` pages exist | dashboard "today/upcoming" summary + calendar view; payment history page | WP-18 |
| Corporate portal (employees, allowance, team orders, deliveries calendar, invoices, reports) | ✅ | `/team/*` | department budgets, delivery instructions | WP-12 |
| Loading/error/empty states | 🟡 | `error.tsx`, `not-found.tsx`; no `loading.tsx` | add `loading.tsx` per heavy route | WP-18 |

## 20–24. Platform
| Area | Status | Evidence / gap |
|---|---|---|
| DB: normalised, FKs, indexes, uniques, paisa, transactions, advisory locks | ✅ | `schema.prisma`; planned additions in tracker WP-00 |
| Admin UX: sidebar, tables, filters, timelines, exports | 🟡 | `src/components/admin/*`. Missing: global search (⌘K), saved filters (`SavedView`), drawer pattern, chart drill-down (WP-02, WP-19) |
| Security: auth, MFA, server authz, rate limits, uploads, CSP, idempotency | ✅ | `docs/SECURITY.md`. Gaps: Sentry ⛔ account, Turnstile, nonce CSP, pen test |
| Tests | 🟡 | 73 Vitest + 38 Playwright. Missing: dashboard metric-vs-SQL, inventory deduction via UI, export tests, the full brief §26 acceptance E2E (WP-20) |
| Deployment | ✅ | `docs/DEPLOYMENT.md`, Vercel live at dabbabela.vercel.app (sandbox). Production readiness ⛔ external blockers |

---

## Hardcoded / mock / disconnected findings
1. **Header and footer navigation links** are hardcoded in `src/components/site/*`; only the footer *text* is CMS (`footer` section). → WP-14
2. **Marketing spend** lives in a `Setting` JSON blob (`marketingSpend()`), not a campaign model. → WP-15
3. **The dashboard's "Gross/Net sales" includes SCHEDULED future orders** whose delivery date falls in the range. It's labelled by delivery date, but it isn't recognised revenue. → WP-02 (relabel as *Booked* and add *Recognised*)
4. **Charts can't be clicked through** to the underlying records. → WP-02
5. **Fixed CMS section schemas:** a new marketing page needs code. → WP-14
6. **Skip policy and cancel settlement** are global settings, not per plan. → WP-06
7. **Kitchen scoping is applied inconsistently:** inventory lists, reports and exports ignore `User.kitchenId`. → WP-01
8. **No acquisition/UTM capture**, so "revenue by channel" is impossible today. → WP-11
9. **No `loading.tsx` anywhere** in `src/app`. → WP-18
10. **Policy pages (`Page`) carry no version history;** edits overwrite. → WP-14
11. **Seeded recipe quantities and suppliers are placeholders** (`src/server/seed.ts`), flagged as such in IMPLEMENTATION_STATUS. Owner data needed.
12. **eSewa falls back to the public sandbox credentials** when env vars are missing (`esewa.ts`). In production it's hidden unless `PAYMENTS_SANDBOX=true` (`methods.ts`), which is correct, but needs documenting in the Settings UI. → WP-09

No mock API responses or fake statistics were found in the files reviewed. Every exported server action in `src/app/admin/*/actions.ts` performs a real permission-checked DB operation. A button-by-button UI sweep was not part of this audit; it's covered by WP-20.
