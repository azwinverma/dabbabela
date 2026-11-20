# Security

## Authentication — Better Auth 1.7
* Email + password (scrypt hashing), minimum 8 characters; password reset tokens valid 1 hour and
  **all sessions revoked** on reset.
* Nepal mobile OTP sign-in (6 digits, 5 min, 3 attempts) — enabled only with the `phoneOtp` flag and a
  configured SMS provider.
* TOTP two-factor with backup codes. **Required for every staff role** when `staff2fa` is on
  (production default). `DISABLE_STAFF_2FA` is ignored when `NODE_ENV=production`.
* Database sessions (30 days, sliding) — revocable: deactivating a user, resetting a staff password or
  2FA, and privacy deletion delete their sessions. Session creation is refused for inactive/deleted users.
* Rate limits stored in Postgres (sign-in 6/min, sign-up 5/5 min, reset 3/5 min, OTP 3/5 min, TOTP 6/min).

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
* **Login activity:** every sign-in attempt (email, phone OTP, TOTP, backup code) is recorded in `LoginEvent` with IP, user agent and a
  failure code — never passwords, codes or tokens. Staff pages list sessions with revoke one / revoke all.
* Customer data is always queried with `userId` from the session, never from the request.
* Corporate portal: `requireCompanyAdmin()` + every query filtered by that company id (integration test
  proves another company's data can't be read).
* PII (phone/email) masked without `customers.pii`; CSV exports follow the same rule and are audited.

## Payments
* Prices recomputed on the server for every quote and order; client totals are ignored.
* eSewa: HMAC-SHA256 signature verified (constant time), transaction id must match one of our attempts,
  amount must match, **and** the server-to-server status API must return `COMPLETE`. Unreachable → stays
  pending; cron reconciles.
* Khalti: payment confirmed only by the server-side lookup (`Completed` + exact amount).
* Every callback/lookup stored once in `PaymentProviderEvent` (unique key) → replays are no-ops;
  `markPaymentPaid` flips status with a guarded update, so fulfilment happens exactly once.
* Bank transfers need finance to enter the bank reference; refunds need a provider/bank reference or a
  receipt before they can be marked processed.
* Unconfigured gateways are hidden (feature flag + credential check).

## Web security
* Security headers (`next.config.ts`): CSP (`default-src 'self'`, form-action limited to eSewa, no
  objects, frame-ancestors self), HSTS, nosniff, referrer policy, permissions policy.
  Inline scripts are allowed (`'unsafe-inline'`) because Next.js App Router needs them without nonces —
  a nonce-based CSP is in the backlog.
* CSRF: server actions are POST-only with Next's origin check; Better Auth checks `trustedOrigins`.
* Input validation on the server for every action (types, lengths, Nepal phone format, ISO dates,
  enum membership). Prisma parameterises all SQL; the few raw queries use tagged templates.
* Markdown (pages/posts) renders with raw HTML escaped and link/image URLs allow-listed.
* Uploads: magic-byte sniffing (JPG/PNG/WEBP/AVIF, PDF where allowed), 5 MB limit, **no SVG**, random
  names, Vercel Blob in production (local disk refused in production).
* Public forms: honeypot + per-IP rate limit stored in Postgres.
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
* No external error tracker wired yet (Sentry or similar) — logs only (⛔ account).
* No WAF/bot challenge on public forms beyond honeypot + rate limit (add Vercel Firewall / Turnstile).
* No penetration test yet; the WP-20 review is code review + the automated guard/IDOR tests.
* CSP allows `'unsafe-inline'` scripts (nonce-based CSP in the backlog).
* Payment-proof uploads are stored in Vercel Blob with `access: "public"` (unguessable URL, not authenticated) — move to private
  blobs/signed URLs when the plan allows.
* Remaining `npm audit` advisories above (no non-breaking fix).
