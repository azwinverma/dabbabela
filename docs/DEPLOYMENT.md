# Deployment, operations & launch checklist

Hosting: **Vercel** (functions pinned to `sin1`, Singapore) + **Neon Postgres** (Singapore) +
**Vercel Blob** for media. The database is external to Vercel's runtime.

## Environments
| Env | Vercel | Database | Notes |
|---|---|---|---|
| Development | `npm run dev` | local Postgres | `SEED_DEMO=true`, `DISABLE_STAFF_2FA=true`, `SMS_PROVIDER=console` |
| Staging | Preview deployments / a `staging` branch | Neon branch `staging` | sandbox eSewa/Khalti (`PAYMENTS_SANDBOX=true`), demo seed allowed |
| Production | `main` | Neon `main` branch | real keys, no demo data, 2FA enforced |

## First deployment
1. Push the repo to GitHub; CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit + integration
   tests, build and Playwright E2E against Postgres.
2. Vercel → Import project (framework Next.js; `vercel.json` sets the build command and crons).
3. Storage → Neon Postgres (Singapore) → adds `DATABASE_URL` / `DATABASE_URL_UNPOOLED`.
4. Storage → Blob → adds `BLOB_READ_WRITE_TOKEN`.
5. Environment variables (Production): `BETTER_AUTH_SECRET` (`openssl rand -base64 32`),
   `BETTER_AUTH_URL` and `NEXT_PUBLIC_SITE_URL` (your https domain), `CRON_SECRET`, `SETUP_KEY`,
   `RESEND_API_KEY` + `EMAIL_FROM`, payment keys when activated, SMS keys when approved.
   Security (Phase 2B, all optional and env-gated — see the table below): `NEXT_PUBLIC_TURNSTILE_SITE_KEY` +
   `TURNSTILE_SECRET_KEY`, `SENTRY_DSN` (+ `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` for source maps),
   `STAFF_SESSION_MAX_HOURS`.

### Security environment variables (Phase 2B)
| Variable | Effect when set | When unset |
|---|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile widget on sign-up, login, mobile-code request, password reset, contact, area-request and team-lead forms; tokens verified server-side (siteverify, 5 s timeout). **Fails closed in production** (no/invalid token or Cloudflare unreachable = refused). Both are needed; the site key is inlined at build time, so redeploy after setting it. CSP adds `challenges.cloudflare.com` to `frame-src`/`connect-src`. | Skipped (dev, tests, E2E). `/api/health` → `integrations.turnstile: false` |
| `SENTRY_DSN` | `@sentry/nextjs` (11.11.0, pinned) on server, edge and browser; PII scrubbed (`src/lib/sentry-scrub.ts`); release = `VERCEL_GIT_COMMIT_SHA`; CSP `connect-src` adds the DSN's ingest origin. Redeploy after setting it (the browser DSN is inlined at build). | No SDK loaded or initialised. `/api/health` → `integrations.sentry: false` |
| `SENTRY_TRACES_SAMPLE_RATE` | 0–1 performance tracing sample rate | 0 (errors only) |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` | Source maps uploaded (and deleted from the output) during `next build`; release created | No upload; the build never contacts Sentry |
| `STAFF_SESSION_MAX_HOURS` | Absolute lifetime of a staff session (1–720 h) | 24 h |
| `AUTH_RATE_LIMIT` | `true` turns the sign-in limits on outside production; `false` turns them off (**E2E server only — never in production**) | On in production, off in dev |

The maker-checker threshold is a setting, not an env var: Admin → Settings → "Wallet top-up & approvals" → approval threshold
(default Rs 2,000).
6. Deploy. `vercel-build` runs `prisma generate && prisma migrate deploy && tsx prisma/foundation.ts && next build`.
   The foundation step is idempotent (adds missing preset roles, expense categories, plan price rows, nav links, meal
   categories; never changes existing rows), so it is safe on every deploy, including preview deployments sharing a database.
7. Open `https://<domain>/setup`, enter `SETUP_KEY`, create the owner. This loads allergens, the kitchen,
   zones, slots, ingredients, dishes with starter recipes, the nine dabbas, the weekly rotation, plans,
   policies (marked "needs legal review"), FAQs. It refuses to run again once an owner exists.
8. Sign in → you'll be asked to set up 2FA → then work through the launch checklist below.

