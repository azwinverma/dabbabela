import { apiRoute } from "@/server/api/route";
import spec from "@/server/api/openapi.generated.json";

export const dynamic = "force-dynamic";

/** The OpenAPI 3.1 document for /api/v1 (source: docs/api/openapi.yaml; `npm run api:spec` regenerates the JSON). */
export const GET = apiRoute({ auth: "public" }, async () =>
  new Response(JSON.stringify(spec), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" } }),
);
