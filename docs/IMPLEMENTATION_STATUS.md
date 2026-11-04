# Implementation status

_Last updated: 2026-11-04._ Honest status. "Done" means the flow works against a real Postgres database
and is covered by the checks listed. Nothing here is live in production: there is no production
domain, merchant activation or production infrastructure yet.

## Verification snapshot
| Check | Result |
|---|---|
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` | ✅ 0 errors (8 warnings: unused vars, `<img>` for QR codes, anonymous default export) |
| `npm test` (Vitest unit + integration, real Postgres, fresh schema per run) | ✅ 96 / 96 in 10 files |
| `npm run build` (production) | ✅ all routes compile |
| `npm run test:e2e` (Playwright, Chromium desktop + Pixel 7 for public pages, against the production build) | ✅ 40 / 40 |
| HTTP smoke of every owned route per area (owner + role accounts) | ✅ 200, no server errors |

Tests by file: `money`, `pricing`, `calendar`, `rbac-transitions`, `rbac-granular` (unit); `access` (custom roles, escalation, scopes, sessions, login events, foundation backfill); `commerce` (orders, payments,
plans, corporate split, lock, disruption), `ops` (kitchen BOM, batch usage idempotency, PO receiving, OTP,
cash), `finance` (invoices, VAT, void, credit note, tenant isolation, privacy deletion), `catalog` (recipe
versions, menu publish re-assignment, CMS publish/rollback/locale fallback, staff role limits).
E2E by file: `public`, `order-flow`, `permissions`, `plans`, `cms`, `fulfilment` (kitchen → dispatch → rider),
`team`, `refunds`.

## Phases
| Phase | Status |
|---|---|
| 0 Research & architecture | ✅ ARCHITECTURE, schema, flows, decisions recorded |
| 1 Foundation (Next.js, auth/RBAC, migrations, admin layout, CMS/media, i18n, CI, test harness) | ✅ |
| 2 Customer commerce (menu, builder, plan calendar, signup, addresses, checkout, payments, history) | ✅ |
| 3 Operations (tickets, BOM, forecast, stock, dispatch, rider, admin order tools) | ✅ |
| 4 Corporate & finance (org accounts, team orders, invoices, gateway adapters/sandbox, reconciliation, exports) | ✅ (gateways sandbox only) |
| 5 Polish & launch readiness | 🟡 brand assets, SEO, docs, E2E done; audits & content review pending (below) |

## Super Admin Control Center (2026-11-04 brief)
Tracked in [ADMIN_IMPLEMENTATION_TRACKER.md](ADMIN_IMPLEMENTATION_TRACKER.md); audit in [FEATURE_AUDIT.md](FEATURE_AUDIT.md).
| Package | Status |
|---|---|
| WP-00 foundation schema (34 tables, additive) + idempotent backfill | ✅ applied locally; runs on Vercel via `vercel-build` |
| WP-01 granular RBAC (module × action), custom roles, kitchen/company scopes, login activity, session revoke | ✅ (email invite links deferred: no email provider yet) |
| WP-02 … WP-20 | ⬜ not started — their tables exist but nothing reads them yet |

## Feature status
| Area | Status | Notes |
|---|---|---|
| Public site (home, menu w/ filters & history, box detail, Build-a-Dabba, plans, delivery areas, corporate, about, FAQ, contact, journal, policies) | ✅ | Nepali via `lang` cookie |
| Auth (email/password, 2FA TOTP, reset, staff 2FA enforcement) | ✅ | Phone OTP built; needs SMS provider + flag |
| Account (orders, timeline, receipt, feedback, plans, addresses, preferences, wallet, notifications, tickets, security, privacy, company join) | ✅ | |
| Checkout & payments | ✅ sandbox | eSewa sandbox verified incl. signature/replay/tamper tests; Khalti code path tested with mocked lookup only (no key) |
| Meal plans (calendar picks, skip EXTEND/CREDIT, pause/resume, cancel with credit, address change) | ✅ | Renewal is manual by design |
| Capacity & races (day, slot, box, dish; wallet; coupons) | ✅ | Advisory locks; race tests pass |
| Kitchen (lock, forecast, BOM requirements, batches, prep sheets, KOT, QR labels, packing, QC) | ✅ | |
| Inventory (stock ledger, suppliers, POs, receiving, alerts, expiry, variance) | ✅ | Ingredient units are base units; no unit conversion table |
| Dispatch & rider (routes, OTP proof, photo option, cash custody, failures) | ✅ | Grouping only — no route optimisation (by design) |
| Finance (payments verify, reconciliation, refunds with proof, wallet, invoices, credit notes, ageing, exports) | ✅ | Gateway refunds recorded manually |
| Corporate (company billing modes, members, invites, CSV import, team orders, reports, invoices) | ✅ | |
| CMS (per-locale draft/publish/rollback, home layout, pages, blog, banners, testimonials w/ consent, FAQs, media) | ✅ | Live in-page draft preview not built — side-by-side compare instead |
| Staff & roles, settings & flags, notifications templates & outbox, audit log, privacy requests | ✅ | |
| Notifications: in-app, email (Resend), SMS (Sparrow/Aakash) | 🟡 | In-app works; email/SMS adapters built, untested against real providers (no keys) |
| Cron jobs & health endpoint | ✅ | Jobs idempotent; verified via services, not on Vercel yet |

## Known issues / limitations
1. Nepali translations (UI dictionaries, seed CMS) are hand-written but **not reviewed by a native editor**.
2. Admin screens are English only.
3. Clicked through in Playwright: public pages, order + cash checkout, logins and permission
   boundaries, plan skip/undo/pause/resume/cancel, CMS draft→publish→rollback, kitchen lock/pack →
   dispatch route → rider delivery with the hand-off code, company team order, and refund
   request → approval → processing with a reference. Other admin screens (inventory, invoices,
   disruption wizard, settings) are covered by service tests and page loads, not E2E.
4. Recipe quantities and costs are planning estimates; suppliers are placeholders.
5. Nutrition: no values seeded (shown only when a source is entered).
6. No food photography yet — illustrated dabbas are used until photos are uploaded.
7. Rider app shows today only.
8. CSP uses `'unsafe-inline'` for scripts (Next.js requirement without nonces).
9. `npm audit` reports advisories in transitive dependencies — review before launch.
10. Old demo/test rows exist in the local dev database (e.g. `f2test…@example.com`, demo orders).

## External blockers (need the owner)
| Blocker | Needed for |
|---|---|
| Trademark / domain / social clearance for "Dabba Bela" | Public launch, email domain |
| Company registration, PAN/VAT registration | Invoices, enabling VAT rule |
| Food business licence & kitchen inspection details | Food safety page, compliance |
| eSewa & Khalti merchant activation (live keys) | Live online payments |
| SMS sender ID approval (Sparrow/Aakash) | SMS + phone OTP |
| Resend (or other) verified sending domain | Email notifications |
| Legal review of policy pages | Launch |
| Real photos (or licensed/commissioned) | Menu imagery |
| Vercel + Neon production accounts | Staging/production deploy |

## Prioritised backlog
1. Playwright for inventory/POs, invoices and the disruption wizard (see issue 3), and an accessibility scan (axe) in CI.
2. Error tracking (Sentry) + Vercel Firewall/Turnstile on public forms.
3. Native-speaker review of Nepali copy; translate admin chrome if staff prefer Nepali.
4. Ingredient unit conversions (buy in sacks, cook in grams).
5. Nonce-based CSP.
6. Rider date picker; route optimisation via a licensed provider.
7. Gateway API refunds (Khalti) once merchant API access is approved.
8. Auto-renewal for plans (only after gateway tokenisation is approved).
9. Bikram Sambat date display behind the existing flag, with a tested library.
10. Referral programme with fraud rules.
