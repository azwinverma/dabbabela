# Security

## Authentication — Better Auth 1.7
* Email + password (scrypt hashing), minimum 8 characters; password reset tokens valid 1 hour and
  **all sessions revoked** on reset.
* Nepal mobile OTP sign-in (6 digits, 5 min, 3 attempts) — enabled only with the `phoneOtp` flag and a
  configured SMS provider.
* TOTP two-factor with backup codes. **Required for every staff role** when `staff2fa` is on
  (production default). `DISABLE_STAFF_2FA` is ignored when `NODE_ENV=production`. Coverage (re-checked in Phase 2B): every
  admin page/action (`requirePermission`/`requireAnyPermission`/`requireStaff`/`guarded`), the admin layout, `/rider` (layout,
  pages and actions use `requirePermission`), `/api/admin/export/*` and `/admin/**/route.ts` (`requireStaff`), the upload route
  (explicit check) and — fixed in 2B — the admin kit actions (global search, saved views), which used only `getCurrentUser` and
  now refuse staff without 2FA (`staffTwoFactorOk`).
* Database sessions (30 days, sliding) — revocable: deactivating a user, resetting a staff password or
  2FA, and privacy deletion delete their sessions. Session creation is refused for inactive/deleted users.
  **Staff sessions** also have an absolute lifetime (`STAFF_SESSION_MAX_HOURS`, default 24 h, checked in `getCurrentUser`; the
  expired row is deleted). Cookies: `httpOnly`, `SameSite=Lax`, `Secure` whenever the base URL is https (Better Auth default,
  i.e. always in production), prefix `dabba`.
* **Sessions & devices** (`/account/security`, same page for customers and staff): every active session with device, last
  activity and masked IP; "Sign out this device", "Sign out all other devices", "Sign out everywhere" (incl. this one). Sessions
  are addressed by id — tokens are never sent to the browser (before Phase 2B the page embedded other sessions' tokens in hidden
  form fields; fixed). Recent sign-ins (last 15 `LoginEvent`s, success/failure, method, device) are listed too. Admins see and
  revoke a staff member's sessions and login history on `/admin/staff/[id]`. All revocations are audited.
* **Rate limits** (Postgres `RateLimit` table, atomic upsert, `src/lib/rate-limit.ts`). Better Auth's own limiter only sees
  requests to `/api/auth/*`; our forms are server actions calling `auth.api.*`, which bypass it — so the actions limit themselves
  (on in production; `AUTH_RATE_LIMIT=false` only for the E2E server):

  | Action | Limit |
  |---|---|
  | Email sign-in | 6 / 5 min per email, 10 / 5 min per IP |
  | Sign-up | 5 / 10 min per IP |
  | Password reset request | 3 / 10 min per email and per IP; reset submit 10 / 10 min per IP |
  | Mobile code send | 3 / 5 min per phone and per IP (SMS cost); verify 8 / 5 min |
  | 2FA code | 8 / 5 min per IP |
  | Place order / start plan | 12 / min per user |
  | Start / switch payment | 15 / min per user; transfer-proof upload 10 / 10 min |
  | Gateway return verification (eSewa/Khalti) | 30 / min per IP (each triggers a server-to-server lookup) |
  | Wrong coupon codes | 10 / 10 min per IP, then codes aren't checked |
  | Contact / area / lead / newsletter forms | 4–5 / 10 min per IP (always on) |

  Better Auth's HTTP limits stay as a second layer (sign-in 6/min, sign-up 5/5 min, reset 3/5 min, OTP 3/5 min, TOTP 6/min).
* **Bot protection — Cloudflare Turnstile** (`src/lib/turnstile.ts`, `src/components/ui/Turnstile.tsx`) on sign-up, email
  sign-in, mobile-code request, password-reset request and the contact, area-request and team-lead forms. Env-gated: with
  `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` set the token is verified server-side via siteverify (5 s timeout,
  remote IP, expected action) and **fails closed in production**; unset = skipped (dev/tests/E2E), reported as
  `turnstile:false` in `/api/health`. The newsletter box (in every footer) keeps honeypot + rate limit only, to avoid loading the
  widget on every page.

