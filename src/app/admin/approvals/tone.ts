import type { ApprovalStatus } from "@prisma/client";
import type { Tone } from "@/lib/labels";

export const APPROVAL_TONE: Record<ApprovalStatus, Tone> = { PENDING: "warn", APPROVED: "info", EXECUTED: "good", FAILED: "bad", REJECTED: "neutral", CANCELLED: "neutral" };
