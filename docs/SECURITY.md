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
* CSV exports neutralise spreadsheet formula injection.
* No outbound requests to user-supplied URLs (no SSRF surface); gateway URLs come from env.

## Secrets
Only in environment variables (`.env.example` lists them). Production requires `BETTER_AUTH_SECRET`,
`CRON_SECRET`, `SETUP_KEY`. Cron endpoints require `Authorization: Bearer $CRON_SECRET`.

## Logging & audit
* Structured JSON logs with emails, phones, tokens, passwords, OTPs and signatures redacted.
* `AuditLog` records staff changes with actor, action, entity, reason, before and after.
* `/api/health` exposes only booleans (DB up, integrations configured, failed jobs/messages counts).

## Known gaps (tracked in IMPLEMENTATION_STATUS)
* No external error tracker wired yet (Sentry or similar) — logs only.
* No WAF/bot challenge on public forms beyond honeypot + rate limit (add Vercel Firewall / Turnstile).
* Penetration test and dependency audit (`npm audit` reports advisories in transitive dev deps) pending.
