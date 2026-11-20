import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isoDate, ktmNow } from "@/lib/dates";
import { stampRange } from "@/server/analytics/filters";
import { METRICS } from "@/server/analytics/metrics";
import { complaints, complaintsWhere, ratings } from "@/server/analytics/customers";
import { recognisedWhere } from "@/server/analytics/revenue";
import { campaignPerformance, campaignStatus } from "@/server/marketing";
import { pageOf, ratio, totalsOf, windowOf } from "./common";
import type { Col, ReportDef, Row } from "./types";

const stamp = (d: Date | null | undefined) => (d ? `${ktmNow(d).date} ${ktmNow(d).time}` : null);

// ───────────── employee activity ─────────────

export const employeeActivity: ReportDef = {
  key: "employee-activity",
  title: "Employee activity",
  group: "People & marketing",
  description: "Per staff member: audited actions and sign-ins in the range.",
  definition:
    "Actions = audit-log entries the staff member made in the range (every audited change: orders, refunds, menus, stock, settings…), with their most frequent action types. Sign-ins = login events (successful / failed). Kitchen-scoped viewers see staff assigned to their kitchens. Staff with no activity are listed with zeros.",
  view: ["audit.view"],
  exportPerms: [],
  filters: ["range", "kitchen"],
  columns: [
    { key: "name", label: "Staff member" },
    { key: "role", label: "Role" },
    { key: "actions", label: "Actions", kind: "int" },
    { key: "top", label: "Most frequent" },
    { key: "lastAction", label: "Last action" },
    { key: "logins", label: "Sign-ins", kind: "int" },
    { key: "failed", label: "Failed sign-ins", kind: "int" },
    { key: "lastLogin", label: "Last sign-in" },
  ],
  async run({ f }, paging) {
    const st = stampRange(f.from, f.to);
    const staffWhere: Prisma.UserWhereInput = {
      role: { not: "CUSTOMER" },
      deletedAt: null,
      ...(f.kitchenIds ? { OR: [{ kitchenId: { in: f.kitchenIds } }, { scopes: { some: { kitchenId: { in: f.kitchenIds } } } }] } : {}),
    };
    const staff = await db.user.findMany({ where: staffWhere, select: { id: true, name: true, role: true, staffRole: { select: { name: true } } } });
    const ids = staff.map((s) => s.id);
    const [acts, kinds, logins] = await Promise.all([
      db.auditLog.groupBy({ by: ["actorId"], where: { createdAt: st, actorId: { in: ids } }, _count: { _all: true }, _max: { createdAt: true } }),
      db.auditLog.groupBy({ by: ["actorId", "action"], where: { createdAt: st, actorId: { in: ids } }, _count: { _all: true } }),
      db.loginEvent.groupBy({ by: ["userId", "success"], where: { createdAt: st, userId: { in: ids } }, _count: { _all: true }, _max: { createdAt: true } }),
    ]);
    const act = new Map(acts.map((a) => [a.actorId, a]));
    const top = new Map<string, { action: string; n: number }[]>();
    for (const k of kinds) if (k.actorId) top.set(k.actorId, [...(top.get(k.actorId) ?? []), { action: k.action, n: k._count._all }]);
    const all = staff
      .map((s) => {
        const ok = logins.find((l) => l.userId === s.id && l.success);
        const bad = logins.find((l) => l.userId === s.id && !l.success);
        const a = act.get(s.id);
        return {
          name: s.name,
          role: s.staffRole?.name ? `${s.role} · ${s.staffRole.name}` : s.role,
          actions: a?._count._all ?? 0,
          top: (top.get(s.id) ?? [])
            .sort((x, y) => y.n - x.n || x.action.localeCompare(y.action))
            .slice(0, 3)
            .map((x) => `${x.action} ×${x.n}`)
            .join(", "),
          lastAction: stamp(a?._max.createdAt),
          logins: ok?._count._all ?? 0,
          failed: bad?._count._all ?? 0,
          lastLogin: stamp(ok?._max.createdAt),
        };
      })
      .sort((a, b) => b.actions - a.actions || b.logins - a.logins || a.name.localeCompare(b.name));
    return { rows: pageOf(all, paging), count: all.length, totals: totalsOf(all, ["actions", "logins", "failed"], { name: "Total" }) };
  },
};

// ───────────── campaign performance ─────────────

