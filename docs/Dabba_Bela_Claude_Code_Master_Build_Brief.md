# DABBA BELA — MASTER BUILD BRIEF FOR CLAUDE CODE
Version: 1.0 | Market: Nepal | Product: Cloud kitchen, customizable lunch subscriptions, corporate meal operations

## INSTRUCTION TO CLAUDE CODE
You are acting as the founding product architect, senior full-stack engineer, UX designer, brand designer, database architect, QA engineer, and DevOps lead. BUILD this product in the current repository, not just a plan or mockup. Read this entire file first. Use the attached reference menu image as an initial content source but not as a rigid design reference. First inspect the repository and environment, then create all specifications, implement phase-by-phase, test continuously, and maintain a running checklist. Where third-party credentials, legal decisions, merchant approvals, or live infrastructure are missing, provide secure adapters, sandbox integrations, env templates, an admin-configurable pending state, and documented launch blockers—never simulate a real payment as successful or call unfinished code production-ready.

## PRODUCT VISION
Brand working title: Dabba Bela / डब्बा बेला (subject to trademark, domain and social handle clearance). Nepal-first platform for delicious, affordable, hygienically prepared, home-style cloud-kitchen lunches. Core audiences: individual office workers, shop staff, groups, corporate admins/HR, students, shift workers. Business sells one-time lunchboxes, daily/weekly/monthly plans, customizable schedules and compositions, corporate group subscriptions, and occasional bulk orders. Focus on repeat usage, taste, operational efficiency, punctual delivery and honest nutrition. Do not claim all meals are medically healthy or nutritionally balanced without evidence.

Core USPs: (1) menu rotates weekly; (2) scheduled delivery by office/zone; (3) custom week/month calendar with substitutions; (4) flexible pause/reschedule within configurable cutoff; (5) reliable corporate grouping and individual vs employer sponsorship; (6) transparent meal composition, allergens and dietary tags; (7) kitchen recipe/ingredient cost visibility and wastage reduction; (8) founder-grade owner dashboard and CMS.

## BRAND GUIDELINES
Working tagline Nepali: 'घरको स्वाद, हरेक दिउँसो।' English: 'Your Lunch. Your Way. Ghar Ko Swad.'
Colors: Achar Red #8B2923; Cream #F5EBD6; Saag Green #3B6245; Charcoal #27221D; Turmeric #E3A83B; White #FFFFFF. Use accessible contrast. English type: choose a high-quality licensed open-source humanist sans with confident display personality (e.g. Plus Jakarta Sans and DM Sans); Nepali: Noto Sans Devanagari. Avoid a cliché AI gradient/emoji-heavy aesthetic. Original logo direction: distinctive two/three-compartment dabba silhouette where lid/steam subtly suggests the clock/meal-time 'bela'; custom vector SVG mark + wordmark, monochrome and inverted variants, favicon and app icon; ensure original geometry and no copied dabbawala logos. Provide /brand/BRAND_GUIDELINES.md, logo SVGs, responsive variants, social card, printable packaging label, typography, spacing, motion, image direction, illustrations. Original hand-drawn Nepali food doodles and city/office graffiti with careful cultural authenticity; commissioned/licensed images only in final production, otherwise clearly marked placeholder assets. Never copy third-party stock photos without license. Use real food photography when supplied. Brand name remains configurable in site settings.

Voice: warm, specific, useful, Nepal-native, no robotic marketing filler. Natural English and Nepali translations; no awkward machine translations. User-facing text stored in CMS or message dictionaries. Write truthful content, not unverified claims about probiotics, complete protein, disease prevention, calorie counts or food safety certifications. Display estimate labels when nutrition is calculated. Real testimonials only with consent; no invented review scores, customer counts or partnerships.

