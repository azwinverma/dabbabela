import "server-only";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { log } from "@/lib/logger";
import { isoDate } from "@/lib/dates";
import { OrderError } from "@/server/orders";
import { PaymentError } from "@/server/payments";
import { CapacityError } from "@/server/capacity";
import { CrmError } from "@/server/crm";
import { TopupError } from "@/server/wallet-topup";
import { DispatchError, HandoffLockedError } from "@/server/dispatch";
import { KitchenError } from "@/server/kitchen";
import { CoverageError } from "@/server/coverage";
import { PinError } from "@/server/customer-dashboard";
import { MarketingError } from "@/server/marketing";
import { InventoryError } from "@/server/inventory";
import { CorporateError, CorporateForbidden } from "@/server/corporate";
import { CouponError } from "@/server/coupons";
import { TransitionError } from "@/server/transitions";
import { ApprovalError } from "@/server/approvals";

/**
 * Mobile API (/api/v1) response envelope and error mapping.
 *
 *   success: `{ data, meta? }`            (meta carries pagination: `{ nextCursor }`)
 *   failure: `{ error: { code, message, fields? } }`
 *
 * Money is integer paisa, timestamps ISO-8601 UTC, Kathmandu service dates `YYYY-MM-DD`.
 */

export type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string> } };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const unauthorized = (message = "Sign in first") => new ApiError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You don't have permission to do that", code = "FORBIDDEN") => new ApiError(403, code, message);
export const notFound = (message = "Not found") => new ApiError(404, "NOT_FOUND", message);
export const badRequest = (message: string, fields?: Record<string, string>, code = "BAD_REQUEST") => new ApiError(400, code, message, fields);
export const conflict = (message: string, code = "CONFLICT") => new ApiError(409, code, message);
export const tooMany = (message = "Too many requests — wait a minute and try again") => new ApiError(429, "RATE_LIMITED", message);

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...headers } });
}

/** `{ data }` (+ optional meta). */
export function ok<T>(data: T, opts: { status?: number; meta?: Record<string, unknown>; headers?: Record<string, string> } = {}) {
  return json(opts.meta ? { data, meta: opts.meta } : { data }, opts.status ?? 200, opts.headers);
}

export const created = <T>(data: T) => ok(data, { status: 201 });

export function errorResponse(status: number, code: string, message: string, fields?: Record<string, string>) {
  const body: ErrorBody = { error: { code, message, ...(fields ? { fields } : {}) } };
  return json(body, status);
}

/**
 * Domain errors the services throw with a customer-safe message (same set the web actions show as-is).
 * Matched with instanceof (class names are minified in production builds).
 */
const DOMAIN_ERRORS: [new (...a: never[]) => Error, string, number][] = [
  [CorporateForbidden, "FORBIDDEN", 403],
  [OrderError, "ORDER_REJECTED", 422],
  [PaymentError, "PAYMENT_REJECTED", 422],
  [CapacityError, "CAPACITY_REJECTED", 422],
  [CrmError, "ACCOUNT_REJECTED", 422],
  [TopupError, "TOPUP_REJECTED", 422],
  [HandoffLockedError, "HANDOFF_LOCKED", 423], // before DispatchError (subclass)
  [DispatchError, "DISPATCH_REJECTED", 422],
  [KitchenError, "KITCHEN_REJECTED", 422],
  [CoverageError, "COVERAGE_REJECTED", 422],
  [PinError, "INVALID_PIN", 422],
  [MarketingError, "REFERRAL_REJECTED", 422],
  [InventoryError, "INVENTORY_REJECTED", 422],
  [CorporateError, "CORPORATE_REJECTED", 422],
  [CouponError, "COUPON_REJECTED", 422],
  [TransitionError, "TRANSITION_REJECTED", 409],
  [ApprovalError, "APPROVAL_REJECTED", 422],
];

function zodFields(e: ZodError) {
  const fields: Record<string, string> = {};
  for (const i of e.issues) fields[i.path.join(".") || "_"] ??= i.message;
  return fields;
}

/** Map anything thrown inside a handler to the error envelope. Unknown errors are logged and hidden. */
export function toErrorResponse(e: unknown): Response {
  if (e instanceof ApiError) return errorResponse(e.status, e.code, e.message, e.fields);
  if (e instanceof ZodError) return errorResponse(422, "VALIDATION_FAILED", e.issues[0]?.message ?? "Check the highlighted fields", zodFields(e));
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return errorResponse(404, "NOT_FOUND", "Not found");
  if (e instanceof Error) {
    for (const [cls, code, status] of DOMAIN_ERRORS) if (e instanceof cls) return errorResponse(status, code, e.message);
    // Same rule as the web actions: a short, non-database message from a service is meant for the user.
    if (e.constructor === Error && e.message && e.message.length < 200 && !/prisma|invocation|ECONN|timeout/i.test(e.message)) {
      return errorResponse(422, "REQUEST_REJECTED", e.message);
    }
  }
  log.error("api.unhandled", { error: e });
  return errorResponse(500, "INTERNAL", "Something went wrong — please try again");
}

// ───────────── input ─────────────

/** Parse + validate a JSON body. Empty body → `{}` so all-optional schemas work. */
export async function readJson<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw badRequest("The request body isn't valid JSON", undefined, "INVALID_JSON");
    }
  }
  return schema.parse(raw);
}

/** Validate query parameters (strings) with a zod schema. */
export function readQuery<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): T {
  const q = Object.fromEntries(new URL(req.url).searchParams.entries());
  return schema.parse(q);
}

// ───────────── output helpers ─────────────

/** Kathmandu service date (stored as a UTC-midnight DATE) → "YYYY-MM-DD". */
export const ymd = (d: Date | null | undefined) => (d ? isoDate(d) : null);
/** Timestamp → ISO string. */
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// ───────────── pagination ─────────────

export type Page = { limit: number; cursor: string | null };

export function readPage(req: Request, max = 50, dflt = 20): Page {
  const sp = new URL(req.url).searchParams;
  const n = parseInt(sp.get("limit") ?? "", 10);
  const cursor = sp.get("cursor");
  return { limit: Number.isFinite(n) && n > 0 ? Math.min(n, max) : dflt, cursor: cursor && /^[A-Za-z0-9_-]{1,64}$/.test(cursor) ? cursor : null };
}

/**
 * Cursor pagination over a Prisma model ordered by (createdAt desc, id desc). Pass `findMany` args builder;
 * returns rows + `nextCursor` (the id of the last row when there are more).
 */
export async function paginate<T extends { id: string }>(page: Page, fetch: (args: { take: number; skip?: number; cursor?: { id: string } }) => Promise<T[]>) {
  const rows = await fetch({ take: page.limit + 1, ...(page.cursor ? { skip: 1, cursor: { id: page.cursor } } : {}) });
  const more = rows.length > page.limit;
  const items = more ? rows.slice(0, page.limit) : rows;
  return { items, nextCursor: more ? items[items.length - 1]!.id : null };
}
