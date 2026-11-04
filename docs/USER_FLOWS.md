# User flows

Each flow lists the screens and the service that enforces the rules. ✅ = covered by automated tests
(V = Vitest integration, E = Playwright E2E).

## Customer

### Browse and order one day ✅ V+E
`/menu` → `/boxes/[slug]` (pick an open date, optional chef swap) → cart → `/checkout` (address, slot,
coupon, payment) → `/pay/[id]` (online) or `/thank-you/[id]` → `/account/orders/[id]`.
Rules: `quoteCart` / `placeCartOrder` — box must be on that day's menu, day open (cut-off, closure,
lock), capacity (day, slot, box, dish) under a kitchen-day lock, server prices, idempotency key.

### Build-a-Dabba
`/build` → live price via `priceCustomBox` (group min/max, combo rules, minimum price) → save (login)
→ add to cart as `custom`.

### Plan with a custom calendar ✅ V
`/plans` → `/plans/[slug]`: start date, weekdays, address, slot, veg-only → every service date listed
with that day's offers; pick per date or leave "chef's choice" → `createSubscription` (one order per
meal) → pay. Holidays listed and excluded.

### Skip, undo, pause, cancel ✅ V
`/account` upcoming lunches / `/account/plans/[id]`. Before cut-off only. Skip → EXTEND (meal moves to
end) or CREDIT (paid value to wallet) per Settings. Pause holds all future meals; resume re-adds them
once. Cancel returns unlocked paid meals as credit.

### Cancel a single order ✅ V
Before cut-off → full value to credit (or refund request if the policy says FULL_REFUND).

### Address outside coverage ✅ V+E
Address saves with "not covered yet"; checkout refuses with the reason and the recovery (other address
or `/delivery-areas` request).

### Payment problems ✅ V
eSewa/Khalti failure → back to `/pay/[id]` with the reason; switch to cash/bank/credit. Duplicate or
tampered callbacks ignored; unreachable provider → pending, reconciled by cron. Money arriving after the
day closed → order cancelled, money to credit.

### Allergies
Profile → allergies + onion/garlic. Menu "avoid my allergens" filter, warnings on box page and checkout,
allergy note printed on the label, packing check confirms allergens.

## Company

### Onboarding
Lead form `/corporate` → staff work the lead in `/admin/leads` → convert to company → company admin
invites staff (`/team/invites`, single or CSV) or shares the join code → members join (approval if
required).

### Team order
`/team/order` → pick date + members + dabbas → one order per member placed by the admin.
Billing per company mode: company share invoiced monthly (`/admin/invoices` → `/team/invoices`), employee
share paid by the employee.

### Tenant isolation ✅ V
Every `/team` query is scoped to the admin's company; tested.

## Operations (one service day)
1. 09:30 cut-off → cron locks the day (`SCHEDULED → CONFIRMED`) ✅ V; unpaid online orders cancelled.
2. `/admin/kitchen`: forecast portions, ingredient requirements vs stock, batches (done → stock deducted
   once ✅ V), prep sheets per station, tickets, labels with QR + allergen warning, QC log.
3. Packing board: 4-point check → `PACKED`.
4. `/admin/dispatch`: group by slot/zone/drop-off, build routes, assign riders, send out
   (`OUT_FOR_DELIVERY`, customer gets hand-off code).
5. `/rider`: deliver with 4-digit code ✅ V, collect exact cash, or report failure.
6. Dispatch reconciles cash handed in; exceptions retried or credited.
7. Bandh / weather → `/admin/holidays` disruption wizard: move or credit every affected order ✅ V.

## Money
Bank transfer proof → `/admin/payments` verification (bank reference required). Refunds: request →
approve → process with proof ✅ V. Monthly invoices per company, void/credit notes ✅ V.

## Content
`/admin/content` edit (English / Nepali) → save draft → compare → publish → rollback ✅ V.

## Permission denial ✅ V+E
Anonymous → `/login`; chef blocked from dispatch/finance; rider limited to `/rider`; ops manager can't
see finance KPIs or approve refunds; customer can't open `/admin` or `/team`.