## Authorisation
* **Granular permissions** (`src/lib/permissions/`): `module.action` keys (view · create · edit · delete · publish · approve · export ·
  refund · settings, plus bulk and pii). Effective permissions = the base `Role`'s grants (derived from the original matrix, which is
  kept verbatim and snapshot-tested so no existing user gained or lost access) ∪ an optional custom `StaffRole`. SUPER_ADMIN has everything.
* Every admin page calls `requirePermission("<module>.view")`; every server action / API route the stricter write key
  (`.edit`, `.approve`, `.publish` …). Middleware only checks that a session cookie exists. Hiding a button is cosmetic.
* **Enforced by a test:** `tests/unit/action-guards.test.ts` parses every `"use server"` file and every `route.ts` and fails when an
  exported action/handler doesn't call a server-side guard (admin files: `requirePermission`/`requireAnyPermission`/`requireSuperAdmin`/
  `guarded`; `/team`: `requireCompanyAdmin`; `/rider`: `requirePermission`; elsewhere a session check; route handlers may instead check
  `CRON_SECRET`). Intentional exceptions are listed in the test with the reason (public forms with honeypot + rate limit, auth actions,
  the price preview, one-time setup, gateway return URLs, health, consent). A guard being present doesn't prove the record is scoped —
  that's what the IDOR tests below are for.
* **IDOR tests** (`tests/integration/acceptance.test.ts`): customer A can't cancel/skip/pause B's orders and plans, switch/start B's
  payments, remove B's addresses or touch B's saved dabbas; a reused idempotency key never returns B's payment; another company's admin
  can't change members or order for them; a kitchen-scoped dispatcher can't change, cancel, pack, deliver or fail another kitchen's order.
  The acceptance E2E adds: another customer gets 404 on the order page, a customer can't open the admin order page or report exports.
* **Rider app:** riders act only on stops of their own routes (past routes read-only). Anyone else using it acts as staff (no OTP/photo
  requirement) and therefore needs `dispatch.edit` and the order's/route's kitchen in scope (fixed in WP-20; before, any `rider.edit`
  holder could deliver any kitchen's order without the customer's code).
* **Escalation guards:** only super admins create/edit roles (`roles.edit`); you can't grant a custom role or base role containing a
  permission you don't hold; kitchen-scoped staff can't widen anyone's scope; the last super admin can't be demoted or deactivated.
  All role, scope, assignment and session changes are audited with before/after.
* **Scopes:** `User.kitchenId` ∪ `StaffScope` kitchens limit kitchen data (orders, kitchen, dispatch, inventory) through
  `kitchenWhere`/`inScope`. Exports and reports get the same treatment in WP-10.
* **Money endpoints review (Phase 2B).** Gaps found and fixed, each with a test (`tests/integration/approvals.test.ts`,
  `security-hardening.test.ts`):
  - refund request/approve/reject/process and bank-transfer verify/reject ignored kitchen scope → `assertPaymentInScope` (a
    scoped user may act on a payment only when one of its orders is in their kitchens); payment list/detail/verify queue and the
    refund queue are filtered with `paymentWhere`;
  - refund order ↔ payment mismatch and per-order cap (see Payments);
  - `/api/admin/export/{payments,refunds,subscriptions,ledger}` ignored kitchen scope → filtered through their orders;
    `type=privacy` (full unmasked data-subject export) now also needs `customers.pii` and an existing user;
  - company invoices: record payment / void / credit note and the invoice list/detail ignored staff **company** scope → checked;
  - refunds ledger page put the full customer email in a link URL for staff without `customers.pii`, and allowed partial
    email/phone probing → links use the user id; without PII only name or an exact full email matches; results masked;
  - team CSV export wasn't audited → `team.report_export`;
  - session tokens rendered into `/account/security` (see Authentication); `switchMethodAction` follow-up read now user-scoped.
  Verified OK: `/pay/[id]`, `/thank-you/[id]`, receipts and order pages (`userId` filters), wallet pages, gateway returns
  (signature + server lookup), team invoices/reports (company id), admin receipt (scope + PII), other exports, upload route.
