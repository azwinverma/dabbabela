import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

/**
 * Phase 3 guard for the mobile API. Every /api/v1 handler must be built with `apiRoute({ auth: … }, fn)`:
 *   - the auth spec must be a literal ("public" | "optional" | "user" | { permission: … });
 *   - "public"/"optional" handlers must be allow-listed below with the reason;
 *   - a handler built any other way (plain `export function GET`, or a const not made by apiRoute) fails, because
 *     tests/unit/action-guards.test.ts can't see guards inside `export const X = …` handlers;
 *   - every handler without a public spec must answer 401 when called with no token (runtime sweep);
 *   - every handler must be documented in docs/api/openapi.yaml, and the served JSON must match the YAML.
 */

const ROOT = path.resolve(__dirname, "../..");
const V1 = path.join(ROOT, "src/app/api/v1");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Intentionally anonymous v1 handlers (file → methods, reason). */
const PUBLIC: Record<string, { methods: string[]; why: string }> = {
  "auth/sign-in": { methods: ["POST"], why: "sign-in itself; per-IP + per-email rate limit" },
  "auth/sign-up": { methods: ["POST"], why: "account creation; per-IP rate limit" },
  "auth/two-factor/verify": { methods: ["POST"], why: "second sign-in step; single-use challenge + rate limit" },
  "auth/otp/send": { methods: ["POST"], why: "SMS sign-in; flag-gated, per-IP + per-phone limit" },
  "auth/otp/verify": { methods: ["POST"], why: "SMS sign-in; flag-gated, per-IP + per-phone limit" },
  "auth/password/forgot": { methods: ["POST"], why: "reset link; no enumeration, rate limited" },
  "auth/password/reset": { methods: ["POST"], why: "token from the reset email; rate limited" },
  settings: { methods: ["GET"], why: "published brand/ordering settings" },
  menu: { methods: ["GET"], why: "public menu; token only narrows to the company menu" },
  "boxes/[slug]": { methods: ["GET"], why: "public dabba page data" },
  plans: { methods: ["GET"], why: "public plan list" },
  "plans/[slug]": { methods: ["GET"], why: "public plan page data" },
  coverage: { methods: ["GET"], why: "public coverage lookup" },
  allergens: { methods: ["GET"], why: "public allergen list" },
  builder: { methods: ["GET"], why: "public Build-a-Dabba catalogue; token only adds the company note" },
  "builder/quote": { methods: ["POST"], why: "price preview only (no writes); ordering/saving re-prices with a session" },
  "openapi.json": { methods: ["GET"], why: "the API spec" },
};

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

const routeFiles = walk(V1);
const keyOf = (abs: string) => path.relative(V1, path.dirname(abs)).split(path.sep).join("/");

type Found = { method: string; viaApiRoute: boolean; auth: string | null };

function handlers(abs: string): Found[] {
  const sf = ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
  const out: Found[] = [];
  const exported = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name && exported(n) && (METHODS as readonly string[]).includes(n.name.text)) out.push({ method: n.name.text, viaApiRoute: false, auth: null });
    if (ts.isVariableStatement(n) && exported(n))
      for (const d of n.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !(METHODS as readonly string[]).includes(d.name.text)) continue;
        const init = d.initializer;
        let auth: string | null = null;
        let via = false;
        if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "apiRoute") {
          via = true;
          const opts = init.arguments[0];
          if (opts && ts.isObjectLiteralExpression(opts)) {
            const a = opts.properties.find((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "auth") as ts.PropertyAssignment | undefined;
            if (a) auth = ts.isStringLiteral(a.initializer) ? a.initializer.text : ts.isObjectLiteralExpression(a.initializer) && a.initializer.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "permission") ? "permission" : "?";
          }
        }
        out.push({ method: d.name.text, viaApiRoute: via, auth });
      }
  });
  return out;
}

