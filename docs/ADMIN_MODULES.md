# Admin modules (control room `/admin`)

Every page and server action calls `requirePermission(...)`; the sidebar hides what a role can't use.
Staff must have TOTP 2FA when the `staff2fa` flag is on (production default). Overrides are written to
the audit log with who / when / why / before / after.

## Permission matrix (summary — source: `src/lib/permissions.ts`)

| Module | Super admin / Owner | Ops manager | Finance | Support | Menu mgr | Content | Kitchen | Inventory | Dispatcher | Rider |
|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard (ops KPIs) | ✓ | ✓ | ✓ | | | | | | | |
| Dashboard money KPIs | ✓ | | ✓ | | | | | | | |
| Orders view / manage | ✓ / ✓ | ✓ / ✓ | ✓ / – | ✓ / ✓ | | | ✓ / – | | ✓ / – | |
| Kitchen | ✓ | ✓ | | | | | ✓ | ✓ | | |
| Inventory | ✓ | ✓ | | | | | | ✓ | | |
| Dispatch | ✓ | ✓ | | | | | | | ✓ | |
| Rider app | ✓ | | | | | | | | ✓ | ✓ |
| Payments view / verify | ✓ / ✓ | ✓ / – | ✓ / ✓ | ✓ / – | | | | | | |
| Refunds request / approve | ✓ / ✓ | ✓ / – | ✓ / ✓ | ✓ / – | | | | | | |
| Invoices | ✓ | | ✓ | | | | | | | |
| Menu, dabbas, weekly menus | ✓ | ✓ | | | ✓ | | | | | |
| Recipes | ✓ | | | | ✓ | | | ✓ | | |
| Plans | ✓ | | | | ✓ | | | | | |
| Service rules (kitchens, zones, closures) | ✓ | ✓ | | | | | | | | |
| Pricing (coupons, tax) | ✓ | | ✓ | | | | | | | |
| Customers / PII unmasked | ✓ / ✓ | ✓ / ✓ | ✓ / – | ✓ / ✓ | | | | | | |
| Companies / leads | ✓ / ✓ | ✓ / ✓ | ✓ / – | ✓ / – | | | | | | |
| Support tickets | ✓ | ✓ | | ✓ | | | | | | |
| CMS, pages, blog, FAQs, testimonials | ✓ | | | | | ✓ | | | | |
| Media | ✓ | | | | ✓ | ✓ | | | | |
| Banners & promos | ✓ | | | | | ✓ | | | | |
| Staff, settings, notifications, audit | ✓ | | | | | | | | | |
| Privacy requests | ✓ | | | ✓ | | | | | | |

Corporate admins are not staff: they use `/team`, scoped to their own company.

## Modules

| Group | Route | What it does |
|---|---|---|
| Overview | `/admin` | KPIs with formulas, alerts, cohorts, CAC (manual marketing spend) |
| | `/admin/reports` | Breakdowns + 11 CSV exports (PII masked by permission, audited) |
| Operations | `/admin/orders` | Filters, timeline, validated status changes, cancel + settlement, adjustments, refund requests, bulk changes |
| | `/admin/kitchen` (+ prep, tickets, labels, requirements, qc) | Day lock, forecast, batches, station prep sheets, KOT, QR labels, shortages → draft POs, packing checks, QC |
| | `/admin/inventory` (+ ingredients, suppliers, purchases, movements, variance) | Stock ledger, reorder & expiry alerts, POs, receiving, theoretical vs actual |
| | `/admin/dispatch` (+ manifest) | Routes, rider assignment, send out, cash custody, failed deliveries |
| | `/admin/subscriptions` | Plans sold, staff skip/pause/resume/cancel |
| | `/admin/support`, `/admin/messages` | Ticket queue with internal notes; contact inbox → tickets |
| Money | `/admin/payments` | Attempts, provider events, bank-transfer verification, reconciliation |
| | `/admin/refunds` | Request → approve → process with proof; wallet ledger & adjustments |
| | `/admin/invoices` | Monthly company invoices, payments, void, credit notes, ageing, print |
| Menu | `/admin/dishes` | Dishes, allergens, nutrition with source, versioned recipes & cost |
| | `/admin/boxes` | Composition, derived diet/allergens/cost/margin, swaps, photos |
| | `/admin/weekly-menus` | Week grid, several dabbas/day, chef's pick, capacity, sold out, publish → re-assign booked rotation meals |
| | `/admin/builder` | Build-a-Dabba groups, options, combo rules, minimum price |
| | `/admin/plans` | Plan catalogue |
| Service rules | `/admin/kitchens`, `/admin/zones`, `/admin/holidays`, `/admin/coupons`, `/admin/taxes` | Capacity, slots, coverage, closures & disruption wizard, coupons, effective-dated VAT |
| People | `/admin/customers`, `/admin/companies`, `/admin/leads`, `/admin/privacy` | Customer 360, company billing setup, CRM pipeline, data requests |
| Website | `/admin/content`, `/admin/pages`, `/admin/blog`, `/admin/banners`, `/admin/testimonials`, `/admin/faqs`, `/admin/media` | Per-locale CMS with draft/publish/rollback, home layout, policies, scheduled banners, consented testimonials |
| System | `/admin/staff`, `/admin/notifications`, `/admin/settings`, `/admin/audit` | Roles & kitchen scope, templates & outbox, settings & feature flags, audit diff |

Other portals: `/rider` (delivery agents), `/team` (company admins), `/setup` (first owner, once).