* **Login activity:** every sign-in attempt (email, phone OTP, TOTP, backup code) is recorded in `LoginEvent` with IP, user agent and a
  failure code — never passwords, codes or tokens. Staff pages list sessions with revoke one / revoke all.
* Customer data is always queried with `userId` from the session, never from the request.
* Corporate portal: `requireCompanyAdmin()` + every query filtered by that company id (integration test
  proves another company's data can't be read).
* PII (phone/email) masked without `customers.pii`; CSV exports follow the same rule and are audited.

## Mobile API (`/api/v1`, Phase 3)
* **Bearer sessions only.** `Authorization: Bearer <token>` is resolved by Better Auth's `bearer` plugin to the same
  `Session` row the website uses (expiry, revocation, deactivation, password-reset revocation, staff 24 h absolute
  lifetime). `/api/v1` builds the auth headers from the bearer token, IP and user agent only — **cookies are never
  forwarded**, so a browser holding a web session can't drive the API (no CSRF), and no CORS headers are ever sent
  (cross-origin `Origin` → `403 CORS_FORBIDDEN`; `API_ALLOWED_ORIGINS` to allow one).
* **Staff 2FA** = the web rule (`staffTwoFactorOk`). Enrolled accounts get no token until TOTP/backup code is verified:
  sign-in returns a single-use, attempt-limited `challengeToken` (Better Auth's signed two-factor cookie, replayed
  server-side; format-checked). Unenrolled staff can sign in but every permission-guarded endpoint returns
  `403 TWO_FACTOR_SETUP_REQUIRED` until they enrol (`/auth/two-factor/enable|confirm`; the session rotates).