## Cron
| Schedule (UTC) | Kathmandu | Path |
|---|---|---|
| `0 4 * * *` | 09:45 | `/api/cron/daily?job=cutoff` — lock today, expire unpaid |
| `15 0 * * *` | 06:00 | `/api/cron/daily?job=housekeeping` — reconcile gateways, finish plans + reminders, scheduled plan prices, publish scheduled menus and CMS pages, settle referral rewards, alert detectors, alert escalation, send/retry the outbox |

The cut-off job also re-runs the capacity/production/unpaid/missing-selection detectors after locking the day.
Every step runs under its own `JobRun` key (`housekeeping.<step>:<Kathmandu date>`), so calling the cron again the
same day only retries the steps that failed; one failing step doesn't stop the others, and the response is 500 when
any step failed. Runs, failures and manual re-runs are in Admin → Scheduled jobs (`/admin/jobs`); failed runs also
raise an alert in Admin → Alerts.

If you change the order cut-off in Settings, move the `cutoff` cron to a few minutes after it.
Hobby plans run each cron once a day and only within the scheduled hour (any minute), so the cut-off job is
scheduled at 04:00 UTC: on Hobby it lands between 09:45 and 10:44 Kathmandu, always after the 09:30 cut-off
(an early run would do nothing). On Pro it runs at 09:45 exactly.
Staff can always lock a day by hand in Admin → Kitchen.

**On Hobby, time-sensitive alerts (delayed production, delayed deliveries) and escalation only run once a day**
(plus whenever someone presses "Run detectors now" in Admin → Alerts, or "Run now" in Admin → Scheduled jobs).
**On Pro**, add `{ "path": "/api/cron/daily?job=frequent", "schedule": "*/15 * * * *" }` to `vercel.json`: it
publishes scheduled menus/pages, runs detectors and escalation, and sends the outbox every 15 minutes (each
quarter-hour is its own idempotency bucket). `?job=alerts` runs only detectors + escalation.

## Migrations & rollback
* Schema changes: `npx prisma migrate dev --name <change>` locally → commit → deploy runs
  `migrate deploy`. Prefer additive migrations (new nullable columns, backfill, then constrain).
* App rollback: Vercel → Deployments → *Promote* the previous deployment (instant).
* DB rollback: Neon point-in-time restore to a branch, verify, then switch `DATABASE_URL`. Never run
  `prisma migrate reset` against staging/production.
* Before risky migrations: create a Neon branch as a snapshot.

## Backups & restore test
Neon keeps point-in-time history (plan dependent). Monthly: restore yesterday into a branch, run
`npx prisma migrate status` and open `/api/health` on a preview pointed at it. Record the result.

## Monitoring
* Uptime monitor on `/api/health` (503 when the DB is down; shows failed jobs/messages).
* Vercel logs / log drain (structured JSON, PII redacted). Sentry error tracking once `SENTRY_DSN` is set (`/api/health`
  shows `sentry: true`). Server errors are captured through Next's `onRequestError` (`src/instrumentation.ts`).
* Alerts center: "Approvals waiting" raises an alert for maker-checker requests pending over 4 h (critical after 24 h) and for
  approved requests whose execution failed.
* Dashboard alerts: failed jobs, failed outbox messages, stuck pending payments, low stock, unverified transfers.

## Operational runbook
| Situation | Do this |
|---|---|
| Bandh / strike / heavy rain | Admin → Closures & disruptions → pick date → preview → MOVE or CREDIT → run. Customers are notified. |
| Cron didn't run | Call `/api/cron/daily?job=cutoff` with the bearer secret; jobs are idempotent. |
| Customer paid but order shows pending | Admin → Payments → the payment → check provider events; housekeeping cron re-checks attempts; finance can verify manually with the gateway reference. |
| Gateway outage | Settings → payment methods → switch the gateway off; cash/bank/credit stay available. |
| Kitchen over capacity | Admin → Kitchens → capacity override for the date, or mark dabbas sold out in the weekly menu. |
| Refund through eSewa/Khalti | Process in the merchant portal, then record it in Admin → Refunds with the reference. |
| Staff member leaves | Admin → Staff → deactivate (sessions revoked immediately). |
| Suspected account compromise | Deactivate, reset password + 2FA, review Audit log. |
| Large refund / credit / adjustment waiting | Admin → Approvals. A second staff member with "Maker-checker approvals → approve" opens it, checks the "Now" column (live refundable amount / balance), approves (executes at once) or rejects with a note. FAILED = the live state changed; fix and press Retry. |
| Turnstile blocks real users (Cloudflare incident) | Unset both Turnstile keys and redeploy (forms fall back to honeypot + rate limits). |