## ARCHITECTURE (VERCEL COMPATIBLE)
- Next.js App Router with TypeScript (current stable supported versions, pin dependencies); React; Tailwind CSS; accessible design system / shadcn/ui primitives customized extensively.
- Monorepo or coherent single Next.js codebase organized into app areas: marketing, customer account, corporate, admin, kitchen, dispatch. Use domain/services separation and strict server-side authorization.
- Managed PostgreSQL (Neon or Supabase Postgres or another Vercel-compatible managed Postgres), Prisma or Drizzle ORM with migration files, indexes, constraints, transactions, backups and staging.
- Authentication via mature supported library/provider (Auth.js or Clerk), secure sessions, verified phone OTP if provider available, email/password optional, role/permission matrix and 2FA for privileged users. Nepal phone format validation. Do not implement a homemade security framework.
- Object/media storage via S3-compatible bucket or Vercel Blob; signed uploads, limits, image transformations. Never use ephemeral function filesystem for user uploads.
- Background work via hosted queue/workflow or managed scheduled worker, Vercel Cron only for suitable triggers; durable, retryable, idempotent meal generation, notifications, invoice batch and recurring renewals. No in-memory scheduled jobs. All scheduling computed in Asia/Kathmandu, stored consistently with timezone-aware timestamps.
- Email provider adapter, SMS provider adapter, WhatsApp link fallback (not fake automated WhatsApp sends), configurable notifications; in-app notifications.
- Payment adapter interface for eSewa and Khalti, sandbox where credentials exist; bank transfer / cash payment as auditable manual approval flows; no false success based only on client redirect. Strict payment server verification, signed callbacks, idempotency, reconciliation, refunds and state transitions.
- Monitoring, structured redacted logs, error tracking, rate limiting, WAF-compatible anti-bot protection, analytics with privacy notice, operational health endpoints.
- Multi-environment dev/staging/production, GitHub CI, tests, formatting, lint, typecheck, migration-safe deployment and rollback playbook. Vercel deployment + external database; never promise database hosted inside Vercel runtime. Prefer portable components to allow backend/worker migration if operations grow.
- Use feature flags and environment variables; no secrets committed. Honor Vercel usage and function/cron limits.

## CUSTOMER-FACING WEBSITE: PUBLIC PAGES
1. Home: strong authentic photography, clear USP, 'See this week's menu', 'Build my week', 'Office lunch for your team', operating areas, trustworthy pricing, process, menu highlights, how personalization works, FAQ, real testimonials only, newsletter/corporate lead capture.
2. Weekly menu: current/upcoming week Sunday–Saturday according to kitchen calendar, date-based menu, filters vegetarian/egg/chicken/spice/allergen, meal detail, ingredients, portion, calories/macros only if verified/estimated, availability, sold-out status, origin and featured tags. Weekly history and future scheduling. Clear empty states.
3. Build a Dabba: choose base (rice/roti/noodle etc), protein, vegetable, sides, achar, add-ons, quantity; enforce allowed combos, chef-approved substitutions, ingredient inventory, allergens, meal-specific customization windows, pricing and kitchen feasibility. Dynamic backend pricing and validation; prevent impossible cheap combinations.
4. Plans/pricing: daily, weekly, monthly, office and custom plan, real discount accounting, per-lunch effective cost, delivery fee, dietary limitations, pause/refund rules, date count and Nepal holidays. Month plan defined in actual service days, not vaguely as 30 deliveries.
5. Coverage: zone lookup by city/ward/locality/pin, service cutoffs, delivery windows, minimum orders and fees; no pretend GPS coverage. Start with configurable Kathmandu pilot zones, support Biratnagar etc later when activated.
6. Corporate: team signup, request quote, per-location aggregation, employer-sponsored and employee-paid, mixed dietary preferences, consolidated invoices, trial tasting inquiry, downloadable sample menu, contact sales; no fabricated logos.
7. About/Kitchen: story, genuine kitchen process, food safety practices and real photos, sourcing, people.
8. FAQ, Contact, Blogs/food journal, policies (refund, cancellation, allergens, food safety, privacy, terms), accessibility statement, 404.
9. SEO metadata, schema where appropriate, canonical pages, sitemap, robots, OG images, localization, and fast Core Web Vitals.

## CUSTOMER ACCOUNT & CHECKOUT
Signup/login, phone verification integration, profiles (name, preferences, vegetarian/non-veg, spice tolerance, allergies with prominent warning that avoidance cannot guarantee zero cross-contact), multiple addresses, landmarks, location pin optional, delivery instructions, corporate affiliations, saved custom dabba, order history, receipts, favorite items, support tickets, referrals only after fraud rules.
- One-time order: date, service area, quantities, address, delivery window, coupon, tax/fee breakdown, pay, confirmation, tracking timeline.
- Weekly/monthly subscriptions: days of week, holiday skipping, plan start/end, per-day lunch selection, custom modifications and price deltas, renewal type (manual by default until approved), pause/resume/skip, reschedule cutoff, credit/refund ledger, upcoming deliveries and renewal reminders.
- Calendar builder UI with drag/drop optional but accessible non-drag fallback; enforce kitchen prep cutoff and available capacity. Show conflicts and price totals before commit.
- Order state: draft, pending_payment, confirmed, scheduled, preparation, packed, out_for_delivery, delivered, failed_delivery, cancelled, refunded/partially_refunded. Keep payment/fulfillment/subscription statuses separate with validated transitions and history.
- Payment reconciliation to avoid charging twice; make post-order edits through compensating transactions / price adjustments rather than silent mutation.

