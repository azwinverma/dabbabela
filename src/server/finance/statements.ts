import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseRupees, rs } from "@/lib/money";
import { assertCan, FinanceError, type Actor } from "./common";

/**
 * Gateway statement import (WP-09). Finance downloads the settlement CSV from the eSewa / Khalti merchant portal
 * (or a bank statement) and uploads it here. Each row becomes a `GatewayStatementLine`, matched to our Payment by
 * provider reference: PaymentAttempt.providerRef (eSewa transaction_uuid / Khalti pidx), Payment.reference, or
 * "<payment reference>-<attempt no>" (Khalti purchase_order_id).
 *
 * - Idempotent: (provider, providerRef) is unique, so re-importing a file adds nothing ("already imported").
 * - Flags: unmatched rows, a reference repeated inside the file, a payment settled by more than one row
 *   (duplicate payment), amount differences, and money the gateway settled for a payment we don't show as paid.
 * - Fees: `Payment.feeActual` = Σ fee of the rows matched to it (the estimate stays in `gatewayFee`).
 *
 * Live merchant keys / portal formats are an external blocker; column names are matched loosely (see COLUMNS).
 */

export const PROVIDERS = ["ESEWA", "KHALTI", "BANK"] as const;
export type Provider = (typeof PROVIDERS)[number];
const PAID_STATES = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export const COLUMNS = {
  ref: ["reference", "ref", "providerref", "transactionuuid", "pidx", "purchaseorderid", "transactionid", "txnid", "productid", "referenceid", "transactioncode"],
  amount: ["amount", "total", "totalamount", "gross", "grossamount", "transactionamount"],
  fee: ["fee", "fees", "charge", "servicecharge", "commission", "merchantfee", "mdr"],
  date: ["date", "settledat", "settlementdate", "transactiondate", "created", "createdat", "datetime", "valuedate"],
} as const;

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

function parseWhen(s: string): Date | null {
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(`${s}T12:00:00+05:45`);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); // DD/MM/YYYY (Nepali portals)
  if (m) return new Date(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T12:00:00+05:45`);
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(" ", "T")}+05:45`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type StatementRow = { line: number; providerRef: string; amount: number; fee: number; settledAt: Date };

/** Map a CSV to rows; returns per-line errors instead of throwing so finance can fix the file. */
export function readStatement(text: string, opts: { unit?: "rupees" | "paisa" } = {}) {
  const table = parseCsv(text);
  if (table.length < 2) throw new FinanceError("The file has no data rows");
  const head = table[0].map(norm);
  const col = (k: keyof typeof COLUMNS) => head.findIndex((h) => (COLUMNS[k] as readonly string[]).includes(h));
  const idx = { ref: col("ref"), amount: col("amount"), fee: col("fee"), date: col("date") };
  if (idx.ref < 0 || idx.amount < 0 || idx.date < 0) throw new FinanceError("Couldn't find the reference, amount and date columns — rename the headers to reference, amount, fee, date");
  if (table.length > 5001) throw new FinanceError("At most 5000 rows per file");
  const money = (s: string) => {
    if (!s) return 0;
    if (opts.unit === "paisa") return /^-?\d+$/.test(s.replace(/,/g, "")) ? parseInt(s.replace(/,/g, ""), 10) : null;
    return parseRupees(s);
  };
  const rows: StatementRow[] = [];
  const errors: { line: number; error: string }[] = [];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const providerRef = (r[idx.ref] ?? "").slice(0, 120);
    const amount = money(r[idx.amount] ?? "");
    const fee = idx.fee >= 0 ? money(r[idx.fee] ?? "") : 0;
    const settledAt = parseWhen(r[idx.date] ?? "");
    if (!providerRef) errors.push({ line, error: "No reference" });
    else if (amount == null || amount <= 0) errors.push({ line, error: "Amount isn't a positive number" });
    else if (fee == null || fee < 0) errors.push({ line, error: "Fee isn't a number" });
    else if (!settledAt) errors.push({ line, error: "Date not recognised (use YYYY-MM-DD)" });
    else rows.push({ line, providerRef, amount, fee: Math.abs(fee), settledAt });
  });
  return { rows, errors };
}

/** Find our payment for a provider reference. */
async function findPayment(provider: Provider, ref: string) {
  const attempt = await db.paymentAttempt.findUnique({ where: { providerRef: ref }, select: { paymentId: true } });
  let paymentId = attempt?.paymentId ?? null;
  if (!paymentId) paymentId = (await db.payment.findUnique({ where: { reference: ref }, select: { id: true } }))?.id ?? null;
  if (!paymentId) {
    const m = /^(.+)-(\d+)$/.exec(ref);
    if (m) paymentId = (await db.payment.findUnique({ where: { reference: m[1] }, select: { id: true } }))?.id ?? null;
  }
  if (!paymentId) return null;
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { id: true, reference: true, method: true, status: true, amount: true } });
  const methodOk = provider === "BANK" ? p.method === "BANK_TRANSFER" : p.method === provider;
  return methodOk ? p : { ...p, wrongMethod: true as const };
}

