import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Static security guard (WP-20). Every exported server action and route handler must check the caller on the server.
 *
 * Server actions ("use server" files): each exported function must call a guard directly, or call a local helper
 * that does (transitively). Which guards count depends on where the file lives:
 *   - src/app/admin/**   → a permission check: requirePermission / requireAnyPermission / requireSuperAdmin / guarded
 *   - src/app/team/**    → requireCompanyAdmin (scopes every query to the admin's own company)
 *   - src/app/rider/**   → requirePermission (rider.edit; the service checks the stop is on the rider's route)
 *   - everything else    → any of the above, or requireUser / getCurrentUser / requireStaff
 * Route handlers (route.ts): each exported GET/POST/… must call one of the guards above, or verify a secret
 * (CRON_SECRET), or be listed as intentionally public below.
 *
 * This proves a guard is present, not that it is the right permission or that the record is scoped to the caller;
 * scoping is covered by the IDOR integration tests (tests/integration/acceptance.test.ts and the per-package tests).
 */

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

/** Intentionally public server actions (validated + rate-limited inside, or pre-auth by nature). */
const PUBLIC_ACTIONS: Record<string, string[]> = {
  "src/lib/actions/public.ts": ["setLocaleAction", "leadAction", "contactAction", "areaRequestAction", "subscribeAction"], // honeypot + per-IP limit
  "src/lib/actions/auth.ts": ["loginAction", "verifyTwoFactorAction", "sendOtpAction", "verifyOtpAction", "registerAction", "logoutAction", "forgotAction", "resetAction"], // Better Auth rate limits
  "src/lib/actions/build.ts": ["quoteBuildAction"], // price preview only; ordering re-quotes on the server
  "src/app/setup/actions.ts": ["setupAction"], // SETUP_KEY (constant time) + refuses once a super admin exists
  "src/app/admin/_kit/session.ts": ["signOutAction"],
};

/** Admin kit actions that only need a staff session: search filters every hit by permission; saved views are per-user. */
const STAFF_SESSION_ACTIONS: Record<string, string[]> = {
  "src/app/admin/_kit/actions.ts": ["adminSearchAction", "listViewsAction", "saveViewAction", "deleteViewAction"],
};

/** Intentionally public route handlers. */
const PUBLIC_ROUTES: Record<string, string> = {
  "src/app/api/health/route.ts": "booleans only",
  "src/app/api/consent/route.ts": "sets the visitor's own consent cookie; same-origin check",
  "src/app/api/auth/[...all]/route.ts": "Better Auth handler (its own rate limits / origin checks)",
  "src/app/api/payments/esewa/return/[id]/route.ts": "gateway return: signature + server-side status lookup + amount match before anything changes",
  "src/app/api/payments/khalti/return/[id]/route.ts": "gateway return: server-side lookup + amount match before anything changes",
};

const PERMISSION = ["requirePermission", "requireAnyPermission", "requireSuperAdmin", "guarded"];
const ANY_USER = [...PERMISSION, "requireCompanyAdmin", "requireUser", "getCurrentUser", "requireStaff"];

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const callRe = (names: string[]) => new RegExp(`\\b(${names.join("|")})\\s*[(<]`);

function guardsFor(file: string) {
  if (file.startsWith("src/app/admin/")) return PERMISSION;
  if (file.startsWith("src/app/team/")) return ["requireCompanyAdmin"];
  if (file.startsWith("src/app/rider/")) return ["requirePermission"];
  return ANY_USER;
}

/** Top-level functions of a module: name → { exported, text }. */
function topLevelFunctions(file: string, source: string) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const fns = new Map<string, { exported: boolean; text: string }>();
  const isExported = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name) fns.set(n.name.text, { exported: isExported(n), text: n.getText() });
    if (ts.isVariableStatement(n))
      for (const d of n.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)))
          fns.set(d.name.text, { exported: isExported(n), text: d.initializer.getText() });
  });
  return fns;
}

/** Names whose body (transitively through local helpers) calls one of `guards`. */
function guardedNames(fns: Map<string, { text: string }>, guards: string[]) {
  const ok = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, { text }] of fns) {
      if (ok.has(name)) continue;
      if (callRe([...guards, ...ok]).test(text)) {
        ok.add(name);
        changed = true;
      }
    }
  }
  return ok;
}

const files = walk(SRC);
const serverActionFiles = files.filter((f) => /^\s*(\/\/.*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(readFileSync(f, "utf8")));
const routeFiles = files.filter((f) => /\/route\.ts$/.test(f));

describe("server action guards", () => {
  it("finds the server action files", () => {
    expect(serverActionFiles.length).toBeGreaterThan(40);
  });

  it("every exported server action checks the caller", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const abs of serverActionFiles) {
      const file = rel(abs);
      const fns = topLevelFunctions(file, readFileSync(abs, "utf8"));
      const staffOnly = STAFF_SESSION_ACTIONS[file] ?? [];
      const ok = guardedNames(fns, guardsFor(file));
      for (const [name, { exported }] of fns) {
        if (!exported) continue;
        checked++;
        if (ok.has(name) || (PUBLIC_ACTIONS[file] ?? []).includes(name)) continue;
        if (staffOnly.includes(name) && /isStaffRole\(/.test(readFileSync(abs, "utf8"))) continue;
        missing.push(`${file} → ${name}`);
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(missing, `Exported server actions without a server-side guard:\n${missing.join("\n")}`).toEqual([]);
  });

  it("the public allow-list has no stale entries", () => {
    for (const [file, names] of Object.entries({ ...PUBLIC_ACTIONS, ...STAFF_SESSION_ACTIONS })) {
      const fns = topLevelFunctions(file, readFileSync(path.join(ROOT, file), "utf8"));
      for (const n of names) expect(fns.get(n)?.exported, `${file} → ${n}`).toBe(true);
    }
  });
});

describe("route handler guards", () => {
  it("every route handler checks the caller, a secret, or is listed as public", () => {
    const missing: string[] = [];
    for (const abs of routeFiles) {
      const file = rel(abs);
      if (PUBLIC_ROUTES[file]) continue;
      const fns = topLevelFunctions(file, readFileSync(abs, "utf8"));
      // a local helper that compares CRON_SECRET counts as a guard
      const secretHelpers = [...fns].filter(([, f]) => /CRON_SECRET/.test(f.text)).map(([n]) => n);
      const ok = guardedNames(fns, [...ANY_USER, ...secretHelpers]);
      for (const [name, { exported }] of fns) {
        if (!exported || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(name)) continue;
        if (ok.has(name)) continue;
        missing.push(`${file} → ${name}`);
      }
    }
    expect(missing, `Route handlers without a guard:\n${missing.join("\n")}`).toEqual([]);
  });

  it("admin routes check a permission, not just a session", () => {
    const loose: string[] = [];
    for (const abs of routeFiles.filter((f) => /\/(admin)\//.test(rel(f)))) {
      const src = readFileSync(abs, "utf8");
      // requireStaff alone isn't enough: the handler (or the service it calls) must check a specific permission.
      const checksPermission = /\bcan\s*\(|assert\w*Access\s*\(|requirePermission\s*\(|export\w*\s*\(\s*user\b|\w+\(\s*user\s*,/.test(src);
      if (!checksPermission) loose.push(rel(abs));
    }
    expect(loose).toEqual([]);
  });
});
