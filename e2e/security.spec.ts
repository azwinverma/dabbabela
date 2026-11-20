import { expect, test, type Page } from "@playwright/test";
import { acceptDialogs, login, OWNER, watchErrors } from "./helpers";
import { db } from "./db";

/**
 * Phase 2B: nonce-based CSP produces no violations on the main pages, and the maker-checker approvals queue works
 * end to end (a request above the threshold waits for a second staff member, who approves it from /admin/approvals).
 */

/** Collect CSP violations (event + console) on a page. */
function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to (execute|load|apply|connect|frame)/i.test(m.text())) violations.push(m.text());
  });
  void page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return async () => {
    const fromEvents = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    expect([...violations, ...fromEvents], [...violations, ...fromEvents].join("\n")).toEqual([]);
  };
}

async function visit(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBeLessThan(400);
  const csp = res!.headers()["content-security-policy"] ?? "";
  expect(csp, path).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  const nonce = /'nonce-([^']+)'/.exec(csp)![1];
  // hydration worked (interactive page) and Next's scripts carry this response's nonce
  await page.waitForLoadState("networkidle");
  const scripts = await page.locator("script:not([type='application/ld+json'])").evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
  expect(scripts.length, path).toBeGreaterThan(0);
  expect(scripts.every((n) => n === nonce), `${path}: every script has the nonce`).toBe(true);
}

test("nonce CSP: no violations on public, checkout, login, admin and rider pages", async ({ browser }) => {
  const anon = await (await browser.newContext()).newPage();
  const anonCsp = watchCsp(anon);
  for (const p of ["/", "/menu", "/login", "/register", "/contact", "/corporate"]) await visit(anon, p);
  // client-side navigation still works under the policy
  await anon.goto("/");
  await anon.locator('a[href="/menu"]').first().click();
  await anon.waitForURL(/\/menu/);
  await anonCsp();
  await anon.context().close();

  const customer = await (await browser.newContext()).newPage();
  const customerCsp = watchCsp(customer);
  await login(customer, "customer.b@demo.dabbabela.local");
  for (const p of ["/checkout", "/account", "/account/security"]) await visit(customer, p);
  await expect(customer.getByRole("heading", { name: "Recent sign-ins" })).toBeVisible();
  await customerCsp();
  await customer.context().close();

  const owner = await (await browser.newContext()).newPage();
  const ownerCsp = watchCsp(owner);
  await login(owner, OWNER.email, OWNER.password, "/admin");
  for (const p of ["/admin", "/admin/orders", "/admin/approvals"]) await visit(owner, p);
  await ownerCsp();
  await owner.context().close();

  const rider = await (await browser.newContext()).newPage();
  const riderCsp = watchCsp(rider);
  await login(rider, "rider@demo.dabbabela.local", undefined, "/rider");
  await visit(rider, "/rider");
  await riderCsp();
  await rider.context().close();
});

test("maker-checker: a large wallet adjustment waits for a second person, who approves it", async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const customerEmail = "customer.d@demo.dabbabela.local";
  const customer = await db().user.findUniqueOrThrow({ where: { email: customerEmail } });
  const before = (await db().creditLedger.aggregate({ _sum: { amount: true }, where: { userId: customer.id } }))._sum.amount ?? 0;
  const note = `E2E big goodwill ${stamp}`;

  // finance (maker) asks for Rs 2,500 — at/above the default Rs 2,000 threshold
  const finance = await (await browser.newContext()).newPage();
  const financeErrors = watchErrors(finance);
  acceptDialogs(finance);
  await login(finance, "finance@demo.dabbabela.local", undefined, "/admin");
  await finance.goto(`/admin/refunds?view=ledger&q=${encodeURIComponent(customerEmail)}`);
  const fm = finance.locator("main");
  await fm.getByLabel("Amount").fill("+2500");
  await fm.getByLabel("Reason").fill(note);
  await fm.getByRole("button", { name: "Adjust credit" }).click();
  await expect.poll(async () => (await db().approvalRequest.findFirst({ where: { reason: note } }))?.status).toBe("PENDING");
  const req = await db().approvalRequest.findFirstOrThrow({ where: { reason: note } });
  expect(req.amount).toBe(250000);
  // nothing moved yet
  expect((await db().creditLedger.aggregate({ _sum: { amount: true }, where: { userId: customer.id } }))._sum.amount ?? 0).toBe(before);

  // the maker sees it but can't decide it
  await finance.goto(`/admin/approvals/${req.id}`);
  await expect(fm.getByText("Someone else has to approve or reject this")).toBeVisible();
  await expect(fm.getByRole("button", { name: /approve/i })).toHaveCount(0);
  financeErrors();
  await finance.context().close();

  // owner (checker) finds it in the queue (sidebar badge) and approves with a note
  const owner = await (await browser.newContext()).newPage();
  const ownerErrors = watchErrors(owner);
  acceptDialogs(owner);
  await login(owner, OWNER.email, OWNER.password, "/admin");
  await owner.goto("/admin/approvals");
  const om = owner.locator("main");
  await expect(owner.locator('nav a[href="/admin/approvals"]')).toBeVisible();
  await om.getByRole("link", { name: /Wallet credit Rs/ }).first().waitFor();
  await owner.goto(`/admin/approvals/${req.id}`);
  await expect(om.getByText("Wallet balance")).toBeVisible();
  await om.getByLabel("Note (optional)").fill("Checked with the customer");
  await om.getByRole("button", { name: /approve & execute/i }).click();
  await expect.poll(async () => (await db().approvalRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("EXECUTED");
  const after = (await db().creditLedger.aggregate({ _sum: { amount: true }, where: { userId: customer.id } }))._sum.amount ?? 0;
  expect(after - before).toBe(250000);
  const done = await db().approvalRequest.findUniqueOrThrow({ where: { id: req.id } });
  expect(done.decidedById).not.toBe(done.requestedById);
  ownerErrors();
  await owner.context().close();
});