## CORPORATE PORTAL
Organization accounts, authorized admin/member roles, departments/office locations, employee roster/invite, approval rules, order cutoff, meal allowances, wallet/credit ledger, invoice/billing addresses and PAN/VAT fields, bulk imports with validation, cost center reporting, company calendar, staff meals, attendance/order reports, feedback, billing reconciliations. Distinguish company-paid, employee-paid and split-bill. Configurable invoice terms/credit limits, manual approvals, statement export. Restrict organization admins to their own tenant data.

## ADMIN / OWNER COMMAND CENTER
Roles: super_admin, business_owner, operations_manager, content_editor, menu_manager, chef/kitchen_staff, inventory_manager, dispatcher, delivery_agent, finance, customer_support, corporate_admin, customer. Fine-grained RBAC/ABAC, owner-only sensitive settings and user impersonation disabled by default or extremely audited and consent-gated.
Admin dashboard with date/period and location filters, revenue (gross/net), collections, failed/unpaid, discounts, taxes, CAC inputs, repeat rate, churn, active subscriptions, meals due today, capacity, expected vs actual food cost, contribution margin, popular dishes, waste, dispatch SLA, deliveries on time, retention cohorts, unresolved support issues, alerts. Define all KPI formulas, data freshness and permissions; no fabricated numbers. CSV/XLSX export and printable reports; PII-safe scopes.
Admin modules:
- CMS: drag/order section controls within a safe block-based content system, home banners, hero, photos, navigation/footer, FAQ, articles, SEO, multilingual copy, marketing promos; preview/draft/publish/version history, scheduling, media library, approvals and rollback; no arbitrary unsanitized executable HTML.
- Menu/recipes: categories, items, weekly menu templates, dates and rotations, portion sizes, nutritional fields (estimated/verified with source), allergens, prep times, ingredient BOM, selling prices, margins, availability, upsells, alternatives, combo validity, tag translations, menu publishing.
- Plans/rules: subscription tiers, service days, policy cutoffs, coverage, holiday calendar, order cap, minimum orders, fees, taxes, promotions, coupons, dynamic priced add-ons, effective dates.
- Customers: searchable records, dietary preferences, active plans, order list, payment issues, service support, privacy export/deletion requests. Mask sensitive data as needed.
- Orders: timeline, payment, manual edits with audit logs, refunds (where provider permits), exceptions, bulk operations with validation and safe confirmation.
- Corporate: leads, proposal quotes, organizations, employees, locations, contracts, terms, invoice ageing.
- Kitchen: forecasts, production batches, daily prep list, recipe scaling, station assignment, KOT, batch cooking, labels, QC logs, packing checks and reprints.
- Inventory: suppliers, purchase orders, ingredient units and conversion, stock receipts, wastage, expiration dates, safety stock, stock movements, reorder alerts, recipe-level theoretical vs actual usage.
- Dispatch: service zones, capacity per slot, office grouping, manifest, route grouping, driver assignment and contact, delivery photo/OTP optional, exception records. Do not promise optimal routing without route engine.
- Finance: transactions, gateway reconciliation, invoice/credit notes, refund requests, profit contribution, export, cash collection and custody audit, business expenses and payout reports.
- Marketing: promotions, corporate leads CRM, referral campaigns, scheduled banners, conversion funnel, opt-in lists and communications.
- Staff and roles, audit logs, feature flags, site settings, payment configuration, business entities, multiple kitchens/locations (data model supports expansion), access history.
- Operational override requirements: every override audited with who/when/why/old/new values; no direct database hacks.

## KITCHEN & OPERATIONS
Daily order locking after cutoff -> ingredient demand forecast -> inventory reservations -> supplier purchase suggestions -> prep sheets / station work -> QC -> packaging label with unique order QR or code, customer name/alias, dietary/allergen warning, delivery slot and count -> dispatch. Batch shared ingredients for efficiency. Avoid allergen cross-contamination and clearly indicate shared kitchen risks. Track dish yield, portion costs, waste percentage, packaging return/deposit if implemented. Kitchen tablet-friendly responsive UI with large controls.

## DELIVERY
Nepal-friendly address capture including area, ward, landmark, optional pin, phone. Zones and variable fees, rider capacity, grouped office handoff, tracking statuses, proof of delivery and safe OTP, failed-delivery workflow. Coordinate-based routing optional using properly licensed maps; make routing provider configurable. No hardcoded service promises before operation validation.