## Verifying a staging deployment (before launch)
1. `npx prisma migrate status` against the staging database shows every migration applied, including `20261120061329_perf_indexes`
   (indexes only; safe on a live database, `CREATE INDEX` takes a short lock per table — run off-peak on a large database).
2. `/api/health` is 200 and lists the integrations you expect as configured.
3. Run the E2E suite against staging (sandbox keys, demo seed allowed on staging only):
   `E2E_BASE_URL=https://<staging> E2E_ALLOW=1 npx playwright test` (global setup switches `staff2fa` off for the run and restores
   it). The specs read and assert on the database directly (`e2e/db.ts`), so the local `DATABASE_URL` must point at the **staging**
   database, and `CRON_SECRET` must match staging; the demo accounts must exist there.
   **Never point E2E at production.**
4. Call `/api/cron/daily?job=housekeeping` once with the bearer secret and check Admin → Scheduled jobs shows every step done.
5. `npm audit --omit=dev` — compare against the triage in [SECURITY.md](SECURITY.md#dependency-audit-2026-11-20).

## Launch checklist (production)
**Verified in code/tests (WP-20, 2026-11-20):** acceptance flow (brief §26) end to end; server-side guard on every action/route;
IDOR isolation (customers, companies, kitchens); cron auth; dev bypasses inert in production; idempotent jobs; price history kept;
reports reconcile with order records. Everything below still needs the owner or a live environment.

- [ ] `BETTER_AUTH_SECRET`, `CRON_SECRET`, `SETUP_KEY` (long, random) set in Production; `SETUP_KEY` removed after `/setup`
- [ ] `DISABLE_STAFF_2FA`, `SEED_DEMO`, `ALLOW_DEMO_SEED`, `PAYMENTS_SANDBOX`, `AUTH_RATE_LIMIT` unset in Production; `SMS_PROVIDER` not `console`
- [ ] Turnstile keys set (`/api/health` → `turnstile: true`); sign up / log in once on production to confirm the widget passes
- [ ] Sentry DSN set (`sentry: true`); trigger a test error on staging and check the event has no email/phone/payment reference
- [ ] Browser console on home, menu, checkout, login, admin and rider shows no CSP violations (the `e2e/security.spec.ts` check, against staging)
- [ ] Approval threshold reviewed in Settings; at least two staff hold "approvals → approve"
- [ ] Staging verified (section above), including the acceptance E2E
- [ ] Brand cleared: trademark search, `.com.np` domain, social handles (name is provisional)
- [ ] Company registration, PAN/VAT; tax advice on VAT rate, invoice format and IRD rules; enter legal name and PAN in Settings; enable the VAT tax rule only after VAT registration
- [ ] Accountant's chart of accounts mapped in the journal export
- [ ] Food business registration / kitchen licence; complete the Food safety page with real details
- [ ] Legal review of Terms, Privacy, Refunds, Allergens pages (all flagged "needs legal review")
- [ ] eSewa merchant account → live keys; Khalti merchant → live key; test one real small payment each and refund it
- [ ] Bank account + Fonepay QR image in Settings
- [ ] SMS sender ID approved (Sparrow/Aakash) → set keys → enable `phoneOtp` if wanted
- [ ] Resend domain verified (SPF/DKIM) → `EMAIL_FROM`
- [ ] Replace placeholder suppliers; weigh recipes after the first test cooks and update quantities/costs
- [ ] Photograph the dabbas (or commission); upload with credit; remove placeholders
- [ ] Nepali copy reviewed by a native editor (UI dictionaries + CMS)
- [ ] Holidays for the next 3 months (Dashain/Tihar/Chhath etc.) added
- [ ] Zones, fees, slots and capacity confirmed with a real delivery trial
- [ ] Staff accounts created with 2FA; demo data absent (`SEED_DEMO` unset)
- [ ] Uptime monitor + error tracking (Sentry) on; backup restore tested once
- [ ] Vercel Firewall / Turnstile on public forms (contact, lead, area request, sign-up)
- [ ] Penetration test (or at least an external review) of auth, payments and the admin
- [ ] Remaining `npm audit` items re-checked (SECURITY.md)
- [ ] Cut-off cron time matches the Settings cut-off
