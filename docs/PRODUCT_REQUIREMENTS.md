# Product requirements — Dabba Bela (डब्बा बेला)

Working brand, subject to trademark, domain and social-handle clearance (see IMPLEMENTATION_STATUS → blockers).
Source of truth for scope: `docs/Dabba_Bela_Claude_Code_Master_Build_Brief.md`.

## Problem
People who work away from home in Kathmandu — office staff, shopkeepers, students, shift workers, site
crews — eat expensive, oily or repetitive lunches. Cooking at home each morning isn't realistic.
Employers who want to feed staff have no simple, invoiceable option.

## Product
A cloud kitchen that cooks a **weekly-rotating menu of home-style dabbas** each morning and delivers them
at lunchtime to **any address inside its delivery zones** — office, shop, college, work site or home.

What customers can buy:
| Offer | Rules |
|---|---|
| Single dabba for any open day | Same-day cut-off (default 09:30), book up to 28 days ahead |
| Build-a-Dabba | Base / main / protein / veg / sides / achar / add-ons within chef rules; minimum price |
| Meal plans (weekly, 2-week, 4-week, team) | Counted in **real service days**; holidays excluded and not charged; chef's rotation or per-date picks |
| Corporate | Company-paid, employee-paid or split subsidy with per-meal cap and monthly allowance; monthly invoice |

## Audiences and jobs
| Who | Job to be done |
|---|---|
| Individual eater | See what's on, order quickly, skip a day without losing money, trust allergen info |
| Company admin / HR | Get staff fed, control spend, one VAT invoice, roster changes without calls |
| Owner | Know revenue, margins, waste and what's due today; change menus, prices, rules and copy without a developer |
| Kitchen / store / dispatch / rider / finance / support staff | Each gets only the screens their role needs |

## USPs (from the brief) and where they live
1. Menu rotates weekly → Weekly menus (admin), `/menu`
2. Scheduled delivery by zone/slot → Zones, slots, dispatch manifest
3. Custom week/month calendar → plan wizard per-date picks, Build-a-Dabba
4. Pause / skip / reschedule within cut-off → account actions, `skipPolicy` setting
5. Corporate grouping & sponsorship → `/team`, company billing modes
6. Transparent composition, allergens, diet tags → derived from recipes; nutrition only with a source label
7. Recipe cost & waste visibility → recipe BOM, batches, variance report
8. Owner dashboard + CMS → `/admin`

## Non-negotiables
* No fake data: no invented testimonials, ratings, customer counts, partner logos or kitchen certifications.
* No unverified health claims (probiotics, "complete protein", disease prevention). Nutrition is labelled
  *estimated* or *verified* with a note, or not shown.
* Shared-kitchen allergen disclaimer wherever allergens are shown; customer allergies printed on labels.
* No payment is shown as successful unless the server verified it with the provider (or staff verified a
  bank transfer against a reference).
* Everything operational is configurable from the admin: menus, prices, plans, rules, zones, slots,
  capacity, holidays, taxes, coupons, copy, policies, notification templates, feature flags, brand name.

## Success metrics (dashboard)
Repeat-customer rate, active plans, meals per day vs capacity, contribution margin, waste %, on-time
delivery %, unpaid/failed payments, open tickets. Formulas are shown next to each KPI in the dashboard.

## Out of scope for v1 (backlog)
Auto-renewing plans with stored payment tokens, route optimisation engine, native mobile apps, loyalty /
referrals (only after fraud rules), Bikram Sambat calendar display (flag exists, off until a tested library
is added), API refunds through gateways (refunds are processed in merchant portals and recorded with proof).

## Scope extension: Super Admin Control Center (2026-11-04)
The owner's "Super Admin, CMS, Business ERP & Frontend Integration" brief extends v1 within the **same single application,
database and permission system** (no separate admin app). Phase 0 deliverables:
* [FEATURE_AUDIT.md](FEATURE_AUDIT.md): what exists vs. the brief, section by section, with evidence.
* [SUPER_ADMIN_ARCHITECTURE.md](SUPER_ADMIN_ARCHITECTURE.md): target design for granular RBAC with custom roles and scopes, revenue
  bases (bookings / cash / recognised / deferred) and the plan run-rate, estimated-vs-actual profitability, alerts, CMS page
  builder, inventory lots and transfers, and finance payables.
* [ADMIN_IMPLEMENTATION_TRACKER.md](ADMIN_IMPLEMENTATION_TRACKER.md): work packages WP-00…WP-20 and status.

The following move from "Out of scope for v1" into planned scope:
- loyalty and referrals (WP-15, with fraud rules);
- a rider date picker (WP-13);
- expenses and profitability (WP-09).

These remain out of scope or blocked:
- auto-renew with stored tokens;
- route optimisation;
- push notifications;
- GPS tracking (not advertised);
- gateway API refunds (⛔ merchant approval).

Acceptance is brief §26 (an 18-step end-to-end flow), verified by `e2e/acceptance.spec.ts` (WP-20).
