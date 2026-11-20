import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { ApiError, created, iso, readJson, readQuery, ymd } from "@/server/api/http";
import { assertKitchenScope, pickApiKitchen } from "@/server/api/auth";
import { isoDateStr } from "@/server/api/ops-dto";
import { dateOnly, todayKTM } from "@/lib/dates";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const q = z.object({ kitchenId: z.string().max(64).optional(), date: isoDateStr.optional() });

const schema = z
  .object({
    kitchenId: z.string().min(1).max(64),
    date: isoDateStr,
    type: z.enum(["TEMPERATURE", "TASTE", "HYGIENE", "PACKAGING", "OTHER"]),
    result: z.enum(["PASS", "FAIL"]),
    value: z.string().trim().max(60).optional(),
    note: z.string().trim().max(500).optional(),
    batchId: z.string().max(64).optional(),
  })
  .refine((v) => v.result !== "FAIL" || Boolean(v.note), { message: "Describe the failure and what was done", path: ["note"] });

/** QC checks logged for a kitchen-day. */
export const GET = apiRoute({ auth: { permission: "kitchen.view" } }, async ({ req, user }) => {
  const p = readQuery(req, q);
  const kitchen = await pickApiKitchen(user, p.kitchenId);
  const date = p.date ?? todayKTM();
  const logs = await db.qcLog.findMany({ where: { kitchenId: kitchen.id, date: dateOnly(date) }, include: { batch: { include: { menuItem: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } });
  return { kitchen, date, checks: logs.map((l) => ({ id: l.id, date: ymd(l.date), type: l.type, result: l.result, value: l.value, note: l.note, batchId: l.batchId, dish: l.batch?.menuItem.name ?? null, actorId: l.actorId, createdAt: iso(l.createdAt) })) };
});

/** Log a QC check (same validation as the web QC form: a FAIL needs a note; the batch must be in that kitchen). */
export const POST = apiRoute({ auth: { permission: "kitchen.edit" }, limit: "write" }, async ({ req, user }) => {
  const b = await readJson(req, schema);
  assertKitchenScope(user, b.kitchenId);
  if (b.batchId && !(await db.productionBatch.findFirst({ where: { id: b.batchId, kitchenId: b.kitchenId }, select: { id: true } })))
    throw new ApiError(422, "VALIDATION_FAILED", "That batch isn't in this kitchen", { batchId: "Not in this kitchen" });
  const row = await db.qcLog.create({ data: { kitchenId: b.kitchenId, date: dateOnly(b.date), type: b.type, result: b.result, value: b.value || null, note: b.note || null, batchId: b.batchId || null, actorId: user.id } });
  return created({ id: row.id, createdAt: iso(row.createdAt) });
});
