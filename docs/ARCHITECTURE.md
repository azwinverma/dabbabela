# Architecture

Dabba Bela is one Next.js 15 (App Router, TypeScript) application on Vercel, with a managed
PostgreSQL database (Neon, Singapore region) accessed through Prisma. All business rules live in
`src/server/*` domain services; pages, server actions, API routes, cron jobs and tests call the same
services, so a rule is implemented once.

```
Browser ──► Next.js on Vercel (sin1)
              ├─ app/(site)            public website, account, checkout, plans
              ├─ app/team              corporate portal (company admins)
              ├─ app/admin             control room (staff, RBAC)
              ├─ app/rider             rider app (delivery agents)
              ├─ app/api/auth/[...all] Better Auth (sessions, 2FA, phone OTP)
              ├─ app/api/payments/*    eSewa / Khalti returns → verified server-side
              ├─ app/api/cron/daily    Vercel Cron → idempotent jobs
              └─ app/api/health        uptime probe
                     │
              src/server/*  (domain services)
                     │
              Prisma ──► PostgreSQL (Neon)      Vercel Blob (media)      Resend (email)   Sparrow/Aakash (SMS)
```

## Key decisions

| # | Decision | Why |
|---|---|---|
| 1 | Single Next.js app, domain services in `src/server` | One deployable, shared validation; services are framework-free enough to move to a worker later. |
| 2 | PostgreSQL + Prisma migrations | Relational integrity for money and orders; Neon branches for staging. |
| 3 | **Money is integer paisa** (`Int`) | No float drift; VAT-correct invoices. Convert only at input (`parseRupees`) and display (`rs`). |
| 4 | **Better Auth** (email/password, Nepal mobile OTP, TOTP 2FA, DB sessions, DB rate limits) | Mature library instead of home-made auth; sessions revocable; 2FA enforced for staff via the `staff2fa` flag. |
| 5 | RBAC as a role → permission matrix in code (`src/lib/permissions.ts`), checked in every page **and** server action | Reviewable in one file, unit-tested. Corporate tenancy is separate: `CompanyMember.role = ADMIN` scoped by `companyId` on the server. |
| 6 | One `Order` per delivery day; one `Payment` can cover many orders | Kitchen, dispatch and refunds all work per day. |
| 7 | Separate state machines: `Order.status` (fulfilment), `Order.paymentStatus`, `Payment.status`, `Subscription.status` | Brief requirement; transitions validated in `src/server/transitions.ts`. |
| 8 | Immutable snapshots: `OrderItem.components` (dishes, allergens, recipe version), address and price copied onto the order | Later menu/recipe/price edits never rewrite history. |
| 9 | Capacity and wallet/coupon races solved with Postgres advisory locks inside the order transaction (`pg_advisory_xact_lock`) | Correct under concurrency without serialisable isolation everywhere. |
| 10 | Payments: adapters + `PaymentAttempt` + `PaymentProviderEvent` (unique `eventKey`) | Callbacks deduplicated; eSewa success requires HMAC **and** the status API; Khalti requires lookup. Unreachable provider → stays pending, reconciled by cron. |
| 11 | Wallet = append-only `CreditLedger` | Balance is a SUM; corrections are new rows. Cancellations/skips/late payments become credit. |
| 12 | Durable outbox (`OutboundMessage`) for email/SMS, sent after the response (`after()`), retried by cron | No in-memory jobs; provider outages don't lose messages. WhatsApp is click-to-chat only. |
| 13 | Vercel Cron → `JobRun` idempotency keys | Day lock after cut-off, expiry of unpaid orders, gateway reconciliation, plan completion/reminders. |
| 14 | CMS: per-locale sections with draft → publish → revision → rollback | No arbitrary HTML; markdown rendered with raw HTML escaped. |
| 15 | i18n: `lang` cookie, typed dictionaries (`src/lib/i18n`), `*Ne` columns and per-locale CMS rows | English + Nepali without locale-prefixed routing. |
| 16 | Multi-kitchen ready: zones belong to a kitchen; orders carry `kitchenId`; staff can be scoped with `User.kitchenId` | Expansion to Biratnagar etc. is data, not code. |

## Order lifecycle

```
PENDING_PAYMENT ──paid──► SCHEDULED ──cut-off lock──► CONFIRMED ──► PREPARING ──► PACKED ──► OUT_FOR_DELIVERY ──► DELIVERED
      │                      │  │                          │                                        │
      └─expired/cancel─► CANCELLED ◄──────────────────────┘                                        └─► FAILED_DELIVERY ─► (retry) OUT_FOR_DELIVERY / CANCELLED
                             └─► SKIPPED (plans; can be undone before cut-off)
```

* Cash/wallet/company-paid orders start at `SCHEDULED`; online methods start at `PENDING_PAYMENT`.
* Before the cut-off customers may cancel/skip; afterwards only staff with a reason.
* Paid money returned on cancel/skip → wallet credit (default) or a `Refund` that finance processes
  **with proof** (gateway/bank reference) — never marked returned without it.

## Pricing (all server-side)

`src/server/pricing.ts` (pure, unit-tested): per-day subtotal → zone delivery fee (free above a
threshold or for company accounts) → company discount → coupon spread across days by subtotal →
VAT (inclusive or exclusive, from the effective `TaxRule`) → employer/eater split
(`EMPLOYEE_PAID` / `COMPANY_PAID` / `SPLIT` with per-meal cap and monthly allowance).
Allocation uses largest-remainder so per-order amounts always sum to the total.

## Jobs

| Cron (UTC) | Kathmandu | Job |
|---|---|---|
| `0 4 * * *` | 09:45 | `cutoff`: lock today per kitchen (SCHEDULED → CONFIRMED), cancel unpaid orders past cut-off |
| `15 0 * * *` | 06:00 | `housekeeping`: reconcile gateway attempts, complete finished plans, plan reminders, retry outbox |

Vercel Hobby allows daily crons only; on Pro add `*/10 * * * *` for faster outbox retries.

## Directory map

```
prisma/schema.prisma           data model (see docs/DATABASE_SCHEMA.md)
src/server/                    domain services: orders, subscriptions, payments/, pricing, capacity,
                               calendar, menu, builder, coupons, ledger, corporate, disruption,
                               notify/, jobs, seed
src/lib/                       auth helpers, permissions, settings, cms + cms-store, i18n, money,
                               phone, dates, logger, audit, upload
src/app/(site)                 public site + account + checkout
src/app/admin, team, rider     control room, corporate portal, rider app
tests/unit, tests/integration  Vitest (integration tests run in a fresh Postgres schema per run)
e2e/                           Playwright
```
