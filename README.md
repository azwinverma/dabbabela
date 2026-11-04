# Dabba Bela — डब्बा बेला

Nepal-first cloud-kitchen platform: a weekly-rotating menu of home-style lunch dabbas delivered at
lunchtime to offices, shops, colleges, work sites and homes in Kathmandu — single orders, Build-a-Dabba,
meal plans with a per-date calendar, corporate lunches with employer subsidies, plus the full back office:
kitchen, inventory, dispatch, rider app, finance, CRM and a bilingual CMS.

**Stack:** Next.js 15 (App Router, TypeScript) · PostgreSQL + Prisma · Better Auth · Tailwind CSS ·
Vercel (hosting, Cron, Blob) · eSewa ePay v2 · Khalti · Resend · Sparrow/Aakash SMS · Vitest · Playwright.

> Brand name is provisional (trademark/domain clearance pending). See `docs/IMPLEMENTATION_STATUS.md`
> for what is done, tested, and blocked.

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
| `npm test` | Vitest unit + integration (needs `DATABASE_URL_TEST`; each run uses its own schema) |
| `npm run test:e2e` | Playwright (run `npm run build` first; starts the server itself) |
| `npm run check` | typecheck + lint + tests |
| `npm run db:migrate` · `db:deploy` · `db:seed` · `db:studio` | Prisma |

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
| Tests | `tests/` (Vitest), `e2e/` (Playwright) |

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
| [Implementation status](docs/IMPLEMENTATION_STATUS.md) | Done / tested / blocked / backlog |
| [Brand guidelines](brand/BRAND_GUIDELINES.md) | Logo, colour, type, voice, imagery |
| [Build brief](docs/Dabba_Bela_Claude_Code_Master_Build_Brief.md) | Original specification |