## INITIAL MENU (REFERENCE IMAGE SEED; EDITABLE IN CMS)
Sunday — Signature Dal Bhat Box: dal bhat tarkari and gundruk achar. Suggested target price NPR 200; dietary attributes require recipe verification.
Monday — Wok & Spud: chicken fried rice and aloo tikki, chicken portion deliberately standardized; NPR 200 target.
Tuesday — Choila Roll Duo: mushroom choila egg roll + soybean choila roll; NPR 200 target; vegetarian only if egg excluded and appropriate preparation.
Wednesday — Garlic Noodle Box: garlic veggie noodles and aloo tikki; NPR 200 target.
Thursday — Fusion Special: mushroom pasta; NPR 220–250 provisional target dependent on actual costs.
Friday — Weekend Send-off: soybean choila roll and chicken fried rice combo; NPR 200 target subject to cost viability.
The reference prices are illustrative. Admin can edit recipes, names, ingredients, sizes, prices, sale dates, images, availability, allergens, notes and substitutions. Seed future weeks with genuine variety drawn from a reusable dish library but never represent fabricated kitchen testing as fact. Avoid incorrect claims such as 'cooked fermented gundruk always contains live probiotics' and 'dal + rice is necessarily a complete protein' in consumer copy. Sunday through Friday follows example only; service calendar and Saturday availability editable.

## DATABASE DESIGN (AT LEAST)
User, Account/Session/Verification, Role, Permission, RoleAssignment, AuditLog, Organization, OrganizationMember, CorporateContract, OfficeLocation, CustomerProfile, Address, DeliveryZone, Kitchen, DeliverySlot, KitchenCapacity, Category, MenuItem, Recipe, RecipeVersion, Ingredient, RecipeIngredient, NutritionSnapshot, Allergen, MenuItemAllergen, CustomizationGroup, CustomizationOption, AllowedCombination, WeeklyMenu, MenuDay, MenuDayItem, MenuPublication, MealPlan, Subscription, SubscriptionDay/Occurrence, SubscriptionChange, SubscriptionPause, Order, OrderItem, OrderItemCustomization, OrderStatusEvent, Payment, PaymentAttempt, PaymentProviderEvent, Refund, CreditLedger, Invoice, InvoiceLine, Coupon, CouponRedemption, TaxRule, FeeRule, StockItem, StockMovement, Supplier, PurchaseOrder, PurchaseOrderLine, ProductionBatch, KitchenTicket, PackingCheck, DeliveryRoute, DeliveryAssignment, DeliveryEvent, SupportTicket, Feedback, CMSPage, CMSBlock, CMSRevision, MediaAsset, SEOSettings, SiteSetting, Notification, NotificationTemplate, NotificationPreference, CorporateLead.
Use IDs, timestamps, soft-delete/archive only where appropriate, immutable price/order/recipe snapshots, unique constraints, FKs, indexes, restrictive deletion for financial records, optimistic concurrency/version columns as needed. Store monetary values in integer paisa or properly supported fixed decimal NUMERIC, NEVER float. Correct concurrency and transaction strategy for capacity, coupons, inventory and payments. Keep financial ledger append-only, auditable, reconciled. Explain data retention and privacy approach.

## BUSINESS RULES & CORNER CASES
- One customer schedules 5 lunches; skip one; correct charge/credit and kitchen demand updates.
- Meal sold out while building custom weekly calendar; prevent race/oversell.
- Customer changes address to unsupported zone; block with clear recovery.
- Gateway callback arrives twice/out of order; dedupe, verify, no double fulfilment.
- Subscription is cancelled after cutoff; apply written policy fairly, maintain record.
- Kitchen changes recipe after customer paid; preserve historical order snapshot and disclose substitutions.
- Company employer subsidy and employee add-on charged separately.
- Holiday/strike/bandh/weather disrupted delivery; bulk notification and reschedule workflow.
- Multiple kitchens and delivery zones; prevent cross-kitchen leakage.
- Allergens, no-onion/garlic, vegan, egg, halal preference only if actually verified; prevent false safety guarantees.
- Unauthorized manager accesses finance / cross-tenant records; deny on server.
- Refund gateway unavailable; queue manual review, never mark paid back without proof.
- Internet failures in kitchen: clear retry-safe state and no accidental duplicate orders.

