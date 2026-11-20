import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Prisma } from "@prisma/client";
import { acceptDialogs, login, OWNER, watchErrors } from "./helpers";
import { dateOnly, db, todayKtm } from "./db";

/**
 * WP-20 acceptance (brief §26): one end-to-end flow through the real UI.
 *
 * DB shortcuts (each one is something the existing specs already do, or that only time would otherwise do):
 *  - the plan meal is moved to today ("the delivery day arrives"), because the kitchen, dispatch and rider screens work
 *    on today's date (fulfilment.spec does the same);
 *  - today's DayLock row for the kitchen is removed before the kitchen locks the day through the UI, so earlier runs on
 *    the same day don't leave our meal un-confirmed (the real cut-off happens once a day);
 *  - assertions read the database directly, and `finally` puts shared demo rows back (the CMS block, the plan price).
 * Reruns are safe: the dish, dabba and route names carry a unique stamp; the week menu for next week is re-published
 * each run (publishing archives the previous one); the plan is cancelled at the end.
 */

const CUSTOMER = "customer.c@demo.dabbabela.local";
const CMS_KEY = "home.cta";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Sunday-start week, like src/lib/dates weekStartOf. */
const weekStartOf = (iso: string) => addDays(iso, -new Date(`${iso}T00:00:00.000Z`).getUTCDay());

async function pageFor(browser: Browser, email: string, password: string | undefined, next: string) {
  const page = await (await browser.newContext()).newPage();
  acceptDialogs(page);
  await login(page, email, password, next);
  return page;
}

