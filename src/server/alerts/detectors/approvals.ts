import "server-only";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import type { Detector, Finding } from "../types";

/** A maker-checker request still PENDING after this long raises an alert (CRITICAL after 6× as long). */
export const APPROVAL_STALE_HOURS = 4;
const HOUR = 3600_000;

/**
 * Maker-checker requests waiting too long for a second person, and approved requests whose execution FAILED.
 * Condition alerts: they resolve on their own once the request is decided / executed.
 */
export const approvals: Detector = {
  name: "approvals",
  label: "Approvals waiting",
  mode: "condition",
  async run({ now }) {
    const out: Finding[] = [];
    const stale = await db.approvalRequest.findMany({
      where: { status: "PENDING", createdAt: { lte: new Date(now.getTime() - APPROVAL_STALE_HOURS * HOUR) } },
      include: { requestedBy: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    for (const r of stale) {
      const hours = Math.floor((now.getTime() - r.createdAt.getTime()) / HOUR);
      out.push({
        type: "APPROVAL_PENDING",
        severity: hours >= APPROVAL_STALE_HOURS * 6 ? "CRITICAL" : "WARNING",
        entity: "ApprovalRequest",
        entityId: r.id,
        key: `pending:${r.id}`,
        kitchenId: r.kitchenId,
        message: `${r.kind.replace(/_/g, " ").toLowerCase()} of ${rs(r.amount)} requested by ${r.requestedBy.name} has waited ${hours} h for approval`,
        href: `/admin/approvals/${r.id}`,
        data: { kind: r.kind, amount: r.amount, hours },
      });
    }
    const failed = await db.approvalRequest.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "asc" }, take: 100 });
    for (const r of failed)
      out.push({
        type: "APPROVAL_FAILED",
        severity: "WARNING",
        entity: "ApprovalRequest",
        entityId: r.id,
        key: `failed:${r.id}`,
        kitchenId: r.kitchenId,
        message: `Approved ${r.kind.replace(/_/g, " ").toLowerCase()} of ${rs(r.amount)} failed to execute: ${(r.error ?? "unknown error").slice(0, 160)}`,
        href: `/admin/approvals/${r.id}`,
        data: { kind: r.kind, amount: r.amount },
      });
    return out;
  },
};