export const campaignPerformanceReport: ReportDef = {
  key: "campaign-performance",
  title: "Marketing campaign performance",
  group: "People & marketing",
  description: "Spend, sign-ups, orders, new customers, revenue, ROAS and CAC per campaign.",
  definition:
    "marketing.campaignPerformance (same as Marketing → Campaigns): spend = Σ campaign spend dated in the range; orders/plans = bookings attributed to the campaign (last touch = order/plan campaign; first touch = customer's first-touch UTM); revenue = recognised revenue of attributed delivered orders; ROAS = revenue ÷ spend; CAC = spend ÷ new customers. Company-wide (spend isn't per kitchen).",
  view: ["marketing.view", "analytics.view"],
  exportPerms: ["analytics.export"],
  filters: ["range"],
  choices: [{ name: "model", label: "Attribution", options: [{ value: "last", label: "Last touch" }, { value: "first", label: "First touch" }] }],
  columns: [
    { key: "campaign", label: "Campaign" },
    { key: "channel", label: "Channel" },
    { key: "status", label: "Status" },
    { key: "spend", label: "Spend", kind: "money" },
    { key: "signups", label: "Sign-ups", kind: "int" },
    { key: "orders", label: "Orders", kind: "int" },
    { key: "plans", label: "Plans", kind: "int" },
    { key: "newCustomers", label: "New customers", kind: "int" },
    { key: "revenue", label: "Recognised revenue", kind: "money" },
    { key: "roas", label: "ROAS", kind: "num" },
    { key: "cac", label: "CAC", kind: "money" },
    { key: "couponDiscount", label: "Coupon discount", kind: "money" },
  ],
  async run({ f, user, choice }, paging) {
    const campaigns = await db.campaign.findMany({ orderBy: [{ startsAt: "desc" }, { name: "asc" }], select: { id: true, name: true, channel: true, isActive: true, startsAt: true, endsAt: true } });
    const perf = await campaignPerformance(user, { from: f.from, to: f.to, model: choice.model === "first" ? "first" : "last" });
    const all: Row[] = campaigns
      .map((c) => {
        const p = perf.get(c.id);
        return {
          campaign: c.name,
          channel: c.channel,
          status: campaignStatus(c),
          spend: p?.spend ?? 0,
          signups: p?.signups ?? null,
          orders: p?.orders ?? 0,
          plans: p?.plans ?? 0,
          newCustomers: p?.newCustomers ?? 0,
          revenue: p?.revenue ?? null,
          roas: p?.roas == null ? null : Math.round(p.roas * 100) / 100,
          cac: p?.cac ?? null,
          couponDiscount: p?.couponDiscount ?? 0,
          _has: p?.hasData ? 1 : 0,
        };
      })
      .sort((a, b) => b._has - a._has || b.spend - a.spend || a.campaign.localeCompare(b.campaign))
      .map(({ _has, ...r }) => (void _has, r));
    const t = totalsOf(all, ["spend", "signups", "orders", "plans", "newCustomers", "revenue", "couponDiscount"], { campaign: "Total" });
    t.roas = Number(t.spend) ? Math.round((Number(t.revenue) / Number(t.spend)) * 100) / 100 : null;
    t.cac = Number(t.spend) && Number(t.newCustomers) ? Math.round(Number(t.spend) / Number(t.newCustomers)) : null;
    return { rows: pageOf(all, paging), count: all.length, totals: t };
  },
};

// ───────────── complaints & feedback ─────────────

const CATEGORY_COLS: Col[] = [
  { key: "category", label: "Category" },
  { key: "tickets", label: "Tickets", kind: "int" },
  { key: "open", label: "Open / pending", kind: "int" },
  { key: "resolved", label: "Resolved / closed", kind: "int" },
  { key: "share", label: "Share", kind: "pct" },
];
const TICKET_COLS: Col[] = [
  { key: "opened", label: "Opened" },
  { key: "number", label: "Ticket" },
  { key: "category", label: "Category" },
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
  { key: "subject", label: "Subject" },
  { key: "customer", label: "Customer" },
  { key: "email", label: "Email", kind: "email" },
  { key: "order", label: "Order" },
  { key: "resolved", label: "Resolved" },
];
const FEEDBACK_COLS: Col[] = [
  { key: "date", label: "Delivery date", kind: "date" },
  { key: "order", label: "Order" },
  { key: "customer", label: "Customer" },
  { key: "rating", label: "Rating", kind: "int" },
  { key: "taste", label: "Taste", kind: "int" },
  { key: "portion", label: "Portion", kind: "int" },
  { key: "onTime", label: "On time" },
  { key: "comment", label: "Comment" },
];