test("acceptance: dish → menu → plan → kitchen → stock → dispatch → OTP delivery → reports → audit → CMS → access → price history", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const stamp = Date.now().toString(36);
  const dishName = `Acceptance dal ${stamp}`;
  const boxName = `Acceptance dabba ${stamp}`;
  const routeName = `Acceptance route ${stamp}`;
  const today = todayKtm();
  const nextWeek = addDays(weekStartOf(today), 7);
  const menuDay = addDays(nextWeek, 2); // Tuesday of next week
  const BOX_PRICE = 26000; // Rs 260
  const kitchen = await db().kitchen.findFirstOrThrow({ where: { code: "KTM-1" } });
  const rice = await db().ingredient.findFirstOrThrow({ where: { name: "Rice (sona mansuli)" } });
  const hapta = await db().mealPlan.findUniqueOrThrow({ where: { slug: "hapta" } });
  const planPriceBefore = { pricePerMeal: hapta.pricePerMeal, compareAtPrice: hapta.compareAtPrice };
  const cmsBefore = await db().contentSection.findUnique({ where: { key_locale: { key: CMS_KEY, locale: "en" } } });

  const admin = await pageFor(browser, OWNER.email, OWNER.password, "/admin");
  const adminErrors = watchErrors(admin);
  let subscriptionId: string | null = null;

  try {
    // ── 1 · super admin creates a dish (with a recipe) and a dabba, and publishes it on next week's menu ──
    const { dishId, boxId, menuId } = await test.step("1 create dish + dabba, publish on next week's menu", async () => {
      await admin.goto("/admin/dishes/new");
      const main = admin.locator("main");
      await main.getByLabel("Name (English)").fill(dishName);
      await main.getByLabel("Kitchen station").fill("Acceptance");
      await main.getByRole("button", { name: "Create dish" }).click();
      await admin.waitForURL(/\/admin\/dishes\/(?!new)[a-z0-9]+$/);
      const dish = await db().menuItem.findFirstOrThrow({ where: { name: dishName } });
      // recipe: 1 kg rice for 10 portions → 0.1 kg per portion
      await main.getByLabel("Ingredient 1").selectOption(rice.id);
      await main.getByLabel("Quantity 1").fill("1");
      await main.getByRole("button", { name: "Save as new version" }).click();
      await expect.poll(async () => (await db().recipe.findUnique({ where: { menuItemId: dish.id } }))?.currentVersionId ?? null).not.toBeNull();

      await admin.goto("/admin/boxes/new");
      await main.getByLabel("Dish to add").selectOption(dish.id);
      await main.getByRole("button", { name: "Add", exact: true }).click();
      await main.getByLabel("Name", { exact: true }).fill(boxName);
      await main.getByLabel("Price (Rs)").fill(String(BOX_PRICE / 100));
      await main.getByRole("button", { name: "Create dabba" }).click();
      await admin.waitForURL(/\/admin\/boxes\/(?!new)[a-z0-9]+$/);
      const box = await db().lunchBox.findFirstOrThrow({ where: { name: boxName }, include: { items: true } });
      expect(box.price).toBe(BOX_PRICE);
      expect(box.items.map((i) => i.menuItemId)).toEqual([dish.id]);

      // next week's own menu, copied from the standing rotation, with the new dabba added on Tuesday
      await admin.goto("/admin/weekly-menus");
      const plan = main.locator("form").filter({ has: admin.getByRole("button", { name: "Create draft" }) });
      await plan.getByLabel("Any date in the week").fill(menuDay);
      await plan.getByRole("button", { name: "Create draft" }).click();
      await admin.waitForURL(/\/admin\/weekly-menus\/[a-z0-9]+$/);
      const id = admin.url().split("/").pop()!;
      await main.getByLabel("Add a dabba on Tuesday").selectOption(box.id);
      await main.getByRole("button", { name: "Save menu" }).click();
      await expect(main.getByText("Draft saved")).toBeVisible();
      await main.getByRole("button", { name: "Publish now" }).click();
      await expect.poll(async () => (await db().weeklyMenu.findUniqueOrThrow({ where: { id } })).status).toBe("PUBLISHED");
      const tue = await db().menuDay.findFirstOrThrow({ where: { menuId: id, day: "TUE" }, include: { items: true } });
      expect(tue.items.some((i) => i.boxId === box.id)).toBe(true);
      return { dishId: dish.id, boxId: box.id, menuId: id };
    });

    // ── 2 · it appears on the public menu ──
    const box = await db().lunchBox.findUniqueOrThrow({ where: { id: boxId } });
    await test.step("2 appears on the public /menu", async () => {
      const visitor = await (await browser.newContext()).newPage();
      await visitor.goto(`/menu?week=${nextWeek}`);
      await expect(visitor.getByText(boxName).first()).toBeVisible();
      await visitor.goto(`/boxes/${box.slug}`);
      await expect(visitor.locator("h1")).toContainText(boxName);
      await visitor.context().close();
    });

    // ── 3–6 · customer picks it in a weekly plan; the server prices it; cash checkout; states recorded ──
    const customer = await pageFor(browser, CUSTOMER, undefined, "/account");
    const customerErrors = watchErrors(customer);
    const { paymentId, orderId, orderNumber, orderCode } = await test.step("3–6 plan pick, server price, checkout, states", async () => {
      await customer.goto("/plans/hapta");
      const start = customer.getByRole("combobox").first(); // "Start" select
      const starts = await start.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
      const startDate = starts.find((d) => d >= nextWeek && d <= menuDay) ?? starts.find((d) => d <= menuDay);
      expect(startDate, `a plan start on or before ${menuDay} (offered: ${starts.join(", ")})`).toBeTruthy();
      await start.selectOption(startDate!);
      // the dabba is offered only on the day whose menu has it (server-built day options)
      const pickSelects = customer.locator(`select:has(option[value="b:${boxId}"])`);
      await expect(pickSelects).toHaveCount(1, { timeout: 20_000 });
      await pickSelects.selectOption(`b:${boxId}`);
      await customer.getByRole("radiogroup", { name: "Payment method" }).getByLabel(/cash on delivery/i).check();
      const go = customer.getByRole("button", { name: /start this plan/i });
      await expect(go).toBeEnabled({ timeout: 20_000 });
      await go.click();
      await customer.waitForURL(/\/(thank-you|pay)\//, { timeout: 30_000 });
      const pid = customer.url().split("/").pop()!.split("?")[0];

      // 4 · server-side validation and amount: plan price per meal for every meal, plus the surcharge of the picked
      //     dabba over the plan's regular price (the client never sends a price)
      const payment = await db().payment.findUniqueOrThrow({ where: { id: pid }, include: { subscription: { include: { orders: { include: { items: true } } } } } });
      const sub = payment.subscription!;
      const meals = sub.orders.filter((o) => o.status !== "CANCELLED");
      const surcharge = Math.max(0, BOX_PRICE - (planPriceBefore.compareAtPrice ?? planPriceBefore.pricePerMeal));
      const expected = meals.length * planPriceBefore.pricePerMeal + surcharge;
      expect(sub.pricePerMeal).toBe(planPriceBefore.pricePerMeal);
      expect(payment.amount).toBe(expected);
      expect(sub.total).toBe(expected);
      const ours = meals.find((o) => o.deliveryDate.toISOString().slice(0, 10) === menuDay)!;
      expect(ours.items).toHaveLength(1);
      expect(ours.items[0].boxId).toBe(boxId);
      expect(ours.items[0].unitPrice).toBe(planPriceBefore.pricePerMeal + surcharge);
      expect(ours.total).toBe(planPriceBefore.pricePerMeal + surcharge);
      // 6 · order + payment states: cash plan → active plan, payment pending until the rider collects, meals scheduled
      expect(payment.method).toBe("CASH");
      expect(payment.status).toBe("PENDING");
      expect(sub.status).toBe("ACTIVE");
      expect(meals.every((o) => o.status === "SCHEDULED")).toBe(true);
      await customer.goto(`/account/plans/${sub.id}`);
      await expect(customer.locator("main").getByText("Active", { exact: true })).toBeVisible();
      return { paymentId: pid, orderId: ours.id, orderNumber: ours.number, orderCode: ours.code };
    });
    subscriptionId = (await db().payment.findUniqueOrThrow({ where: { id: paymentId } })).subscriptionId;
    const ordersOf = () => db().order.count({ where: { subscriptionId: subscriptionId!, items: { some: { boxId } } } });

    // Shortcut: the delivery day arrives (see header).
    await db().order.update({ where: { id: orderId }, data: { deliveryDate: dateOnly(today) } });
    await db().dayLock.deleteMany({ where: { kitchenId: kitchen.id, date: dateOnly(today) } });
    const qs = `kitchen=${kitchen.id}&date=${today}&buffer=0`;

    // ── 7 · the kitchen order exists exactly once, and re-running the cut-off job creates nothing new ──
    await test.step("7 lock day; cut-off job re-runs are idempotent", async () => {
      await admin.goto(`/admin/kitchen?${qs}`);
      await admin.getByRole("button", { name: "Lock day" }).click();
      await expect(admin.getByText(/^Locked /)).toBeVisible();
      await expect.poll(async () => (await db().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CONFIRMED");
      const confirmations = () => db().orderStatusEvent.count({ where: { orderId, toStatus: "CONFIRMED" } });
      expect(await ordersOf()).toBe(1);
      expect(await confirmations()).toBe(1);
      // re-run 1: Admin → Scheduled jobs → Cut-off → Run now
      const runs = () => db().auditLog.count({ where: { action: "job.run", entityId: "cutoff" } });
      const before = await runs();
      await admin.goto("/admin/jobs");
      await admin.locator("tr").filter({ hasText: "Locks today for every kitchen" }).getByRole("button", { name: "Run now" }).click();
      await expect.poll(runs, { timeout: 30_000 }).toBe(before + 1);
      // re-runs 2 and 3: the Vercel cron endpoint itself (bearer secret)
      for (let i = 0; i < 2; i++) {
        const res = await request.get("/api/cron/daily?job=cutoff", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
        expect(res.status()).toBe(200);
      }
      expect(await ordersOf()).toBe(1);
      expect(await confirmations()).toBe(1);
      expect(await db().dayLock.count({ where: { kitchenId: kitchen.id, date: dateOnly(today) } })).toBe(1);
      expect((await db().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CONFIRMED");
    });

    // ── 8 · kitchen sees the right ingredient / prep requirement ──
    await test.step("8 kitchen requirements", async () => {
      await admin.goto(`/admin/kitchen?${qs}`);
      const row = admin.locator("main tr").filter({ hasText: dishName }).filter({ hasText: "Rice (sona mansuli)" });
      await expect(row).toContainText("(1+0)"); // 1 portion, no buffer
      await expect(row).toContainText("Rice (sona mansuli) 0.1 kg"); // 1 kg / 10 portions × 1
      await admin.goto(`/admin/kitchen/prep?${qs}`);
      await expect(admin.locator("main").getByText(dishName).first()).toBeVisible();
    });

    // ── 9 · production: plan the batch, cook it, mark done → stock movements posted once ──
    await test.step("9 batch done → stock movements", async () => {
      await admin.goto(`/admin/kitchen?${qs}`);
      const planForm = admin.locator("main form").filter({ has: admin.getByRole("button", { name: /Plan batches|Refresh plan/ }) });
      await planForm.getByRole("spinbutton").fill("0");
      await planForm.getByRole("button", { name: /Plan batches|Refresh plan/ }).click();
      const batchRow = admin.locator("main tr").filter({ hasText: dishName }).filter({ has: admin.getByRole("button", { name: "Start" }) });
      await batchRow.getByRole("button", { name: "Start" }).click();
      const cooking = admin.locator("main tr").filter({ hasText: dishName }).filter({ has: admin.getByRole("button", { name: "Done" }) });
      await cooking.getByLabel("Portions cooked").fill("1");
      await cooking.getByRole("button", { name: "Done" }).click();
      const batch = await expect.poll(async () => (await db().productionBatch.findFirst({ where: { kitchenId: kitchen.id, date: dateOnly(today), menuItemId: dishId } }))?.status).toBe("DONE").then(() =>
        db().productionBatch.findFirstOrThrow({ where: { kitchenId: kitchen.id, date: dateOnly(today), menuItemId: dishId } }),
      );
      expect(batch.actualPortions).toBe(1);
      await expect.poll(async () => (await db().productionBatch.findUniqueOrThrow({ where: { id: batch.id } })).stockPosted).toBe(true);
      const moves = await db().stockMovement.findMany({ where: { reference: `batch:${batch.id}` } });
      expect(moves.every((m) => m.ingredientId === rice.id && m.type === "USAGE" && m.kitchenId === kitchen.id)).toBe(true);
      expect(Math.round(moves.reduce((a, m) => a + m.quantity, 0) * 1000) / 1000).toBe(-0.1);
    });

    const todayCard = () => customer.locator("article").filter({ hasText: `#${orderNumber}` });

    // ── 10 · prepared + packed (customer sees each step) ──
    await test.step("10 prepared + packed", async () => {
      await admin.goto(`/admin/kitchen?${qs}`);
      await admin.getByRole("button", { name: /^Start all \d+$/ }).click();
      await expect.poll(async () => (await db().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PREPARING");
      await customer.goto("/account");
      await expect(todayCard().locator('[aria-current="step"]')).toContainText("In the kitchen");
      await admin.goto(`/admin/kitchen?${qs}`);
      const card = admin.locator("main li").filter({ hasText: `#${orderCode}` });
      for (const label of ["Items match", "Label on", "Allergens checked", "Sealed"]) await card.getByLabel(label).check();
      await card.getByRole("button", { name: "Packed ✓" }).click();
      await expect.poll(async () => (await db().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PACKED");
      await customer.reload();
      await expect(todayCard().locator('[aria-current="step"]')).toContainText("Packed");
    });

    // ── 11–12 · dispatch assigns a rider and sends the route out; the customer sees "On the way" and the code ──
    let otp = "";
    await test.step("11–12 dispatch + customer status", async () => {
      await admin.goto(`/admin/dispatch?kitchen=${kitchen.id}&date=${today}`);
      const manifest = admin.locator("main form").filter({ has: admin.getByRole("button", { name: "Assign ticked" }) });
      await manifest.getByLabel(`Select ${orderNumber}`).check();
      await manifest.getByPlaceholder("New route name").fill(routeName);
      await manifest.getByLabel("Rider").selectOption({ label: "Rider One (demo)" });
      await manifest.getByRole("button", { name: "Assign ticked" }).click();
      const routePanel = admin.locator("main section").filter({ has: admin.getByRole("heading", { name: routeName }) });
      await routePanel.getByRole("button", { name: "Send out" }).click();
      await expect.poll(async () => (await db().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("OUT_FOR_DELIVERY");
      await customer.reload();
      await expect(todayCard().locator('[aria-current="step"]')).toContainText("On the way");
      otp = (await todayCard().locator("span.font-mono").innerText()).trim();
      expect(otp).toMatch(/^\d{4}$/);
    });

    // ── 13 · rider confirms delivery with the OTP (a wrong code is refused) and collects the cash ──
    await test.step("13 OTP delivery", async () => {
      const rider = await pageFor(browser, "rider@demo.dabbabela.local", undefined, "/rider");
      const riderErrors = watchErrors(rider);
      await rider.goto("/rider");
      await rider.getByRole("link", { name: new RegExp(routeName) }).click();
      const stop = rider.locator("main li").filter({ hasText: `#${orderCode}` });
      await stop.getByRole("button", { name: "Delivered" }).click();
      const code = stop.getByLabel("Customer's 4-digit code");
      await code.fill(otp === "0000" ? "1111" : "0000");
      await stop.getByRole("button", { name: "Confirm" }).click();
      await expect(stop.getByRole("alert")).toContainText(/doesn't match/);
      await code.fill(otp);
      await stop.getByRole("button", { name: "Confirm" }).click();
      await expect.poll(async () => (await db().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DELIVERED");
      const delivered = await db().deliveryEvent.findFirstOrThrow({ where: { orderId, type: "DELIVERED" } });
      expect(delivered.otpOk).toBe(true);
      expect(await db().deliveryEvent.count({ where: { orderId, type: "NOTE", otpOk: false } })).toBe(1);
      const route = await db().deliveryRoute.findFirstOrThrow({ where: { name: routeName } });
      expect(route.cashCollected).toBeGreaterThan(0);
      riderErrors();
      await rider.context().close();
      await customer.reload();
      await expect(todayCard().locator('[aria-current="step"]')).toContainText("Delivered");
    });

    // ── 14 · reports reflect it ──
    await test.step("14 reports + analytics", async () => {
      const order = await db().order.findUniqueOrThrow({ where: { id: orderId } });
      await admin.goto(`/admin/reports/revenue-by-meal?from=${today}&to=${today}&kitchen=${kitchen.id}`);
      const row = admin.locator("main tr").filter({ hasText: boxName });
      await expect(row).toHaveCount(1);
      await expect(row.locator("td").nth(1)).toHaveText("1"); // sold
      await expect(row.locator("td").nth(2)).toHaveText("1"); // orders
      await expect(row).toContainText((order.total / 100).toLocaleString("en-IN")); // line value = the order's price
      await admin.goto(`/admin/reports/order-status?from=${today}&to=${today}&kitchen=${kitchen.id}`);
      await expect(admin.locator("main tr").filter({ hasText: "Delivered" }).first()).toBeVisible();
    });

    // ── 15 · super admin inspects the full history: order timeline + audit log ──
    await test.step("15 order timeline + audit", async () => {
      await admin.goto(`/admin/orders/${orderId}`);
      const timeline = admin.locator("main");
      for (const t of ["Confirmed", "In the kitchen", "Packed", "On the way", "Delivered"]) await expect(timeline.getByText(new RegExp(`→ ${t}`)).first()).toBeVisible();
      await expect(timeline.getByText(/Delivery: delivered.*\(code ok\)/)).toBeVisible();
      await admin.goto(`/admin/audit?entityId=${boxId}`);
      await expect(admin.locator("main").getByText("box.create").first()).toBeVisible();
      await admin.goto(`/admin/audit?entityId=${menuId}`);
      await expect(admin.locator("main").getByText("menu.published").first()).toBeVisible();
      expect(await db().auditLog.count({ where: { action: "dish.create", entityId: dishId } })).toBe(1);
    });

    // ── 16 · a CMS update appears on the public site ──
    await test.step("16 CMS publish → public site", async () => {
      const headline = `Acceptance lunch ${stamp}`;
      await admin.goto(`/admin/content/${CMS_KEY}?locale=en`);
      const main = admin.locator("main");
      await main.getByLabel("Title", { exact: true }).fill(headline);
      await main.getByRole("button", { name: "Publish" }).click();
      await expect(main.getByRole("status")).toContainText(/publish/i);
      const visitor = await (await browser.newContext()).newPage();
      await visitor.goto("/");
      await expect(visitor.getByText(headline)).toBeVisible();
      await visitor.context().close();
    });

    // ── 17 · unauthorised users can't reach privileged functions ──
    await test.step("17 access control", async () => {
      const anon = await (await browser.newContext()).newPage();
      await anon.goto(`/admin/orders/${orderId}`);
      await expect(anon).toHaveURL(/\/login\?next=/);
      expect((await request.get("/api/cron/daily?job=cutoff")).status()).toBe(401);
      expect((await request.get("/api/cron/daily?job=cutoff", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
      await anon.context().close();
      // the customer can't open the control room or exports
      await customer.goto(`/admin/orders/${orderId}`);
      await expect(customer).not.toHaveURL(/\/admin\/orders\//);
      const exp = await customer.request.get("/api/admin/export/report/revenue-by-meal", { maxRedirects: 0 });
      expect(exp.status()).not.toBe(200);
      // another customer can't open this customer's order
      const other = await pageFor(browser, "customer.b@demo.dabbabela.local", undefined, "/account");
      const res = await other.goto(`/account/orders/${orderId}`);
      expect(res?.status()).toBe(404);
      await other.context().close();
      // a chef can't open money reports or the audit log; a rider can't open admin orders
      const chef = await pageFor(browser, "chef@demo.dabbabela.local", undefined, "/admin/kitchen");
      await chef.goto("/admin/reports/revenue-by-meal");
      await expect(chef).toHaveURL(/\/admin\/forbidden/);
      await chef.goto("/admin/audit");
      await expect(chef).toHaveURL(/\/admin\/forbidden/);
      await chef.context().close();
    });

    // ── 18 · a price change leaves historical payment / subscription / order prices alone ──
    await test.step("18 price change keeps history", async () => {
      const snapshot = async () => {
        const p = await db().payment.findUniqueOrThrow({ where: { id: paymentId }, select: { amount: true } });
        const s = await db().subscription.findUniqueOrThrow({ where: { id: subscriptionId! }, select: { pricePerMeal: true, subtotal: true, total: true, priceId: true } });
        const o = await db().order.findUniqueOrThrow({ where: { id: orderId }, select: { subtotal: true, total: true, items: { select: { unitPrice: true, lineTotal: true } } } });
        return { p, s, o };
      };
      const before = await snapshot();
      // dabba price up
      await admin.goto(`/admin/boxes/${boxId}`);
      await admin.locator("main").getByLabel("Price (Rs)").fill("300");
      await admin.locator("main").getByRole("button", { name: "Save dabba" }).click();
      await expect.poll(async () => (await db().lunchBox.findUniqueOrThrow({ where: { id: boxId } })).price).toBe(30000);
      // plan price up (new version effective today)
      await admin.goto(`/admin/plans/${hapta.id}`);
      const priceForm = admin.locator("main form").filter({ has: admin.getByRole("button", { name: "Save price version" }) });
      await priceForm.getByLabel("New price per meal (Rs)").fill(String(planPriceBefore.pricePerMeal / 100 + 10));
      if (planPriceBefore.compareAtPrice != null) await priceForm.getByLabel("Regular price (Rs)").fill(String(planPriceBefore.compareAtPrice / 100 + 10));
      await priceForm.getByRole("button", { name: "Save price version" }).click();
      await expect.poll(async () => (await db().mealPlan.findUniqueOrThrow({ where: { id: hapta.id } })).pricePerMeal).toBe(planPriceBefore.pricePerMeal + 1000);
      expect(await snapshot()).toEqual(before);
      // the customer's records still show the price paid
      await customer.goto(`/account/orders/${orderId}`);
      await expect(customer.locator("main")).toContainText(String(before.o.total / 100));
    });

    adminErrors();
    customerErrors();
    await customer.context().close();
  } finally {
    await cleanup().catch((e) => console.error("acceptance cleanup failed:", e));
  }

  async function cleanup() {
    // put shared demo rows back: plan price, CMS block; cancel the plan so reruns don't stack plans on the demo account
    const plan = await db().mealPlan.findUniqueOrThrow({ where: { id: hapta.id } });
    if (plan.pricePerMeal !== planPriceBefore.pricePerMeal || plan.compareAtPrice !== planPriceBefore.compareAtPrice) {
      await admin.goto(`/admin/plans/${hapta.id}`);
      const priceForm = admin.locator("main form").filter({ has: admin.getByRole("button", { name: "Save price version" }) });
      await priceForm.getByLabel("New price per meal (Rs)").fill(String(planPriceBefore.pricePerMeal / 100));
      await priceForm.getByLabel("Regular price (Rs)").fill(planPriceBefore.compareAtPrice != null ? String(planPriceBefore.compareAtPrice / 100) : "");
      await priceForm.getByLabel("Reason").fill("Acceptance test: restore");
      await priceForm.getByRole("button", { name: "Save price version" }).click();
      await expect.poll(async () => (await db().mealPlan.findUniqueOrThrow({ where: { id: hapta.id } })).pricePerMeal).toBe(planPriceBefore.pricePerMeal);
    }
    if (!cmsBefore) await db().contentSection.deleteMany({ where: { key: CMS_KEY, locale: "en" } });
    else {
      await db().contentRevision.deleteMany({ where: { sectionId: cmsBefore.id, version: { gt: cmsBefore.version } } });
      await db().contentSection.update({ where: { id: cmsBefore.id }, data: { data: cmsBefore.data as Prisma.InputJsonValue, draft: (cmsBefore.draft ?? null) as Prisma.InputJsonValue, version: cmsBefore.version } });
    }
    if (subscriptionId) {
      const sub = await db().subscription.findUnique({ where: { id: subscriptionId } });
      if (sub && sub.status !== "CANCELLED") await cancelPlan(await pageFor(browser, CUSTOMER, undefined, "/account"), subscriptionId);
    }
    await admin.context().close();
  }
});

async function cancelPlan(page: Page, subId: string) {
  await page.goto(`/account/plans/${subId}`);
  const main = page.locator("main");
  await main.getByRole("button", { name: "Cancel plan" }).click();
  await main.getByLabel("Why are you cancelling?").fill("Acceptance test cleanup");
  await main.getByRole("button", { name: "Cancel plan" }).last().click();
  await expect.poll(async () => (await db().subscription.findUniqueOrThrow({ where: { id: subId } })).status).toBe("CANCELLED");
  await page.context().close();
}