* **Guards.** Every handler is `apiRoute({ auth })`: `"user"` (own records only — another customer's id answers 404),
  `{ permission }` (= `requirePermission`: permission + 2FA), or allow-listed `"public"`/`"optional"`. Kitchen scope
  is checked before any service call (out of scope → 404). `tests/unit/api-guards.test.ts` fails if a v1 handler
  isn't built this way, a public one isn't allow-listed, or any protected handler doesn't answer 401 without a token.
  IDOR tests: customer A vs B (addresses, orders, payments, plans, tickets, idempotency keys), rider vs another rider's
  stops/routes, staff vs another kitchen's orders/routes.
* **Idempotency.** Money-moving POSTs require `Idempotency-Key`; the first successful response is replayed for 24 h
  (stored in `Verification`, claim under an advisory lock), same key + different body → 422, keys are per user and
  endpoint, and services with their own key (checkout, plans, add meal, renew, top-up) receive it too.
* **Rate limits** use the 2B Postgres limiter: auth endpoints per IP and per email/phone (they call `auth.api.*`, which
  bypasses Better Auth's own limiter), checkout 12/min, payment start 15/min, uploads 10/10 min, writes 60/min per user,
  public reads 300/min per IP.
* **Responses** are explicit DTOs (no Prisma row spreading): no session tokens in session lists, push tokens shown as a
  6-char suffix, delivery OTP only to the customer while out for delivery and never to riders, internal ticket notes and
  actor ids omitted, dispatcher phones masked without `customers.pii`. Unknown errors are logged and returned as
  `INTERNAL` without details. Uploads reuse `storeUpload` (sniffed types, 5 MB, no SVG).
* No refund / wallet-adjustment endpoints exist in v1 (staff money tools stay on the web behind maker-checker).

## Maker-checker approvals (Phase 2B)
* `src/server/approvals.ts`, UI `/admin/approvals` (queue with status/kind/mine filters, detail with requested-vs-now "diff",
  approve with note / reject with required note / withdraw / retry), sidebar badge = pending requests the viewer could decide.
* Refunds (any Payment purpose — order, plan, top-up, invoice), manual wallet adjustments (credit **or** debit, incl. profile
  goodwill credit) and order adjustments whose absolute amount is **≥ `approvalThreshold`** (setting, default Rs 2,000) create a
  PENDING `ApprovalRequest` instead of executing. Below the threshold nothing changed.
* Nobody decides their own request — super admins included (checked in the service and in the guarded `updateMany`). The
  checker needs `approvals.approve` **and** the action's own permission (`refunds.approve` for all three kinds) and the request's
  kitchen in scope. Grants: `approvals.view` = whoever could request refunds (OWNER, OPS, FINANCE, SUPPORT), `approvals.approve` =
  whoever could approve refunds (OWNER, FINANCE); super admin has both. Registered in `registry.ts` / `system.ts` (role editor).
* Approval executes immediately inside one transaction under a per-request advisory lock, re-running the normal service
  (`requestRefundTx` — refundable amount on the payment and the order, `adjustCreditTx` — balance can't go negative,
  `adjustOrderTx`). EXECUTED at most once (racing approvers: one wins; `idempotencyKey` is unique and a retried submit returns the
  same request). Failures are stored as FAILED with the error and can be retried. A refund created by an approval is already
  APPROVED (approvedBy = checker) and still needs proof to be processed.
* Safety net for refunds created by other paths (e.g. cancel with a REFUND settlement): `approveRefund` refuses a refund ≥ the
  threshold when the approver is its requester.
* Everything audited (`approval.request/approve/reject/cancel/execute/failed`); approvers notified in-app + email outbox
  (`approval.requested`), requester told the outcome (`approval.decided`); alert detector `approvals` flags requests pending
  > 4 h (critical > 24 h) and FAILED executions.

## Payments
* Prices recomputed on the server for every quote and order; client totals are ignored.
* Refund integrity (fixed in 2B): a refund naming an order must use that order's own payment (before, an order from payment B
  could be refunded against payment A), and it can't exceed what's left on that order (customer share − refunded − open requests).
* eSewa: HMAC-SHA256 signature verified (constant time), transaction id must match one of our attempts,
  amount must match, **and** the server-to-server status API must return `COMPLETE`. Unreachable → stays
  pending; cron reconciles.
* Khalti: payment confirmed only by the server-side lookup (`Completed` + exact amount).
* Every callback/lookup stored once in `PaymentProviderEvent` (unique key) → replays are no-ops;
  `markPaymentPaid` flips status with a guarded update, so fulfilment happens exactly once.
* Bank transfers need finance to enter the bank reference; refunds need a provider/bank reference or a
  receipt before they can be marked processed.
* Unconfigured gateways are hidden (feature flag + credential check).

## Wallet (store credit) and top-ups (Phase 2A)
* The wallet is the append-only `CreditLedger`; balance = Σ rows. Rows are never edited — corrections are new rows. Spending locks the
  user's ledger (`pg_advisory_xact_lock`) so two checkouts can't overspend; manual staff adjustments are audited and can't take a balance
  below zero.
* **Top-ups are closed-loop store credit** (spendable only on Dabba Bela meals, not cash, not transferable, no interest) behind
  `flags.walletTopup` — **off by default** until legal advice on NRB e-money rules. Off = no form, `startTopup` / `startPayment` /
  method switch refuse; money already sent is still credited once verified (we never keep money without crediting it).
* A top-up is a `Payment { purpose: WALLET_TOPUP }` with no orders, paid through the **same** eSewa/Khalti start/verify code as checkout
  (HMAC + attempt + amount + server-side status API) or a bank-transfer proof that finance verifies with the bank reference. Credit is
  written **only** inside `markPaymentPaid` (the single place money is accepted, dispatching by purpose), after the guarded status flip,
  as exactly one `TOPUP` ledger row — guarded again by a per-payment advisory lock + existence check, so callbacks, replays, the
  reconcile cron and a staff verification racing each other can't double-credit (concurrency test in `tests/integration/wallet-topup.test.ts`).
* A verified amount that differs from the top-up is **never credited**: the payment stays unpaid, a `MISMATCH` provider event is stored
  and a CRITICAL `GATEWAY_MISMATCH` alert is raised immediately (same dedupe key as the detector sweep).
* Limits are server-side, under the customer's lock: min / max per top-up, daily total (PAID + PENDING top-ups created in the Kathmandu
  day) and balance cap (balance + today's pending top-ups + amount). Idempotency key per submit; a key belonging to another customer is
  refused (never returns their payment). Only eSewa / Khalti / bank can buy credit (never wallet or cash).
* Refunds of a top-up go to the source only (no wallet-credit refund), only up to the unspent part (re-checked under the user's lock at
  processing, so a spend since the request can't push the balance negative), and post a negative `TOPUP_REVERSAL` row. Staff actions
  (bank verification → `wallet.topup_verify`, refund request/approve/process) are audited. Maker-checker for refunds above the
  approval threshold is Phase 2B (TODO hook in `requestRefund`).
* Detectors: stuck pending top-ups, paid top-ups without a credit row, balances above the cap, more than 5 top-ups per customer per day,
  gateway mismatches. Unpaid top-ups are not receivables; paid top-ups are cash in but a liability (`liability.customer_credit` in the
  journal), recognised as sales only when the credit pays for orders.

## Web security
* Security headers (`next.config.ts`): HSTS, nosniff, referrer policy, permissions policy, X-Frame-Options.
* **Nonce-based CSP** (Phase 2B, `src/lib/csp.ts`, set in `src/middleware.ts` on every request — on the forwarded request so
  Next stamps the nonce on its inline/bootstrap scripts, and on the response):
  `script-src 'self' 'nonce-<random 128-bit>' 'strict-dynamic'` (no `'unsafe-inline'`; `'unsafe-eval'` only in `next dev`),
  `style-src 'self' 'unsafe-inline'` (React style attributes / next/font), `img-src 'self' data: blob: *.public.blob.vercel-storage.com`,
  `connect-src 'self'` + Sentry ingest origin (from the DSN) + Turnstile when configured, `frame-src` Turnstile or `'none'`,
  `form-action 'self'` + eSewa (and `ESEWA_FORM_URL`'s origin), `frame-ancestors 'self'`, `base-uri 'self'`, `object-src 'none'`.
  Khalti is a redirect (navigation), not governed by CSP. Every HTML page is dynamically rendered (root layout `force-dynamic`), so
  each response carries its request's nonce; the only static routes are robots.txt, sitemap.xml and the OG image (no scripts).
  JSON-LD `<script type="application/ld+json">` is data, not executed. Turnstile/Sentry scripts are injected by nonce-trusted code
  (`'strict-dynamic'`). Verified by `e2e/security.spec.ts` (no CSP violations, every script carries the nonce) on home, menu,
  register, contact, corporate, login, checkout, account, account/security, admin, admin/orders, admin/approvals and rider.
* **Error tracking — Sentry** (`@sentry/nextjs` 11.11.0 pinned; `src/instrumentation.ts`, `src/instrumentation-client.ts`,
  `src/lib/sentry-options.ts`). Env-gated on `SENTRY_DSN` (no SDK loaded without it); release = `VERCEL_GIT_COMMIT_SHA`;
  `sendDefaultPii: false`; `beforeSend`/`beforeSendTransaction`/`beforeBreadcrumb` run `src/lib/sentry-scrub.ts`, which reuses
  the audit redaction helper (`src/lib/redact.ts`: secret keys, bearer tokens, JWTs, card numbers) and also strips emails, phone
  numbers, payment/gateway references (`PAY-…`, `pidx`, `transaction_uuid`, `providerRef` …), cookies, auth headers, request
  bodies and query strings, keeps only the user id, and drops Next redirect/not-found control flow and network noise. Source maps
  upload only with `SENTRY_AUTH_TOKEN`+`SENTRY_ORG`+`SENTRY_PROJECT`; the build wrapper is applied only when a DSN is set.
* CSRF: server actions are POST-only with Next's origin check; Better Auth checks `trustedOrigins`.
* Input validation on the server for every action (types, lengths, Nepal phone format, ISO dates,
  enum membership). Prisma parameterises all SQL; the few raw queries use tagged templates.
* Markdown (pages/posts) renders with raw HTML escaped and link/image URLs allow-listed.
* Uploads: magic-byte sniffing (JPG/PNG/WEBP/AVIF, PDF where allowed), 5 MB limit, **no SVG**, random
  names, Vercel Blob in production (local disk refused in production).
* Public forms: honeypot + per-IP rate limit stored in Postgres + Turnstile (when configured).
* CSV exports neutralise spreadsheet formula injection (cells starting `= + - @ TAB CR` get a `'` prefix; plain negative numbers are
  left as numbers). XLSX exports write inline strings only, never formulas.
* No outbound requests to user-supplied URLs (no SSRF surface); gateway URLs come from env.

## Secrets
Only in environment variables (`.env.example` lists them). Production requires `BETTER_AUTH_SECRET`,
`CRON_SECRET`, `SETUP_KEY`. Cron endpoints require `Authorization: Bearer $CRON_SECRET` (constant-time compare; no secret configured
= every call refused; covered by the acceptance E2E).
* `/setup` needs `SETUP_KEY` (constant-time, 800 ms delay on a wrong key) and refuses once any super admin exists; there's no per-IP
  limit, so use a long random key and remove it after setup.

## Development bypasses (all inert in production)
* `DISABLE_STAFF_2FA=true` is ignored when `NODE_ENV=production` (`src/lib/auth.ts`, upload route).
* Demo data: `prisma/seed.ts` throws in production; `/setup` forces demo off in production; `seedDemo` also needs `ALLOW_DEMO_SEED`.
* `SMS_PROVIDER=console` (prints OTPs) is refused when `NODE_ENV=production`.
* E2E global setup refuses `NODE_ENV=production` unless `E2E_ALLOW` is set, and restores `flags.staff2fa` afterwards.

## Dependency audit (2026-11-20)
`npm audit --omit=dev`: Next.js upgraded 15.5.28 → **15.5.29** (exact pin), which clears its three direct advisories
(GHSA-7qx7-33qx-rqx2, GHSA-f3mh-rxg3-f5g2, GHSA-pc58-hwjq-p385). Remaining 10 (9 high, 1 moderate), none with a non-breaking fix:
| Package | Via | Exposure | Plan |
|---|---|---|---|
| `postcss` ≤ 8.5.22 (bundled inside `next`) → `next` flagged moderate | Next's own CSS pipeline | Build time only, on our own CSS (source-map path traversal / `</style>` stringify need attacker-controlled CSS) | Take the Next release that bundles a patched PostCSS |
| `zod` < 4.6.6 (app + `@vercel/blob` → `@vercel/oidc` → `@vercel/cli-config`) | memory exhaustion validating oversized constrained collections | Server actions cap bodies at 6 MB and our arrays have `.max()`; blob's copy validates Vercel's own config | Zod 4 is a breaking migration — backlog |
| `effect`, `deepmerge-ts` → `@prisma/config` → `prisma` | ReDoS in `Schema.TemplateLiteral`, recursive merge | Prisma CLI/config loading at build/migrate time on our own files, not request handling | Prisma 7 upgrade (breaking) — backlog |

## Database time zone
Prisma sends JS `Date` parameters to `$queryRaw` as `timestamptz`. Raw SQL must normalise them (`(${d} AT TIME ZONE 'UTC')`, plus
`::date` for `DATE` columns) before comparing with `DATE` or `timestamp` columns, otherwise results depend on the database session time
zone (fixed in WP-20 for reports, analytics, exports and dish capacity; the reconciliation test in `acceptance.test.ts` guards it).

## Logging & audit
* Structured JSON logs with emails, phones, tokens, passwords, OTPs and signatures redacted.
* `AuditLog` records staff changes with actor, action, entity, reason, before and after.
* `/api/health` exposes only booleans (DB up, integrations configured, failed jobs/messages counts).

## Known gaps (tracked in IMPLEMENTATION_STATUS)
* Sentry and Turnstile are built but need accounts/keys (⛔ owner); until then logs only and honeypot + rate limits.
* No WAF (Vercel Firewall rules are a dashboard setting, not code).
* No penetration test yet; reviews are code review + the automated guard/IDOR tests.
* `style-src` still allows `'unsafe-inline'` (styles can't execute code; React style attributes need it).
* Rate limiting keys on `x-forwarded-for` (set by Vercel); behind another proxy configure it to pass the client IP.
* Plan quotes (`quotePlanLengthAction`) don't count wrong coupon codes yet (cart quotes do).
* Payment-proof uploads are stored in Vercel Blob with `access: "public"` (unguessable URL, not authenticated) — move to private
  blobs/signed URLs when the plan allows.
* Remaining `npm audit` advisories above (no non-breaking fix).
