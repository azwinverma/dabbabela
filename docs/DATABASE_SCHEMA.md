# Database schema

PostgreSQL via Prisma. Source: `prisma/schema.prisma`; migrations in `prisma/migrations` (applied with
`prisma migrate deploy`, never `db push`, in shared environments).

## Conventions
* **Money = integer paisa** (`Int`). Rs 1 = 100. Display with `rs()`, parse with `parseRupees()`.
* **Delivery day** = `@db.Date` holding the Kathmandu calendar day. Timestamps are UTC `timestamptz`.
* **Snapshots**: orders copy address, prices and `OrderItem.components` (dishes, diet, allergens,
  recipe version) so later edits never change history.
* **Financial tables are append-only or restrict-delete**: `Payment`, `PaymentAttempt`, `Refund`,
  `CreditLedger`, `Invoice`, `OrderAdjustment`. Corrections are new rows.
* **Optimistic concurrency**: `Order.version`, `Payment.version`; guarded `updateMany(where status=…)`.
* **Locks**: `pg_advisory_xact_lock` per kitchen-day (capacity), per user (wallet, coupon per-user),
  per payment (refund totals).

## Entity map (brief names → models)

| Area | Models |
|---|---|
| Identity | `User` (role, profile, food preferences), `Session`, `Account`, `Verification`, `TwoFactor`, `RateLimit` (Better Auth) |
| Roles/permissions | `Role` enum + code matrix `src/lib/permissions.ts` (brief's Role/Permission/RoleAssignment tables intentionally replaced — see ARCHITECTURE §5) |
| Customer profile | fields on `User` (diet, spiceTolerance, allergies, avoidOnionGarlic), `Address` (type HOME/OFFICE/SHOP/COLLEGE/SITE/OTHER, ward, landmark, optional lat/lng), `Favorite` |
| Organisation | `Company` (= Organization), `CompanyMember` (= OrganizationMember; ADMIN/MEMBER, department, cost centre, allowance), `OfficeLocation`, `CorporateContract`, `CompanyInvite`, `CorporateLead` |
| Kitchens & coverage | `Kitchen`, `DeliveryZone`, `DeliverySlot`, `KitchenCapacity` (date overrides), `Holiday` (holiday/bandh/weather/closure), `DayLock` |
| Menu | `MenuItem` (dish), `Allergen`, `MenuItemAllergen` (contains / may contain), `LunchBox` (dabba), `BoxItem`, `BoxSubstitution`, `CustomizationGroup`, `CustomizationOption`, `ComboRule` (= AllowedCombination), `WeeklyMenu`, `MenuDay`, `MenuDayItem`; publication history via `WeeklyMenu.publishedAt/By` + `AuditLog` |
| Recipes | `Recipe`, `RecipeVersion` (immutable, costPerPortion), `RecipeIngredient`; nutrition fields + `NutritionSource` on `MenuItem` (= NutritionSnapshot) |
| Plans | `MealPlan`, `Subscription`, `SubscriptionChange`, `SubscriptionPause`; occurrences are `Order` rows with `source = SUBSCRIPTION` |
| Orders | `Order` (fulfilment status + payment status + money + snapshot), `OrderItem`, `OrderItemCustomization`, `OrderStatusEvent`, `OrderAdjustment`, `CustomBox` |
| Money | `Payment`, `PaymentAttempt`, `PaymentProviderEvent` (unique eventKey), `Refund`, `CreditLedger`, `Invoice`, `InvoiceLine`, `TaxRule`, `Coupon`, `CouponRedemption`; delivery fee rules live on `DeliveryZone` (= FeeRule) |
| Kitchen ops | `ProductionBatch`, `KitchenTicket`, `PackingCheck`, `QcLog` |
| Inventory | `Ingredient` (= StockItem), `StockMovement` (ledger; on-hand = SUM), `Supplier`, `PurchaseOrder`, `PurchaseOrderLine` |
| Dispatch | `DeliveryRoute`, `DeliveryAssignment`, `DeliveryEvent` (OTP check, photo, cash) |
| Support | `SupportTicket`, `SupportMessage`, `Feedback`, `ContactMessage`, `DataRequest` |
| Notifications | `Notification` (in-app), `NotificationTemplate`, `NotificationPreference`, `OutboundMessage` (outbox), `JobRun` |
| CMS | `ContentSection` (key+locale, published + draft) (= CMSBlock), `ContentRevision` (= CMSRevision), `Page` (= CMSPage), `Post`, `Banner`, `Testimonial` (consent required), `Faq`, `MediaAsset`, `Setting` (site settings, flags, SEO, home layout), `AuditLog`, `Subscriber` |

## Key relationships
```
Kitchen 1─* DeliveryZone 1─* Address *─1 User
Kitchen 1─* DeliverySlot          User 1─? CompanyMember *─1 Company
Order *─1 Kitchen, *─1 User, *─? Payment, *─? Subscription, *─? Invoice, 1─* OrderItem, 1─* OrderStatusEvent
Payment 1─* PaymentAttempt, 1─* PaymentProviderEvent, 1─* Refund
LunchBox 1─* BoxItem *─1 MenuItem 1─? Recipe 1─* RecipeVersion 1─* RecipeIngredient *─1 Ingredient
WeeklyMenu 1─* MenuDay 1─* MenuDayItem *─1 LunchBox
Ingredient 1─* StockMovement *─1 Kitchen
```

## Notable indexes / constraints
* `Order(kitchenId, deliveryDate)`, `Order(deliveryDate, status)`, `Order(companyId, deliveryDate)`
* `Payment.idempotencyKey` unique (checkout retries), `PaymentAttempt.providerRef` unique,
  `PaymentProviderEvent.eventKey` unique (callback dedupe), `StockMovement.idempotencyKey` unique (batch usage once)
* `DayLock(kitchenId, date)`, `ProductionBatch(kitchenId, date, menuItemId)`, `ContentSection(key, locale)` unique
* `Invoice.number` unique and sequential per year (generated under an advisory lock)

## Data retention & privacy
* Orders, payments, refunds, invoices and the ledger are kept for the statutory period (confirm with
  your accountant; Nepal tax records are commonly kept ≥ 6 years).
* A deletion request anonymises the user (name, email, phone, addresses cleared; `deletedAt` set;
  sessions removed) while keeping financial records with no direct identifiers.
* Customers can export their data as JSON from `/account/privacy`.
* Logs are structured JSON with emails/phones/secrets redacted (`src/lib/logger.ts`).

## Migrations
| Migration | Purpose |
|---|---|
| `20261103091318_init` | Full schema |
| `20261104043242_user_allergies_default` | `User.allergies` default `[]` (Better Auth inserts without it) |
