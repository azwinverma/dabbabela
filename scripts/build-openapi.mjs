// Build the mobile API spec.
//   node scripts/build-openapi.mjs            docs/api/openapi.yaml → src/server/api/openapi.generated.json
//   node scripts/build-openapi.mjs --merge    first merge docs/api/fragments/*.yaml (base.yaml first) into docs/api/openapi.yaml
// tests/unit/api-guards.test.ts fails when the JSON is stale or a v1 route is missing from the spec.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const specPath = path.join(root, "docs/api/openapi.yaml");
const outPath = path.join(root, "src/server/api/openapi.generated.json");

if (process.argv.includes("--merge")) {
  const dir = path.join(root, "docs/api/fragments");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort((a, b) => (a === "base.yaml" ? -1 : b === "base.yaml" ? 1 : a.localeCompare(b)));
  let spec = null;
  for (const f of files) {
    const doc = yaml.load(readFileSync(path.join(dir, f), "utf8"));
    if (!spec) { spec = doc; continue; }
    for (const [p, ops] of Object.entries(doc.paths ?? {})) {
      if (spec.paths[p]) throw new Error(`duplicate path ${p} in ${f}`);
      spec.paths[p] = ops;
    }
    for (const [kind, entries] of Object.entries(doc.components ?? {})) {
      spec.components[kind] ??= {};
      for (const [k, v] of Object.entries(entries)) {
        if (spec.components[kind][k]) throw new Error(`duplicate component ${kind}.${k} in ${f}`);
        spec.components[kind][k] = v;
      }
    }
  }
  const header = "# Dabba Bela mobile API — OpenAPI 3.1. Edit this file, then run `npm run api:spec` to refresh the JSON served at /api/v1/openapi.json.\n";
  writeFileSync(specPath, header + yaml.dump(spec, { lineWidth: 140, noRefs: true }));
}

if (!existsSync(specPath)) throw new Error("docs/api/openapi.yaml missing");
const spec = yaml.load(readFileSync(specPath, "utf8"));
writeFileSync(outPath, JSON.stringify(spec) + "\n");
console.log(`openapi: ${Object.keys(spec.paths).length} paths → ${path.relative(root, outPath)}`);
