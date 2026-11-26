# Implementation status

_Last updated: 2026-11-26 (gap closure: online invoice payment, push sending, mobile API additions; 2026-11-23 security review fixes; Phase 4 Flutter app; Phase 3 mobile API; Phase 2C business gaps; earlier: WP-20 acceptance, security and performance pass)._ This is an honest status.
"Done" means the flow works against a real Postgres database and the checks listed below cover it.
**This is not a production-readiness claim.** The app is deployed to Vercel (https://dabbabela.vercel.app) in
sandbox mode only. There is no production domain, no live payment merchant keys, and no SMS or email provider.
The external blockers listed further down are still open.

## Gap closure (2026-11-26)
| Item | Status | Notes |
|---|---|---|
| Online company-invoice payment (purpose `INVOICE`) | ✅ code / ⛔ live keys | Company admins pay the outstanding balance on `/team/invoices/[id]` with eSewa/Khalti (bank details shown as the alternative; "Pay" link in the list). Amount fixed at start; exactly one `InvoiceReceipt` (ESEWA/KHALTI, `paymentId`) on verified payment under invoice → payment locks; under/overpayment, cancelled payment or changed invoice refused + GATEWAY_MISMATCH alert; manual receipt / credit note / void cancel open payments and expire sessions. Staff see receipts (with payment link) and in-progress payments on `/admin/invoices/[id]`; settlements count them as company receipts; not a receivable while unpaid; no refund path (credit note). Integration-tested (10) + E2E (portal → eSewa form post, intercepted) |
| Push sending (FCM HTTP v1) | ✅ code / ⛔ Firebase | `src/server/notify/push.ts`, `PUSH` outbox channel. Env `FCM_SERVICE_ACCOUNT_JSON` (unset = no-op, `push:false` in `/api/health`). Order out-for-delivery/delivered/failed, payment received/failed (new), plan reminders, approval requests, rider route assigned (new). Follows the IN_APP switch; UNREGISTERED tokens deleted; hand-off code never in the push text. Integration-tested with mocked HTTP (7). The Flutter `PushService` is still a no-op (needs the Firebase project) |
| Mobile API additions | ✅ | `GET /allergens`, `GET /builder`, `POST /builder/quote`, `POST /saved-boxes`, `PATCH`/`DELETE /saved-boxes/{id}`, re-priced `GET /saved-boxes`, notification `target`, full `/settings` + `/coverage` response schemas (OpenAPI 99 paths). Built boxes order through cart lines `kind=custom` (company-billed refusal in `quoteCart`). Web builder and API share `src/server/custom-boxes.ts`. Integration-tested (5) + api-guards |
| Coupon guessing on plan quotes | ✅ | One per-IP budget for cart + plan quotes, web + API (`src/lib/coupon-guard.ts`) |
| Invoice page company scope | ✅ | Ageing KPIs, not-yet-invoiced panel and company picker honour staff company scope |
| Trusted client IP for LoginEvent / audit | ✅ | `src/lib/client-ip.ts` shared with the limiter (tests updated: right-most XFF hop) |
| Plan-cancel REFUND rejected | ✅ | Rejecting rolls the meals' `refundedAmount` back; processing marks them REFUNDED |
| Rate limiter | ✅ | Sliding-window counter on the existing table (no schema change), prune step in housekeeping |
| Refunds E2E | ✅ | Fresh finance user per run (no 24 h limit build-up) |
| Schema | — | No schema change or migration (invoice payments link through `Payment.idempotencyKey`, like swap payments) |

## Security review fixes — money paths (2026-11-23)
An independent review of HEAD `0c4ab02` found 1 critical, 4 high, 4 medium and 10 low issues (most reproduced with PoC tests).
All fixed; details and the per-finding "how" are in `docs/SECURITY.md` → "Security review fixes".
| Item | Status | Notes |
|---|---|---|
| C1 plan cancel race / unchecked refunds / payout cap | ✅ | One guarded transaction under a plan lock; refunds via `requestRefundTx`; `processRefund` and `bumpPaymentRefund` re-check the cap under the payment lock |
| H1 / M1 stale gateway amount (double credit, free meal, underpayment) | ✅ | Gateway sessions expire on any amount/method change; `markPaymentPaid` refuses underpayment (alert) and credits the surplus once |
| H2 skip / unskip race | ✅ | Guarded flip + credit/append in one transaction |
| H3 / H4 / L10 credit minting, threshold splitting, self-processing, cash-out of credit | ✅ | Per-order adjustment cap; refunds summed per payment; per-person rolling-24 h `staffDailyMoneyLimit` (Settings, default Rs 5,000); payout ≠ requester for gateway/bank/cash; wallet-paid → credit only; manual credit to customers in scope only |
| M2 top-up limit bypass | ✅ | Cancelled top-ups never credited (refused + GATEWAY_MISMATCH alert → refund at the gateway); pending top-ups of any day count toward the cap |
| M3 hand-off code brute force | ✅ | 5 wrong codes lock the stop (API 423 `HANDOFF_LOCKED`); dispatcher unlock on the dispatch board (audited); per-rider limit |
| M4 unassigned staff = all kitchens | ✅ | Kitchen-bound staff without a kitchen get none; no-kitchen approvals need all-kitchen approvers; demo staff seeded with the kitchen. **Existing deployments:** assign a kitchen to every chef / store keeper / dispatcher / rider account before deploying (they otherwise see no kitchen) |
| Lows L1–L9 | ✅ | Supplier-credit void, client IP + fail-closed limits + 2FA per challenge, API sign-up limits (attestation TODO), Turnstile action, no sandbox defaults live (health flag), wallet switch race, audited device moves, `apiOrigin`, idempotency stale window |
| Schema | — | No schema change or migration |

_Checks (2026-11-23): `tsc` 0 errors; eslint 0 errors (same 7 warnings); Vitest **526 / 526** in **49** files, two consecutive green runs
(30 new tests in `tests/integration/security-money.test.ts` (18) and `security-access.test.ts` (12) — all 30 failed against the pre-fix
code; one earlier run had a one-off failure in `integration-pass` "distance fee bands" that did not reproduce); review PoCs no
longer exploit; `next build` ✅; Playwright full suite against that production build on :3400 — **46 / 46**._

## Mobile app — Phase 4 Flutter (2026-11-23)
| Item | Status | Notes |
|---|---|---|
| Project `mobile/` | ✅ built | Flutter 3.29.3, `com.dabbabela.app`, Android minSdk 23 / iOS 13, release https-only, camera/photo usage strings, en + ne |
| Auth | ✅ built | Email/password + 2FA, sign-up, reset, phone OTP (flag), staff TOTP enrolment (QR, backup codes, token swap), sessions, sign-out, app switcher from `GET /me` |
| Customer | ✅ built | Menu (company menu), dabba detail, cart → server quote → checkout, eSewa/Khalti webview + payment polling, bank proof upload, orders (cancel/skip/swap + pay-the-difference/feedback), plans (subscribe/pause/resume/cancel/renew/add meal/address), addresses + coverage, wallet/top-up (flags), payments, notifications, referrals, support, profile/preferences, privacy |
| Rider / Kitchen / Dispatcher | ✅ built | Routes + deliver (code/cash/photo)/fail/finish; production, bulk start/pack, batches, QC, stock alerts; board, routes, rider assignment, start/complete, auto-group, failed resolve |
| Tests / analyzer | ✅ | `flutter analyze` 0 issues; `flutter test` 55 (API client, models, widgets); web compile sanity |
| Real devices | ❌ not yet | Never run on a physical Android/iOS device or emulator; no Android/iOS release build made (disk space) |
| Payments in app | ⚠️ untested live | Webview flow + polling unit/widget-tested only; needs sandbox eSewa/Khalti end-to-end on a device |
| Push | ⚠️ server ✅ / app ❌ | Server sending built (2026-11-26, FCM HTTP v1, env-gated). App `PushService` still no-op; needs the Firebase project, APNs key and `firebase_messaging` wiring |
| Store submission | ❌ owner | Play/App Store accounts, upload key + `key.properties`, iOS signing, listings, data-safety / privacy labels, reviewer demo accounts, launcher icons (`dart run flutter_launcher_icons`) — steps in `mobile/README.md` |
| Nepali copy | ⚠️ | Hand-written, needs a native-speaker review |

## Production readiness Phase 3 — mobile REST API (2026-11-21)
| Item | Status | Notes |
|---|---|---|
| `/api/v1` bearer auth | ✅ | Better Auth `bearer` plugin, same DB sessions as the web; cookies never read on v1. Email/password, sign-up, phone OTP (flag), reset request/submit, sign-out, `GET /me` (role, permissions, kitchen scope, app sections, 2FA state, flags), sessions list/revoke, push device register/remove (`DeviceToken`) |
| Staff 2FA for bearer clients | ✅ | Sign-in returns a single-use `challengeToken` (Better Auth's two-factor cookie, replayed server-side) → `/auth/two-factor/verify`; unenrolled staff get `403 TWO_FACTOR_SETUP_REQUIRED` on staff endpoints and can enrol in-app (`enable`/`confirm`, token rotates). Staff session lifetime (2B) enforced |
| Customer endpoints | ✅ | menu by date/week (+company menu), box, plans, coverage, settings (public); profile, addresses (zone linking), cart quote, place order (all methods), orders list/detail/timeline/cancel/skip/swap/feedback, payments list/status/start (eSewa form / Khalti URL)/method/proof, subscriptions quote/create/pause/resume/cancel/renew/address/add meal, wallet balance/ledger/top-up (flag), notifications, referrals, support tickets, saved boxes (read), privacy export/deletion request |
| Rider / Kitchen / Dispatcher | ✅ | Rider routes by date, route detail, deliver (OTP, cash, photo), fail with reason, finish. Kitchen production list, bulk start/pack, batches, QC, stock alerts (read-only). Dispatch board (slot × zone), create route, assign orders/rider, dispatch, reassign, unassign, auto-group, failed list/resolve |
| Shared logic | ✅ | Web actions now call the same new server modules: `src/server/addresses.ts`, `profile.ts`, `registration.ts`, `rider.ts` (rider actor rule), `privacy.ts#customerSelfExport` |
| Idempotency / limits / errors | ✅ | `Idempotency-Key` required on every money-moving POST (24 h replay, in-progress 409, reuse 422; multipart compared by fields + file hash); 2B limiter for auth, checkout, payment start, uploads, writes; one error envelope |
| OpenAPI | ✅ | `docs/api/openapi.yaml` (95 paths), `GET /api/v1/openapi.json`, `docs/api/README.md` |
| Tests | ✅ | `api-auth` (10), `api-customer` (16), `api-ops` (11), `api-public` (9), `tests/unit/api-guards` (8: every v1 handler uses `apiRoute({auth})`, public allow-list, runtime 401 sweep, spec covers every handler, JSON in sync) |
| Not mirrored | — | Checkout attribution (cookie-based), dispatch route cost / cash hand-in / stop reorder / change acknowledge, kitchen day lock / draft POs / open-pause / ticket printing (desktop tools). (Build-a-Dabba and push sending were added on 2026-11-26) |

## Production readiness Phase 2C (2026-11-20)
- **Swap "pay the difference":** a dearer swap of a paid plan meal can be paid from credit or online (eSewa/Khalti, `SWAP_DIFFERENCE` payment); the swap is applied once on verified payment, credited to the wallet if it can no longer be applied, and cancelled if unpaid at the cut-off. Cheaper swaps credit the wallet (paid) or reduce what's owed (unpaid). Integration-tested (4).
- **Company menu:** applies to every company member on `/menu`, dabba pages, plan swaps/extra meals and checkout; Build-a-Dabba refused only on company-billed orders. Integration-tested.
- **Address + window change:** the window is checked against the new address's zone (staff reassign and customer plan address change). Integration-tested.
- **Company-invoice receipts** are dated records (`InvoiceReceipt`), shown on the invoice and in payment history (legacy audit-only payments still listed), and included in settlements cash flow and the journal. Billed adjustments tracked by `invoiceLineId`; referrals record hold/decision notes and reward time; single-order coupon redemptions record their order. Integration-tested (5) + E2E `company-invoices`.
- **Purchase returns → supplier credit:** optional credit on return (credit-note no., idempotent), apply to supplier invoices with over-apply guards, void the unapplied remainder, net due after credits in ageing; credits are not cash. Integration-tested (6) + E2E `purchasing`.
- **Analytics:** order adjustments and unbilled company share shown as separate KPIs (not folded into recognised revenue until a VAT split exists).
- **E2E added:** `purchasing`, `company-invoices`, `disruption` (bandh wizard). Vitest: 401 tests / 39 files (with Phase 2A merged).
- Online payment of company invoices (purpose `INVOICE`): built 2026-11-26 (see "Gap closure").

## Production readiness — Phase 2B security hardening (2026-11-20)
| Item | Status | Notes |
|---|---|---|
| Maker-checker approvals (refunds of any payment purpose, wallet credit/debit incl. goodwill, order adjustments ≥ threshold) | ✅ | `src/server/approvals.ts`, `/admin/approvals` (queue, detail with requested-vs-now, approve/reject/withdraw/retry), sidebar badge, notifications, stale/failed alert detector. Command palette is record search only (no page registry) — not added |
| Cloudflare Turnstile (sign-up, login, OTP request, reset request, contact, area, team lead) | ✅ code / ⛔ keys | Env-gated; fails closed in production; skipped without keys (`turnstile:false` in health) |
| Nonce-based CSP | ✅ | Per-request nonce + `'strict-dynamic'`, no `'unsafe-inline'` scripts; Playwright checks no violations on 13 pages |
| Sentry | ✅ code / ⛔ account | `@sentry/nextjs` 11.11.0, env-gated on `SENTRY_DSN`, PII scrubber, no source-map upload without a token |
| Account security | ✅ | Sessions/devices with sign out this device / others / everywhere and recent sign-ins on `/account/security` (customers + staff); session tokens no longer sent to the browser; staff sessions 24 h absolute; staff 2FA now also enforced on admin kit actions |
| Rate limits | ✅ | Auth server actions had **no** effective limit (`auth.api.*` bypasses Better Auth's limiter) — now limited; checkout, payment start/switch, gateway returns, wrong coupons added. Table in SECURITY.md |
| Money endpoint IDOR review | ✅ | Fixed: refund order↔payment mismatch + per-order cap, kitchen scope on refund/payment actions, pages and money exports, privacy export needs PII, invoice company scope, ledger email leak, team CSV audit |

## Verification snapshot (2026-11-20, local, dev database + throwaway test schemas)
_Phase 2B (merged with 2A + 2C + 55a768a) re-run: typecheck 0 errors; lint 0 errors (same 7 warnings); Vitest **442 / 442** in **42** files, one fully green run (a per-file Prisma disconnect, `tests/setup-db.ts`, fixes the "Can't reach database server" flakes caused by leaked per-file pools exhausting max_connections); `next build` ✅; Playwright full suite against the production build on :3200 — **46 / 46** (incl. `e2e/security.spec.ts`, 2A/2C specs)._
| Check | Result |
|---|---|
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` | ✅ 0 errors, 7 pre-existing warnings (unused vars / `any` in three client components, anonymous default exports in two config files) |
| `npm test` (Vitest unit + integration, real Postgres, fresh schema per run) | ✅ **354 / 354** tests in **33** files |
| `next build` (production, `NEXT_DIST_DIR=.next-e2e`) | ✅ all routes compile |
| `npx playwright test` (Chromium desktop, plus Pixel 7 for public pages, against the production build) | ✅ **41 / 41** tests in **9** files |
| Acceptance E2E `e2e/acceptance.spec.ts` (brief §26, 18 steps) | ✅ 4 consecutive passes plus the full-suite run |
| `npm audit --omit=dev` | 10 advisories (9 high, 1 moderate) remain, all in transitive or build-time code with no safe non-breaking fix. Triage is in [SECURITY.md](SECURITY.md#dependency-audit-2026-11-20) |
| Database migrations | 5 (init, user allergies, super-admin foundation, `perf_indexes`, plus the lock file). All are additive, and `migrate deploy` is clean |

**Unit tests:**
- `money`, `pricing`, `calendar`, `rbac-transitions`, `rbac-granular`, `admin-kit`.
- **`action-guards`** (new): a static scan that checks every exported server action and route handler has a server-side guard.

**Integration tests (one file per package):**
- `access`, `audit`, `search`, `analytics`, `orders-admin`, `menu-admin`, `builder`, `subscriptions-engine`, `kitchen-mgmt`, `inventory-upgrade`.
- `finance-erp`, `reports-center`, `crm`, `corporate-erp`, `delivery`, `cms-builder`, `marketing`, `alerts`, `customer-dashboard`.
- `integration-pass`, `cleanup`, plus the original `commerce`, `ops`, `finance` and `catalog`.
- **`acceptance`** (new):
  - IDOR checks: customer vs customer, company vs company, and kitchen-scoped staff (including the rider app).
  - Idempotency-key replay.
  - Metric-to-record reconciliation.

**E2E specs:** `acceptance` (new), `public`, `order-flow`, `permissions`, `plans`, `cms`, `fulfilment`, `team`, `refunds`.

### Acceptance flow (brief §26), and how each step is covered
| # | Step | Covered by (`e2e/acceptance.spec.ts`) |
|---|---|---|
| 1 | Super admin creates a dish and a dabba and publishes it on next week's menu | UI: Dishes → new + recipe version. Dabbas → new. Weekly menus → plan next week (copy of the rotation) → add on Tuesday → save → Publish now. DB asserts PUBLISHED |
| 2 | It appears on the public site | `/menu?week=<next>` and `/boxes/<slug>` as a visitor |
| 3 | Customer selects it in a weekly plan | `/plans/hapta`: start date, then the dabba is offered only on its day, and it's picked |
| 4 | Server validates availability and calculates the amount | Payment, subscription and order totals equal meals × plan price + (dabba price − plan regular price). The client never sends a price |
| 5 | Checkout with a configured method | Cash on delivery. eSewa stays sandbox-only and is covered by integration tests, not the UI flow |
| 6 | Order and payment states recorded | Payment CASH/PENDING, plan ACTIVE, every meal SCHEDULED. `/account/plans/<id>` shows Active |
| 7 | Scheduled kitchen order exists exactly once (idempotent) | Kitchen → Lock day confirms it. Then Admin → Scheduled jobs → Cut-off → Run now, plus 2 cron calls. Still 1 order, 1 CONFIRMED event, 1 day lock |
| 8 | Kitchen sees the correct ingredient and prep requirement | Kitchen "Dishes by recipe" row: 1 portion → `Rice 0.1 kg` (1 kg per 10 portions). Prep sheet lists the dish |
| 9 | Inventory updated through production | Plan batches → Start → Done (1 cooked). The batch is marked `stockPosted` and the USAGE movements sum to −0.1 kg |
| 10 | Prepared and packed | Start all → PREPARING. Four packing checks → PACKED |
| 11 | Dispatch assigns | Dispatch → new route with the rider → Send out → OUT_FOR_DELIVERY |
| 12 | Customer sees status updates | The `/account` today card's current step reads In the kitchen → Packed → On the way (with the hand-off code) → Delivered |
| 13 | Delivery confirmed with OTP | Rider app: a wrong code is refused and logged, the right code delivers. Cash is recorded on the route |
| 14 | Reports reflect it | Revenue by meal (today, kitchen): the dabba row shows 1 sold, 1 order and its line value. The order-status report has a Delivered row |
| 15 | Super admin inspects the full history | Order page timeline (each status + "Delivery: delivered (code ok)"). Audit log for the dabba (`box.create`) and the menu (`menu.published`) |
| 16 | A CMS update appears on the public site | `home.cta` title published and visible on `/`, then restored |
| 17 | Unauthorised users can't access privileged functions | Anonymous → login. The customer can't open the admin order page or the report export. Another customer gets a 404 on the order. A chef can't open money reports or the audit log. The cron endpoint returns 401 without the secret or with a wrong one |
| 18 | Historical prices unchanged after a price change | Dabba price changed to Rs 300 and a new plan price version (+Rs 10) saved through the UI. Payment amount, subscription price/total/priceId, and order and line prices are byte-for-byte unchanged |

DB shortcuts:
- The plan meal is moved to today, because the kitchen, dispatch and rider screens work on today. The fulfilment spec does the same.
- Today's day lock is reopened so the UI lock confirms the meal.

Both are documented in the spec header. Reruns are safe:
- Names are unique per run.
- Next week's menu is re-published each run; publishing archives the previous one.
- The plan price and the CMS block are restored, and the plan is cancelled.

## WP-20 findings fixed
| Finding | Severity | Fix |
|---|---|---|
| Rider app: any non-rider holding `rider.edit` (e.g. a dispatcher scoped to kitchen A) could deliver, fail or finish **any** kitchen's stop as "staff", skipping the hand-off code and photo | Medium-high | Staff path now needs `dispatch.edit` and the order's or route's kitchen in scope (`src/app/rider/actions.ts`). Regression test in `acceptance.test.ts` |
| `placeCartOrder` unique-key race fallback could return another user's payment for a reused idempotency key | Low | Owner check, as on the normal replay path |
| Raw SQL compared `DATE`/`timestamp` columns with timestamptz parameters. On a non-UTC DB session, single-day report ranges were empty (revenue by meal, meal profitability, customer and order reports, orders CSV) and Build-a-Dabba dish capacity under-counted | Medium (correctness) | Parameters normalised with `AT TIME ZONE 'UTC'` (+ `::date`). Reconciliation test fails without it |
| CSV export prefixed negative amounts (`-50.00`) with `'` (formula-injection guard too broad) | Low | Plain negative numbers are left alone |
| QC log accepted a batch from another kitchen | Low | Batch must belong to the kitchen |
| Next.js 15.5.28 advisories (image-optimizer SVG bypass, Edge cookie header exposure, response injection) | Moderate | 15.5.29, exact pin |

Performance: additive migration `20261120061329_perf_indexes` adds 8 indexes on hot foreign keys:
- `OrderItem.orderId`: every capacity check in quotes and orders joins through it.
- `OrderAdjustment.orderId`, `Payment.subscriptionId`, `Refund.paymentId`.
- `DeliveryAssignment.routeId`, `DeliveryRoute(kitchenId, date)`.
- `InvoiceLine.invoiceId`, `Order.createdAt`.

The quote and menu paths already batch their reads, and the detector loops are per kitchen, so no N+1 was found.

## Phases
| Phase | Status |
|---|---|
| 0 Research & architecture | ✅ |
| 1 Foundation (Next.js, auth/RBAC, migrations, admin layout, CMS/media, i18n, CI, test harness) | ✅ |
| 2 Customer commerce (menu, builder, plan calendar, signup, addresses, checkout, payments, history) | ✅ |
| 3 Operations (tickets, BOM, forecast, stock, dispatch, rider, admin order tools) | ✅ |
| 4 Corporate & finance (org accounts, team orders, invoices, gateway adapters/sandbox, reconciliation, exports) | ✅ (gateways sandbox only) |
| 5 Polish & launch readiness | 🟡 Acceptance, security and performance pass done. External blockers, a native-speaker review, legal review and a staging deploy with real keys are still open |

## Super Admin Control Center (2026-11-04 brief)
All 21 work packages (WP-00 … WP-20) are ✅ in [ADMIN_IMPLEMENTATION_TRACKER.md](ADMIN_IMPLEMENTATION_TRACKER.md). The final status per brief
section is in [FEATURE_AUDIT.md](FEATURE_AUDIT.md#final-status-2026-11-20). Each package lists what it deferred. The main deferred items are:
- Email invite links and campaign sending (no email provider).
- SMS escalation.
- Company-menu enforcement on self-ordering.
- Two-step stock transfers.
- Scheduled or emailed reports.
- Historical "as at" snapshots.
- Loyalty.
- Gateway API refunds (Khalti access).

## Feature status
| Area | Status | Notes |
|---|---|---|
| Public site (home, menu with filters & week navigation, box detail, Build-a-Dabba, plans, delivery areas, corporate, about, FAQ, contact, journal, policies, CMS pages) | ✅ | Nepali via the `lang` cookie (needs native review) |
| Auth (email/password, 2FA TOTP, reset, staff 2FA enforcement, login activity, session revoke) | ✅ | Phone OTP is built but needs an SMS provider and the flag |
| Account (today card, upcoming, calendar, orders, plans, payments, addresses + pin, credit, referrals, notifications, tickets, security, privacy) | ✅ | |
| Checkout & payments | ✅ sandbox | eSewa sandbox verified (signature, replay and tamper tests). Khalti tested with a mocked lookup only (no key) |
| Meal plans (calendar picks, versioned prices, swap, add a meal, skip, pause/resume, cancel with credit, one-click renewal) | ✅ | Auto-renewal deliberately not built (needs gateway tokenisation) |
| Capacity & races (day, slot, box, dish; wallet; coupons) | ✅ | Advisory locks. Dish capacity time-zone bug fixed in WP-20 |
| Wallet top-up (Phase 2A: eSewa / Khalti / bank, limits, ledger, history, admin, report, reconciliation, alerts) | ✅ sandbox, **flag off** | `flags.walletTopup` stays off until legal advice on NRB e-money rules. Credit only after server-side verification; one TOPUP ledger row per payment (concurrency-tested). Refunds to source only, capped at unspent credit (TOPUP_REVERSAL). Wallet + gateway split at checkout is refused with a clear message (not built). Refunds above the approval threshold still use the plain flow until Phase 2B maker-checker (TODO hook in `requestRefund`) |
| Kitchen (lock, production dashboard, BOM requirements, batches → stock, prep sheets, KOT, QR labels, packing, QC, pause/shut) | ✅ | |
| Inventory (ledger, lots + FEFO, units, locations, transfers, suppliers, POs, receiving, returns, valuation, alerts) | ✅ | Transfers are single-step |
| Dispatch & rider (routes, distance bands, OTP proof, photo option, cash custody, failures, performance) | ✅ | Grouping only, no route optimisation (by design) |
| Finance (payments, reconciliation, refunds with proof, expenses, payables, settlement, period close, cash flow, journal CSV, profitability, invoices) | ✅ | Gateway refunds are recorded manually. Journal accounts await the accountant's chart |
| Corporate (contracts, budgets, eligibility, company menus, team orders, invoices with adjustments, portal) | ✅ | |
| Analytics & reports (metric registry, drill-down, 27 reports + wallet top-ups, CSV/XLSX, kitchen-scoped, PII-masked, audited) | ✅ | |
| CMS (blocks, pages draft/publish/schedule/restore, nav, branding, SEO, policies with revisions, banners, testimonials, FAQ, media) | ✅ | |
| CRM, promotions, referrals, campaigns (tracking only), alerts center + jobs, audit log, global search | ✅ | Campaign messages aren't sent (no provider) |
| Notifications: in-app, email (Resend), SMS (Sparrow/Aakash) | 🟡 | In-app works. Email and SMS adapters are built but untested against real providers (no keys) |
| Cron jobs & health endpoint | ✅ | Idempotent JobRun steps. Re-run verified in the acceptance E2E |

## Known gaps
1. The Nepali translations (UI dictionaries, seed CMS) are hand-written and **not reviewed by a native editor**. Admin screens are English only.
2. Through the UI, the E2E suite covers the public pages, the full acceptance flow above, cash checkout, logins and permission boundaries, plan skip/pause/resume/cancel, CMS rollback, fulfilment, team orders and refunds. Inventory purchasing/receiving, invoices, the disruption wizard, expenses and settings are covered by service/integration tests and page loads, not E2E.
3. Recipe quantities and costs are planning estimates, and suppliers are placeholders. No nutrition values are seeded.
4. There is no food photography; illustrated dabbas are used.
5. ~~The CSP allows `'unsafe-inline'` scripts~~ — nonce-based CSP since Phase 2B (styles still allow inline).
6. Sentry and Turnstile are built (Phase 2B) but inactive until the owner creates the accounts and sets the keys.
7. No penetration test has been done. Security review is code review plus automated guard and IDOR tests, and one independent money-path review (2026-11-23, all findings fixed).
8. Performance has been checked by code review and index coverage only. There's no load test, and no `EXPLAIN` on production-sized data.
9. The local dev database holds old demo/test rows (E2E orders, "Acceptance …" dishes and dabbas, test plans).

## External blockers (need the owner)
| Blocker | Needed for |
|---|---|
| Trademark / domain / social clearance for "Dabba Bela" | Public launch, email domain |
| Company registration, PAN/VAT registration, **tax advice** (VAT rate, invoice format, IRD rules) | Invoices, enabling the VAT rule, journal export |
| Accountant's chart of accounts | Journal export mapping |
| Food business licence & kitchen inspection details | Food safety page, compliance |
| eSewa & Khalti merchant activation (live keys); Khalti refund API access | Live online payments, API refunds, live statement import |
| SMS sender ID approval (Sparrow/Aakash) | SMS, phone OTP, SMS escalation |
| Resend (or other) verified sending domain | Email notifications, invite links, alert escalation email |
| Legal review of the policy pages, cookie/attribution notice and referral terms | Launch |
| Real photos (licensed or commissioned), real recipe weights and suppliers | Menu imagery, costing accuracy |
| Vercel + Neon production accounts; a staging deploy with production-like configuration | Staging/production |
| Sentry (or other) account | Error monitoring |

## Prioritised backlog
1. Staging deploy on Neon with sandbox keys. Run `migrate deploy` (incl. `perf_indexes`) and the acceptance E2E against it (`E2E_BASE_URL`, `E2E_ALLOW`).
2. Create Sentry + Cloudflare Turnstile accounts and set the keys (code done in Phase 2B); Vercel Firewall rules. Then a penetration test.
3. Native-speaker review of the Nepali copy.
4. Playwright for inventory purchasing, invoices, the disruption wizard and expenses. An axe accessibility scan in CI.
5. Upgrade path for the remaining audit items: Prisma 7 (config deps), Zod 4 (breaking), and a Next release that bundles a patched PostCSS.
6. ~~Nonce-based CSP~~ (done, Phase 2B).
7. Gateway API refunds once merchant API access is approved. Auto-renewal only after tokenisation is approved.
8. Bikram Sambat date display behind the existing flag.
