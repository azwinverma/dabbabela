/**
 * Helpers for calling /api/v1 route handlers directly in vitest (no HTTP server): build a Request, pass params the
 * way Next does (`{ params: Promise<…> }`), parse the JSON envelope.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export type CallOpts = {
  token?: string | null;
  body?: unknown;
  /** multipart body instead of JSON */
  form?: FormData;
  params?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  idem?: string;
  ip?: string;
};

export type CallResult<T = any> = { status: number; body: { data?: T; meta?: any; error?: { code: string; message: string; fields?: Record<string, string> } }; headers: Headers };

export async function call<T = any>(handler: unknown, method: string, path: string, o: CallOpts = {}): Promise<CallResult<T>> {
  const url = new URL(`http://localhost:3100/api/v1${path}`);
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers = new Headers(o.headers ?? {});
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
  if (o.idem) headers.set("idempotency-key", o.idem);
  headers.set("x-forwarded-for", o.ip ?? "198.51.100.10");
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers.set("content-type", "application/json");
  }
  const res = await (handler as Handler)(new Request(url, { method, headers, body }), { params: Promise.resolve(o.params ?? {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {}, headers: res.headers };
}

/** Sign in through POST /api/v1/auth/sign-in and return the bearer token. */
export async function bearerFor(email: string, password: string): Promise<string> {
  const { POST } = await import("@/app/api/v1/auth/sign-in/route");
  const r = await call<{ token: string }>(POST, "POST", "/auth/sign-in", { body: { email, password } });
  if (r.status !== 200 || !r.body.data?.token) throw new Error(`sign-in failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.token;
}

export const idem = (p = "k") => `${p}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