export type ImportReport = {
  batch: string;
  provider: Provider;
  rows: number;
  imported: number;
  alreadyImported: number;
  matched: number;
  unmatched: { line: number; providerRef: string; amount: number; reason: string }[];
  duplicatesInFile: { line: number; providerRef: string }[];
  duplicatePayments: { paymentId: string; reference: string; lines: number; amount: number }[];
  amountMismatches: { line: number; providerRef: string; statement: number; payment: number }[];
  notPaidInSystem: { line: number; providerRef: string; paymentId: string; status: string }[];
  errors: { line: number; error: string }[];
  feesUpdated: number;
};

export async function importStatement(actor: Actor, input: { provider: Provider; csv: string; unit?: "rupees" | "paisa"; filename?: string }): Promise<ImportReport> {
  assertCan(actor, "settlements.edit");
  if (!(PROVIDERS as readonly string[]).includes(input.provider)) throw new FinanceError("Pick the gateway");
  const { rows, errors } = readStatement(input.csv, { unit: input.unit });
  const batch = `${input.provider}-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const report: ImportReport = { batch, provider: input.provider, rows: rows.length, imported: 0, alreadyImported: 0, matched: 0, unmatched: [], duplicatesInFile: [], duplicatePayments: [], amountMismatches: [], notPaidInSystem: [], errors, feesUpdated: 0 };
  const seen = new Set<string>();
  const touched = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.providerRef)) {
      report.duplicatesInFile.push({ line: r.line, providerRef: r.providerRef });
      continue;
    }
    seen.add(r.providerRef);
    const existing = await db.gatewayStatementLine.findUnique({ where: { provider_providerRef: { provider: input.provider, providerRef: r.providerRef } } });
    if (existing) {
      report.alreadyImported++;
      continue;
    }
    const p = await findPayment(input.provider, r.providerRef);
    const match = p && !("wrongMethod" in p) ? p : null;
    try {
      await db.gatewayStatementLine.create({ data: { provider: input.provider, providerRef: r.providerRef, amount: r.amount, fee: r.fee, settledAt: r.settledAt, matchedPaymentId: match?.id ?? null, batch } });
    } catch (e) {
      // A concurrent import of the same file inserted it first.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        report.alreadyImported++;
        continue;
      }
      throw e;
    }
    report.imported++;
    if (!match) {
      report.unmatched.push({ line: r.line, providerRef: r.providerRef, amount: r.amount, reason: p ? `Reference belongs to a ${p.method} payment` : "No payment with this reference" });
      continue;
    }
    report.matched++;
    touched.add(match.id);
    if (r.amount !== match.amount) report.amountMismatches.push({ line: r.line, providerRef: r.providerRef, statement: r.amount, payment: match.amount });
    if (!PAID_STATES.includes(match.status)) report.notPaidInSystem.push({ line: r.line, providerRef: r.providerRef, paymentId: match.id, status: match.status });
  }
  report.feesUpdated = await refreshFeeActuals([...touched]);
  // Duplicate payment detection: a payment settled by more than one statement row (this file or an earlier one).
  if (touched.size) {
    const dup = await db.gatewayStatementLine.groupBy({ by: ["matchedPaymentId"], where: { matchedPaymentId: { in: [...touched] } }, _count: { _all: true }, _sum: { amount: true }, having: { matchedPaymentId: { _count: { gt: 1 } } } });
    const refs = new Map((await db.payment.findMany({ where: { id: { in: dup.map((d) => d.matchedPaymentId!) } }, select: { id: true, reference: true } })).map((p) => [p.id, p.reference]));
    report.duplicatePayments = dup.map((d) => ({ paymentId: d.matchedPaymentId!, reference: refs.get(d.matchedPaymentId!) ?? "", lines: d._count._all, amount: d._sum.amount ?? 0 }));
  }
  await audit({
    actorId: actor.id,
    action: "statement.import",
    entity: "GatewayStatementLine",
    entityId: batch,
    summary: `${input.provider} ${input.filename ?? "statement"}: ${report.imported} new, ${report.alreadyImported} already imported, ${report.matched} matched, ${report.unmatched.length} unmatched, ${report.duplicatePayments.length} duplicate payment(s)`,
    after: {
      rows: report.rows,
      imported: report.imported,
      alreadyImported: report.alreadyImported,
      matched: report.matched,
      unmatched: report.unmatched.length,
      duplicatesInFile: report.duplicatesInFile.length,
      duplicatePayments: report.duplicatePayments.map((d) => d.reference),
      amountMismatches: report.amountMismatches.length,
      errors: report.errors.length,
    },
  });
  return report;
}

/** feeActual = Σ fee of matched statement lines. Returns how many payments changed. */
export async function refreshFeeActuals(paymentIds: string[]) {
  if (!paymentIds.length) return 0;
  const sums = await db.gatewayStatementLine.groupBy({ by: ["matchedPaymentId"], where: { matchedPaymentId: { in: paymentIds } }, _sum: { fee: true } });
  let changed = 0;
  for (const s of sums) {
    const fee = s._sum.fee ?? 0;
    const r = await db.payment.updateMany({ where: { id: s.matchedPaymentId!, OR: [{ feeActual: null }, { feeActual: { not: fee } }] }, data: { feeActual: fee } });
    changed += r.count;
  }
  return changed;
}

/** Match an unmatched line by hand to a payment reference (e.g. the portal shows a different id). */
export async function matchLineManually(actor: Actor, lineId: string, paymentReference: string) {
  assertCan(actor, "settlements.edit");
  const line = await db.gatewayStatementLine.findUniqueOrThrow({ where: { id: lineId } });
  if (line.matchedPaymentId) throw new FinanceError("This line is already matched");
  const p = await db.payment.findUnique({ where: { reference: paymentReference.trim() } });
  if (!p) throw new FinanceError("No payment with that reference");
  const methodOk = line.provider === "BANK" ? p.method === "BANK_TRANSFER" : p.method === line.provider;
  if (!methodOk) throw new FinanceError(`That payment was made by ${p.method}`);
  const r = await db.gatewayStatementLine.updateMany({ where: { id: lineId, matchedPaymentId: null }, data: { matchedPaymentId: p.id } });
  if (!r.count) throw new FinanceError("This line changed — reload");
  await refreshFeeActuals([p.id]);
  await audit({ actorId: actor.id, action: "statement.match", entity: "GatewayStatementLine", entityId: lineId, summary: `${line.provider} ${line.providerRef} → ${p.reference} (${rs(line.amount)})` });
}

export async function unmatchedLines(provider?: Provider, take = 100) {
  return db.gatewayStatementLine.findMany({ where: { matchedPaymentId: null, ...(provider ? { provider } : {}) }, orderBy: { settledAt: "desc" }, take });
}

/** Payments settled by more than one statement line. */
export async function statementDuplicates() {
  const dup = await db.gatewayStatementLine.groupBy({ by: ["matchedPaymentId"], where: { matchedPaymentId: { not: null } }, _count: { _all: true }, _sum: { amount: true }, having: { matchedPaymentId: { _count: { gt: 1 } } } });
  if (!dup.length) return [];
  const pays = await db.payment.findMany({ where: { id: { in: dup.map((d) => d.matchedPaymentId!) } }, select: { id: true, reference: true, amount: true, method: true } });
  const by = new Map(pays.map((p) => [p.id, p]));
  return dup.map((d) => ({ payment: by.get(d.matchedPaymentId!)!, lines: d._count._all, settled: d._sum.amount ?? 0 }));
}

/**
 * Suspected duplicate payments in our own records: two paid payments by the same customer for the same amount
 * within 10 minutes (double checkout), per the architecture's duplicate-payment rule.
 */
export async function duplicatePaymentSuspects(since: Date, until = new Date()) {
  return db.$queryRaw<{ a: string; b: string; aref: string; bref: string; userId: string; amount: number; method_a: string; method_b: string; gap_s: number }[]>`
    SELECT a.id AS a, b.id AS b, a.reference AS aref, b.reference AS bref, a."userId", a.amount, a.method::text AS method_a, b.method::text AS method_b,
           EXTRACT(EPOCH FROM (b."paidAt" - a."paidAt"))::int AS gap_s
    FROM "Payment" a
    JOIN "Payment" b ON b."userId" = a."userId" AND b.amount = a.amount AND b.id <> a.id
      AND b."paidAt" >= a."paidAt" AND b."paidAt" <= a."paidAt" + interval '10 minutes' AND (b."paidAt" > a."paidAt" OR b.id > a.id)
    WHERE a.status::text = ANY(${PAID_STATES}) AND b.status::text = ANY(${PAID_STATES})
      AND a."paidAt" >= ${since} AND a."paidAt" < ${until} AND a.amount > 0 AND a.method::text <> 'WALLET' AND b.method::text <> 'WALLET'
    ORDER BY a."paidAt" DESC
    LIMIT 100`;
}

/** Imported batches, newest first. */
export async function statementBatches(take = 20) {
  const rows = await db.gatewayStatementLine.groupBy({ by: ["batch", "provider"], _count: { _all: true }, _sum: { amount: true, fee: true }, _max: { importedAt: true }, orderBy: { _max: { importedAt: "desc" } }, take });
  const unmatched = await db.gatewayStatementLine.groupBy({ by: ["batch"], where: { batch: { in: rows.map((r) => r.batch) }, matchedPaymentId: null }, _count: { _all: true } });
  const um = new Map(unmatched.map((u) => [u.batch, u._count._all]));
  return rows.map((r) => ({ batch: r.batch, provider: r.provider, lines: r._count._all, amount: r._sum.amount ?? 0, fee: r._sum.fee ?? 0, importedAt: r._max.importedAt, unmatched: um.get(r.batch) ?? 0 }));
}