describe("api/v1 handler guards", () => {
  it("finds the v1 routes", () => {
    expect(routeFiles.length).toBeGreaterThan(80);
  });

  it("every v1 handler is apiRoute({ auth }) and public ones are allow-listed", () => {
    const problems: string[] = [];
    for (const abs of routeFiles) {
      const key = keyOf(abs);
      const hs = handlers(abs);
      if (!hs.length) problems.push(`${key}: no handlers found`);
      for (const h of hs) {
        if (!h.viaApiRoute) problems.push(`${key} ${h.method}: not built with apiRoute()`);
        else if (!h.auth || h.auth === "?") problems.push(`${key} ${h.method}: auth must be "public" | "optional" | "user" | { permission }`);
        else if ((h.auth === "public" || h.auth === "optional") && !PUBLIC[key]?.methods.includes(h.method)) problems.push(`${key} ${h.method}: auth "${h.auth}" but not in the PUBLIC allow-list`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("the public allow-list has no stale entries", () => {
    for (const [key, { methods }] of Object.entries(PUBLIC)) {
      const abs = path.join(V1, key, "route.ts");
      const hs = handlers(abs);
      for (const m of methods) expect(hs.find((h) => h.method === m)?.auth, `${key} ${m}`).toMatch(/public|optional/);
    }
  });

  it("no route handler anywhere in src/app hides behind `export const` without apiRoute", () => {
    const all = walk(path.join(ROOT, "src/app"));
    const bad = all.flatMap((abs) => handlers(abs).filter((h) => !h.viaApiRoute && /export const (GET|POST|PUT|PATCH|DELETE)\b/.test(readFileSync(abs, "utf8"))).map((h) => `${path.relative(ROOT, abs)} ${h.method}`));
    expect(bad).toEqual([]);
  });

  it("every protected v1 handler answers 401 without a token", async () => {
    const leaks: string[] = [];
    for (const abs of routeFiles) {
      const key = keyOf(abs);
      const mod = (await import(abs)) as Record<string, (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>;
      for (const h of handlers(abs)) {
        if (h.auth === "public" || h.auth === "optional") continue;
        const params = Object.fromEntries([...key.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], "x-not-a-real-id"]));
        const url = `http://localhost:3100/api/v1/${key.replace(/\[(\w+)\]/g, "x-not-a-real-id")}`;
        const res = await mod[h.method]!(new Request(url, { method: h.method, headers: { "content-type": "application/json", "idempotency-key": "guard-test-key-1" }, body: h.method === "GET" ? undefined : "{}" }), { params: Promise.resolve(params) });
        if (res.status !== 401) leaks.push(`${key} ${h.method} → ${res.status}`);
        const body = (await res.json()) as { error?: { code?: string } };
        if (body.error?.code !== "UNAUTHENTICATED") leaks.push(`${key} ${h.method} → ${JSON.stringify(body)}`);
      }
    }
    expect(leaks).toEqual([]);
  }, 120_000);
});

describe("OpenAPI spec", () => {
  const spec = yaml.load(readFileSync(path.join(ROOT, "docs/api/openapi.yaml"), "utf8")) as { openapi: string; paths: Record<string, Record<string, unknown>> };

  it("is OpenAPI 3.1 and the served JSON is up to date (npm run api:spec)", () => {
    expect(spec.openapi).toBe("3.1.0");
    const served = JSON.parse(readFileSync(path.join(ROOT, "src/server/api/openapi.generated.json"), "utf8"));
    expect(served).toEqual(spec);
  });

  it("documents every v1 handler, and nothing that doesn't exist", () => {
    const missing: string[] = [];
    const routes = new Set<string>();
    for (const abs of routeFiles) {
      const p = `/${keyOf(abs).replace(/\[(\w+)\]/g, "{$1}")}`;
      for (const h of handlers(abs)) {
        routes.add(`${h.method} ${p}`);
        if (!spec.paths[p]?.[h.method.toLowerCase()]) missing.push(`${h.method} ${p}`);
      }
    }
    const extra: string[] = [];
    for (const [p, ops] of Object.entries(spec.paths)) for (const m of Object.keys(ops)) if (METHODS.includes(m.toUpperCase() as (typeof METHODS)[number]) && !routes.has(`${m.toUpperCase()} ${p}`)) extra.push(`${m.toUpperCase()} ${p}`);
    expect(missing, "handlers missing from docs/api/openapi.yaml").toEqual([]);
    expect(extra, "spec paths without a handler").toEqual([]);
  });

  it("every $ref resolves", () => {
    const text = JSON.stringify(spec);
    const refs = [...text.matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1]!);
    const bad = refs.filter((r) => r.split("/").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), spec) === undefined);
    expect([...new Set(bad)]).toEqual([]);
  });
});
