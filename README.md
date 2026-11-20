# Dabba Bela — डब्बा बेला

Nepal-first cloud-kitchen platform: a weekly-rotating menu of home-style lunch dabbas delivered at
lunchtime to offices, shops, colleges, work sites and homes in Kathmandu — single orders, Build-a-Dabba,
meal plans with a per-date calendar, corporate lunches with employer subsidies, plus the full back office:
kitchen, inventory, dispatch, rider app, finance, CRM and a bilingual CMS.

**Stack:** Next.js 15 (App Router, TypeScript) · PostgreSQL + Prisma · Better Auth · Tailwind CSS ·
Vercel (hosting, Cron, Blob) · eSewa ePay v2 · Khalti · Resend · Sparrow/Aakash SMS · Vitest · Playwright.

> Brand name is provisional (trademark/domain clearance pending). Deployed to Vercel in sandbox mode only — **not
> production-ready**: live payment keys, SMS/email providers, tax advice, legal review and photos are still pending.
> See `docs/IMPLEMENTATION_STATUS.md` for what is done, tested, and blocked.

## Quick start
```bash
cp .env.example .env                    # set DATABASE_URL(_UNPOOLED), DATABASE_URL_TEST, BETTER_AUTH_SECRET
npm install
npx prisma migrate deploy               # create tables
SEED_DEMO=true npm run db:seed          # catalogue + owner + demo staff/company/customers
PORT=3100 npm run dev
```
Log in at `http://localhost:3100/login` with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
Demo accounts (dev only, password `demo-pass-123`): `ops@`, `chef@`, `stores@`, `dispatch@`, `rider@`,
`finance@`, `support@`, `content@`, `menu@demo.dabbabela.local`; customers `customer.a@` (company admin)
… `customer.d@demo.dabbabela.local`.

## Scripts
| Command | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` · `npm run lint` | TypeScript · ESLint |
| `npm test` | Vitest unit + integration (needs `DATABASE_URL_TEST`; each run creates and drops its own schema) |
| `npm run test:e2e` | Playwright against a production build; starts `next start -p 3100` itself. Build first. To keep a dev server's `.next` untouched: `NEXT_DIST_DIR=.next-e2e npx next build && NEXT_DIST_DIR=.next-e2e npx playwright test` |
| `npx playwright test e2e/acceptance.spec.ts` | Just the brief §26 acceptance flow (needs the seeded demo accounts and `CRON_SECRET`) |
| `npm run check` | typecheck + lint + tests |
| `npm run db:migrate` · `db:deploy` · `db:seed` · `db:studio` | Prisma (never `migrate reset` a shared database) |
| `npm run db:foundation` | Idempotent foundation backfill (preset roles, categories, price rows…); runs on every Vercel deploy |

## Where things are
| | |
|---|---|
| Public site, account, checkout | `src/app/(site)` |
| Control room | `src/app/admin` |
| Corporate portal · Rider app · First-run setup | `src/app/team` · `src/app/rider` · `src/app/setup` |
| Business rules (pricing, orders, plans, payments, kitchen, inventory, dispatch, invoices…) | `src/server` |
| Auth, permissions, settings, CMS store, i18n, money | `src/lib` |
| Data model | `prisma/schema.prisma` |
| Brand assets & guidelines | `brand/` |
| Analytics, reports center, alerts, jobs | `src/server/analytics`, `src/server/reports-center`, `src/server/alerts`, `src/server/jobs.ts` |
| Cron + exports + uploads + gateway returns | `src/app/api` |
| Tests | `tests/unit` (incl. `action-guards` static security scan), `tests/integration` (real Postgres; `acceptance` = IDOR + reconciliation), `e2e/` (Playwright; `acceptance.spec.ts` = brief §26 end to end) |

## Documentation
| Doc | |
|---|---|
| [Product requirements](docs/PRODUCT_REQUIREMENTS.md) | Scope, audiences, non-negotiables |
| [Architecture](docs/ARCHITECTURE.md) | Decisions, lifecycle, pricing, jobs |
| [Database schema](docs/DATABASE_SCHEMA.md) | Models, conventions, retention |
| [User flows](docs/USER_FLOWS.md) | Customer, company, operations, money |
| [Admin modules](docs/ADMIN_MODULES.md) | Modules + permission matrix |
| [Security](docs/SECURITY.md) | Auth, RBAC, payments, web security |
| [Deployment & runbook](docs/DEPLOYMENT.md) | Vercel + Neon, cron, rollback, launch checklist |
| [Implementation status](docs/IMPLEMENTATION_STATUS.md) | Verification snapshot, done / tested / blocked / backlog |
| [Feature audit](docs/FEATURE_AUDIT.md) | Final status per brief section (+ the 2026-11-04 baseline) |
| [Super admin architecture](docs/SUPER_ADMIN_ARCHITECTURE.md) · [Tracker](docs/ADMIN_IMPLEMENTATION_TRACKER.md) | Control-center design · work packages WP-00…WP-20 |
| [Brand guidelines](brand/BRAND_GUIDELINES.md) | Logo, colour, type, voice, imagery |
| [Build brief](docs/Dabba_Bela_Claude_Code_Master_Build_Brief.md) | Original specification |