## VISUAL UX REQUIREMENTS
Brand-specific, editorial and appetizing, mobile-first, highly polished desktop. Real UI, not static art. Accessible contrast and keyboard navigation; WCAG AA target. Strong hierarchy; progressive disclosure; persistent customer plan progress; real loading/error/empty states; skeletons; small functional motion that honors reduced-motion. Original food-inspired graffiti as tasteful accent, never behind readability-critical text. Desktop should look like polished consumer commerce, admin like a serious operator tool. No repetitive gradient cards, generic meaningless illustrations, fake testimonials or raw component-library defaults.

## CONTENT & LOCALIZATION
English + Nepali interface, store multilingual CMS entries. Prices NPR / रु; dates in Asia/Kathmandu; optional Nepali calendar only through a tested library and clearly labeled. Natural Nepal address/phone formats, workweek variation, public holidays configurable, targeted Kathmandu pilot; business must later expand to other cities. Policy, regulatory, food claims and payment terms require legal/operations review before launch.

## ENGINEERING QUALITY GATES
- Feature-level unit and integration tests for pricing, plan day generation, cutoff, capacity, refunds, RBAC and order state transitions.
- E2E Playwright: browse menu -> custom week -> checkout sandbox/manual -> admin confirmation -> kitchen production -> dispatch -> delivery -> account history; corporate onboarding; CMS edit/publish/rollback; subscription pause; payment replay; out-of-stock; permission denial.
- Accessibility scans, Lighthouse/performance budgets, secure headers, CSRF/session safety, Zod server validation, sanitization, parameterized SQL via ORM, CSP where practical, protection against SSRF/upload abuse, secrets in environment, backups/restores test, operational runbook, alert checks, data minimization.
- Use feature flags to hide unsupported payment methods until merchant activation.
- Clean source code and architecture docs, reusable modules, no placeholder TODOs within release-critical pathways.
- System must have realistic seed data but demo data never enabled in live environment. Credentials never hardcoded. Provide migration/seed commands, dev setup, CI, env.example, Vercel deployment instructions and production checklist.

## EXECUTION SEQUENCE — IMPLEMENT, DON'T JUST DOCUMENT
PHASE 0 Research & architecture: inspect repo, list decisions and risks, document feature map and user flows, design system and schema. Check brand availability; if not verified keep name provisional. Record assumptions and launch blockers.
PHASE 1 Foundation: scaffold Next.js, Tailwind, types, auth/RBAC, database migrations, admin layout, CMS/media, i18n, CI and test harness.
PHASE 2 Customer commerce: dynamic menu, item details, configuration builder, plan calendar, signup, addresses, checkout/manual payment, order history, validations and tests.
PHASE 3 Operations: kitchen tickets, recipe BOM, demand forecast, stock, dispatch and delivery statuses, admin order tools.
PHASE 4 Corporate & finance: org accounts, bulk ordering, billing, gateway adapters/sandbox, reconciliation and invoice exports.
PHASE 5 Design polish & launch readiness: imagery/logo deliverables, content review, advanced dashboards, SEO, security/accessibility/performance audits, E2E suite, staging and prod deployment docs.
Don't call a phase complete unless its user flows actually work and pass tests. Keep docs/IMPLEMENTATION_STATUS.md with features, tests and evidence. After each phase deliver exact changed files, commands run, passing/failing tests, issues, limitations and next milestone. Prefer creating code over asking routine clarifying questions. Ask only for genuinely blocking secrets/merchant approval/region/policy decisions, with secure fallbacks and explicit blockers.

## REQUIRED DELIVERABLES
Working source code in repo, database migrations and schema, reproducible seed data, polished production-oriented website, responsive admin/kitchen/dispatch/corporate portals, CMS content and preview, multilingual support, complete brand assets and docs, permissions matrix, API/contracts documentation, architecture and ERD, production configuration samples, CI tests, smoke tests, operational manual, issue log, prioritized backlog, and launch checklist. If tools allow, deploy staging and run real end-to-end browser tests; never claim live production deployment without actual domain, production secrets, merchant activation, infrastructure and verification.

## FIRST ACTIONS NOW
1. Read existing project files and uploaded lunch menu reference image.
2. Create /docs/PRODUCT_REQUIREMENTS.md, /docs/ARCHITECTURE.md, /docs/DATABASE_SCHEMA.md, /docs/USER_FLOWS.md, /docs/ADMIN_MODULES.md, /docs/SECURITY.md, /docs/DEPLOYMENT.md, /brand/BRAND_GUIDELINES.md, /docs/IMPLEMENTATION_STATUS.md.
3. Decide justified libraries, implement foundation and seed initial menu.
4. Build real clickable website and functioning admin/CMS, NOT a static landing page.
5. Proceed in phases with all source files and tests. Keep truthful progress reporting and raise only actual external blockers.