export const complaintsFeedback: ReportDef = {
  key: "complaints-feedback",
  title: "Complaints & feedback",
  group: "People & marketing",
  description: "Support tickets by category or one by one, and the ratings customers left.",
  definition:
    "Analytics → Complaints: support tickets opened in the range (tickets linked to an order follow the kitchen/company filters). Feedback: ratings customers chose to leave on orders delivered in the range — Analytics → Average rating.",
  view: ["support.view"],
  exportPerms: [],
  filters: ["range", "kitchen", "company"],
  choices: [{ name: "view", label: "Rows", options: [{ value: "categories", label: "By category" }, { value: "tickets", label: "Tickets" }, { value: "feedback", label: "Feedback" }] }],
  columns: CATEGORY_COLS,
  async run({ f, choice }, paging) {
    const [c, r, low] = await Promise.all([complaints(f), ratings(f), db.feedback.count({ where: { order: recognisedWhere(f), rating: { lte: 2 } } })]);
    const summary = [
      { label: METRICS.complaints.label, value: c.total, kind: "int" as const, note: METRICS.complaints.definition },
      { label: METRICS.rating.label, value: r.average == null ? null : Math.round(r.average * 100) / 100, kind: "num" as const, note: METRICS.rating.definition },
      { label: "Ratings left", value: r.count, kind: "int" as const },
      { label: "Low ratings (1–2)", value: low, kind: "int" as const },
    ];
    if (choice.view === "tickets") {
      const where = complaintsWhere(f);
      const [count, list] = await Promise.all([
        db.supportTicket.count({ where }),
        db.supportTicket.findMany({
          where,
          orderBy: { createdAt: "desc" },
          ...windowOf(paging),
          select: { createdAt: true, number: true, category: true, priority: true, status: true, subject: true, name: true, email: true, resolvedAt: true, user: { select: { name: true, email: true } }, order: { select: { number: true } } },
        }),
      ]);
      return {
        rows: list.map((t) => ({ opened: stamp(t.createdAt), number: t.number, category: t.category, priority: t.priority, status: t.status, subject: t.subject, customer: t.user?.name ?? t.name ?? "", email: t.user?.email ?? t.email, order: t.order?.number ?? "", resolved: stamp(t.resolvedAt) })),
        count,
        columns: TICKET_COLS,
        summary,
      };
    }
    if (choice.view === "feedback") {
      const where: Prisma.FeedbackWhereInput = { order: recognisedWhere(f) };
      const [count, list] = await Promise.all([
        db.feedback.count({ where }),
        db.feedback.findMany({
          where,
          orderBy: [{ rating: "asc" }, { createdAt: "desc" }],
          ...windowOf(paging),
          select: { rating: true, taste: true, portion: true, onTime: true, comment: true, user: { select: { name: true } }, order: { select: { number: true, deliveryDate: true } } },
        }),
      ]);
      return {
        rows: list.map((x) => ({ date: isoDate(x.order.deliveryDate), order: x.order.number, customer: x.user.name, rating: x.rating, taste: x.taste, portion: x.portion, onTime: x.onTime == null ? "" : x.onTime ? "Yes" : "No", comment: x.comment ?? "" })),
        count,
        columns: FEEDBACK_COLS,
        summary,
      };
    }
    const byStatus = await db.supportTicket.groupBy({ by: ["category", "status"], where: complaintsWhere(f), _count: { _all: true } });
    const all = c.byCategory.map((x) => {
      const rows = byStatus.filter((s) => s.category === x.category);
      const n = (sts: string[]) => rows.filter((s) => sts.includes(s.status)).reduce((a, s) => a + s._count._all, 0);
      return { category: x.category, tickets: x.count, open: n(["OPEN", "PENDING"]), resolved: n(["RESOLVED", "CLOSED"]), share: ratio(x.count, c.total) };
    });
    return { rows: pageOf(all, paging), count: all.length, columns: CATEGORY_COLS, totals: { ...totalsOf(all, ["tickets", "open", "resolved"], { category: "Total" }), share: c.total ? 1 : null }, summary };
  },
};
