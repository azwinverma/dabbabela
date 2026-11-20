import { apiRoute } from "@/server/api/route";
import { assertOwnPayment } from "@/server/api/customer-dto";
import { apiOrigin } from "@/server/api/dto";
import { startPayment } from "@/server/payments";

export const dynamic = "force-dynamic";

/**
 * Start (or restart) the gateway checkout for one of the caller's payments. Open the result in an in-app browser:
 *  - `kind: "esewa"` → auto-submit an HTML form: POST `action` with `fields` (eSewa needs a form POST);
 *  - `kind: "khalti"` → open `url`;
 *  - `kind: "manual"` → bank transfer / cash: no browser — show bank details and POST /payments/{id}/proof;
 *  - `kind: "done"` → already paid.
 * The gateway redirects back to the website; close the browser when it navigates to any of `returnUrlPrefixes`, then
 * poll GET /payments/{id} (the server verifies with the gateway — the redirect itself proves nothing).
 */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", limit: "payStart" }, async ({ req, user, params }) => {
  await assertOwnPayment(user.id, params.id);
  const origin = apiOrigin(req);
  const start = await startPayment(params.id, user.id, origin);
  const returnUrlPrefixes = [`${origin}/thank-you/`, `${origin}/pay/`, `${origin}/account/wallet/topup/`];
  if (start.kind === "esewa") return { kind: "esewa", method: "POST", action: start.action, fields: start.fields, url: null, returnUrlPrefixes };
  if (start.kind === "khalti") return { kind: "khalti", method: "GET", action: null, fields: null, url: start.url, returnUrlPrefixes };
  return { kind: start.kind, method: null, action: null, fields: null, url: null, returnUrlPrefixes };
});
