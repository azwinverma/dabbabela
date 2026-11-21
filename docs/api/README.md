# Dabba Bela mobile API (`/api/v1`)

REST API for the one role-aware Flutter app (Customer, Rider, Kitchen, Dispatcher). Super admin, finance and CMS stay
on the web admin. Every handler is a thin wrapper over the **same server functions** the website uses, with the same
permission checks, kitchen scope, ownership checks, rate limits and audit rows.

* Spec: [`openapi.yaml`](./openapi.yaml) (OpenAPI 3.1), served as JSON at `GET /api/v1/openapi.json`.
  After editing the YAML run `npm run api:spec` (regenerates `src/server/api/openapi.generated.json`;
  `tests/unit/api-guards.test.ts` fails if it's stale or a handler is undocumented).
* Code: handlers `src/app/api/v1/**/route.ts`; plumbing `src/server/api/*` (`route.ts` wrapper, `auth.ts` bearer
  sessions + scope, `http.ts` envelope/errors/pagination, `idempotency.ts`, `rate-limit.ts`, `auth-flow.ts`).

## Base URL and versioning

* Base URL: `https://<site>/api/v1` — same host as the website (local dev `http://localhost:3000/api/v1`).
* `v1` is frozen for additive changes only: new endpoints, new optional request fields and new response fields may
  appear at any time — **clients must ignore unknown fields**. Removing/renaming a field or changing a meaning goes to
  `/api/v2`, with v1 kept running for at least one app-store release cycle.
* Send `User-Agent: DabbaBela/<appVersion> (<ios|android>)`.

## Conventions

| Thing | Rule |
|---|---|
| Success | `200`/`201` `{ "data": …, "meta"?: { … } }` |
| Failure | `{ "error": { "code": "…", "message": "…", "fields"?: { "<field>": "…" } } }` — `message` is safe to show |
| Money | integer **paisa** (100 paisa = Rs 1), always |
| Timestamps | ISO-8601 UTC (`2026-11-20T06:15:00.000Z`) |
| Service dates | `YYYY-MM-DD`, Asia/Kathmandu calendar day (delivery dates, menu days, cut-offs `HH:MM` Kathmandu) |
| Locale | `?locale=en|ne` on catalogue endpoints, else the account's locale |
| Ids | opaque strings |

### Error codes

| HTTP | code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST`, `INVALID_JSON`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID`, `INVALID_TOKEN` | malformed request |
| 401 | `UNAUTHENTICATED` | missing / expired / revoked token → go to sign-in |
| 401 | `INVALID_CREDENTIALS`, `INVALID_CODE`, `INVALID_CHALLENGE`, `INVALID_PASSWORD` | auth step failed (`INVALID_CHALLENGE` = start sign-in again) |
| 403 | `FORBIDDEN` | missing permission for this role |
| 403 | `TWO_FACTOR_SETUP_REQUIRED` | staff account must enrol an authenticator app first (see below) |
| 403 | `CORS_FORBIDDEN` | cross-origin browser request |
| 404 | `NOT_FOUND` | doesn't exist **or isn't yours / not in your kitchens** (never 403, so ids can't be probed) |
| 404 | `FEATURE_DISABLED` | feature flag off (phone OTP, wallet top-up) |
| 409 | `ACCOUNT_EXISTS`, `IDEMPOTENCY_IN_PROGRESS`, `TRANSITION_REJECTED` | conflict |
| 422 | `VALIDATION_FAILED` (+`fields`) | input invalid |
| 422 | `ORDER_REJECTED`, `PAYMENT_REJECTED`, `CAPACITY_REJECTED`, `TOPUP_REJECTED`, `DISPATCH_REJECTED`, `KITCHEN_REJECTED`, `COUPON_REJECTED`, `REQUEST_REJECTED`, `IDEMPOTENCY_KEY_REUSED`, … | business rule said no (cut-off passed, sold out, wrong hand-off code …) — show `message` |
| 429 | `RATE_LIMITED` | slow down, retry later |
| 500 | `INTERNAL` | logged server-side; retry |

## Authentication

Better Auth sessions via the `bearer` plugin — the **same database sessions** as the website (expiry, revocation,
deactivation, password reset, staff session lifetime all apply). `/api/v1` ignores cookies entirely.

```
POST /auth/sign-in            { email, password }
  → 200 { data: { twoFactorRequired: false, token, user } }
  → 200 { data: { twoFactorRequired: true, challengeToken, token: null } }     (accounts with an authenticator app)
POST /auth/two-factor/verify  { challengeToken, code, backup?: bool }  → { token, user }
POST /auth/sign-up            { name, email, phone, password, companyCode?, ref? }  → 201 { token, user }
POST /auth/otp/send           { phone }            (only when flags.phoneOtp)
POST /auth/otp/verify         { phone, code }      → { token, user, isNew } or the 2FA challenge
POST /auth/password/forgot    { email }            (email link opens the website's reset page)
POST /auth/sign-out           { deviceToken? }
GET  /me                      → user, role, permissions, kitchenScope, apps, twoFactor, flags
```

1. Store `token` in secure storage (Keychain / Android Keystore). Send `Authorization: Bearer <token>` on every call.
2. After sign-in (and on app start) call `GET /me` and show the sections in `apps`
   (`customer` always; `rider` / `kitchen` / `dispatcher` from permissions). Still handle `403` per call.
3. On any `401 UNAUTHENTICATED`, drop the token and show sign-in. Sessions: customers 30 days sliding; **staff sessions
   end `STAFF_SESSION_MAX_HOURS` (default 24 h) after sign-in** regardless of activity.
4. `challengeToken` is single-use, short-lived and attempt-limited; on `INVALID_CHALLENGE` restart at sign-in.

### Staff two-factor

With `flags.staff2fa` on (production default) every staff role (incl. riders) must use TOTP, exactly like the web:

* Enrolled staff: sign-in always returns the challenge; no token exists until the code is verified.
* Not yet enrolled: sign-in works, but `GET /me` says `twoFactor.setupRequired: true`, staff sections are `false`, and
  every staff endpoint answers `403 TWO_FACTOR_SETUP_REQUIRED`. Enrol in-app:
  `POST /auth/two-factor/enable { password }` → `{ totpURI, backupCodes }` (render the URI as a QR code, show the
  backup codes once) → `POST /auth/two-factor/confirm { code }` → `{ token }` — **replace the stored token** (Better
  Auth rotates the session when 2FA turns on; the old token stops working).

### Sessions and devices

* `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `DELETE /auth/sessions` (all others). Audited.
* Push: `POST /devices { token, platform: IOS|ANDROID, appVersion }` after sign-in and whenever FCM rotates the
  token; `DELETE /devices { token }` (or pass `deviceToken` to sign-out). A token re-registered by another account
  moves to it.

## Idempotency

Every money-moving POST (place order, subscribe, add meal, renew, cancel order/plan, skip, swap, switch payment
method, wallet top-up, rider delivery with cash, dispatcher cancel-with-credit) **requires**
`Idempotency-Key: <8–80 chars [A-Za-z0-9_-:.]>`.

* Generate a fresh UUID per user action (per tap of "Place order"), keep it until you get a definitive answer, and
  reuse it for every retry of that action (timeouts, app restarts).
* First request runs; a successful response is stored for 24 h and replayed to retries (`Idempotent-Replayed: true`).
* Retry while the first is still running → `409 IDEMPOTENCY_IN_PROGRESS` (wait and retry).
* Same key, different body → `422 IDEMPOTENCY_KEY_REUSED`. Failed requests release the key.
* Keys are per user and endpoint; checkout/plans/top-up also pass the key to the service's own idempotency, so even a
  lost replay record can't create a second payment, and another user's key never returns their payment.
* Multipart uploads are compared by fields + file hash, so a re-built form with a new boundary still replays.

## Payments from the app

1. `POST /orders` (or `/subscriptions`, `/subscriptions/{id}/meals`, `/subscriptions/{id}/renew`, `/wallet/topups`)
   → `payment { id, status, method }`, `needsPayment`.
2. Cash / wallet / company invoice: done. Bank transfer: show the bank details/QR from `GET /payments/{id}` and upload
   proof with `POST /payments/{id}/proof` (multipart `proof` + `reference`).
3. eSewa / Khalti: `POST /payments/{id}/start` →
   * `{ kind: "esewa", action, fields, method: "POST" }` — load an auto-submitting HTML form with those fields in a
     webview / in-app browser;
   * `{ kind: "khalti", url }` — open the URL.
   Close the browser when it navigates to any of `returnUrlPrefixes` (the website's `/thank-you/…`, `/pay/…`,
   `/account/wallet/topup/…`), then **poll `GET /payments/{id}`** until `status` is `PAID` (or failed/cancelled).
   The server verifies with the gateway (signature + status API + amount) before anything is marked paid; the
   redirect itself proves nothing.

## Pagination

Lists that grow (orders, payments, wallet ledger, notifications) use cursors: `?limit=` (default 20, max 50) and
`?cursor=<meta.nextCursor>`. `meta.nextCursor: null` = last page. Newest first.

## Rate limits

Per IP / account / email-or-phone, shared with the website's limiter (Postgres, all instances): sign-in 10 per 5 min
per IP + 6 per 5 min per email; sign-up 5 per 10 min; reset 3 per 10 min; OTP send 3 per 5 min (per IP and per phone);
OTP verify 8 per 5 min; 2FA 8 per 5 min; checkout 12/min; payment start 15/min; uploads 10 per 10 min; other writes
60/min per user; public catalogue reads 300/min per IP. → `429 RATE_LIMITED`.

## Browsers / CORS

Native apps only. No CORS headers are ever sent; a request with an `Origin` header that isn't the site itself (or in
`API_ALLOWED_ORIGINS`) is refused with `403 CORS_FORBIDDEN`. Cookies are never read, so there's no CSRF surface.

## Endpoint map

| Area | Endpoints | Guard |
|---|---|---|
| Auth | `/auth/*`, `/me`, `/devices`, `/auth/sessions` | public (sign-in family) / signed in |
| Public | `GET /settings`, `/menu?date|week`, `/boxes/{slug}`, `/plans`, `/plans/{slug}`, `/coverage?q|area`, `/openapi.json` | none (token only narrows menu to the company menu) |
| Customer | `/profile*`, `/addresses*`, `/cart/quote`, `/orders*`, `/payments*`, `/subscriptions*`, `/wallet*`, `/notifications*`, `/referrals*`, `/support/tickets*`, `/saved-boxes`, `/privacy/*` | signed in, own records only (others → 404) |
| Rider | `/rider/routes`, `/rider/days`, `/rider/routes/{id}`, `/rider/stops/{orderId}/deliver|fail`, `/rider/routes/{id}/finish` | `rider.view` / `rider.edit` (+2FA); riders: own routes only, OTP/photo rules; other staff need `dispatch.edit` + kitchen scope |
| Kitchen | `/kitchen/kitchens`, `/kitchen/production`, `/kitchen/orders/start`, `/kitchen/orders/pack`, `/kitchen/orders/{id}/pack`, `/kitchen/batches*`, `/kitchen/qc`, `/kitchen/stock-alerts` | `kitchen.view` / `kitchen.edit` (+2FA), kitchen scope |
| Dispatch | `/dispatch/board`, `/dispatch/routes*`, `/dispatch/orders/{orderId}/assignment`, `/dispatch/auto-group`, `/dispatch/failed*` | `dispatch.view` / `dispatch.edit` (+2FA), kitchen scope, PII masked without `customers.pii` |

Full request/response schemas: `openapi.yaml`.
