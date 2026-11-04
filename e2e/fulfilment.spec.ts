import { expect, test } from "@playwright/test";
import { acceptDialogs, login, placeOrder, watchErrors } from "./helpers";
import { dateOnly, db, todayKtm } from "./db";

test("kitchen packs, dispatch sends the route out, rider delivers with the customer's code", async ({ browser }) => {
  // customer orders (cash) — then the delivery day "arrives": the order is moved to today
  const customer = await (await browser.newContext()).newPage();
  await login(customer, "customer.b@demo.dabbabela.local");
  const { paymentId } = await placeOrder(customer);
  const placed = await db().order.findFirstOrThrow({ where: { paymentId }, select: { id: true, number: true, code: true, kitchenId: true } });
  const today = todayKtm();
  await db().order.update({ where: { id: placed.id }, data: { deliveryDate: dateOnly(today) } });
  const qs = `kitchen=${placed.kitchenId}&date=${today}`;
  const routeName = `E2E ${placed.code}`;

  // kitchen: lock the day (if not yet), pack with all four checks
  const ops = await (await browser.newContext()).newPage();
  const opsErrors = watchErrors(ops);
  acceptDialogs(ops);
  await login(ops, "ops@demo.dabbabela.local", undefined, "/admin");
  await ops.goto(`/admin/kitchen?${qs}`);
  const lock = ops.getByRole("button", { name: "Lock day" });
  if (await lock.count()) {
    await lock.click();
    await expect(ops.getByText(/^Locked /)).toBeVisible();
    // locking confirms the day's scheduled orders, ours included
    await expect.poll(async () => (await db().order.findUniqueOrThrow({ where: { id: placed.id } })).status).toBe("CONFIRMED");
  }
  const card = ops.locator("main li").filter({ hasText: `#${placed.code}` });
  for (const label of ["Items match", "Label on", "Allergens checked", "Sealed"]) await card.getByLabel(label).check();
  await card.getByRole("button", { name: "Packed ✓" }).click();
  await expect.poll(async () => (await db().order.findUniqueOrThrow({ where: { id: placed.id } })).status).toBe("PACKED");

  // dispatch: new route with the rider, send out
  await ops.goto(`/admin/dispatch?${qs}`);
  const manifest = ops.locator("main form").filter({ has: ops.getByRole("button", { name: "Assign ticked" }) });
  await manifest.getByLabel(`Select ${placed.number}`).check();
  await manifest.getByPlaceholder("New route name").fill(routeName);
  await manifest.getByLabel("Rider").selectOption({ label: "Rider One (demo)" });
  await manifest.getByRole("button", { name: "Assign ticked" }).click();
  const routePanel = ops.locator("main section").filter({ has: ops.getByRole("heading", { name: routeName }) });
  await routePanel.getByRole("button", { name: "Send out" }).click();
  await expect.poll(async () => (await db().order.findUniqueOrThrow({ where: { id: placed.id } })).status).toBe("OUT_FOR_DELIVERY");
  opsErrors();

  // customer sees the hand-off code
  await customer.goto(`/account/orders/${placed.id}`);
  const otp = (await customer.locator("p.font-mono.text-4xl").innerText()).trim();
  expect(otp).toMatch(/^\d{4}$/);

  // rider: wrong code refused, right code delivers and records the cash
  const rider = await (await browser.newContext()).newPage();
  const riderErrors = watchErrors(rider);
  await login(rider, "rider@demo.dabbabela.local", undefined, "/rider");
  await rider.goto("/rider");
  await rider.getByRole("link", { name: new RegExp(routeName) }).click();
  const stop = rider.locator("main li").filter({ hasText: `#${placed.code}` });
  await stop.getByRole("button", { name: "Delivered" }).click();
  const code = stop.getByLabel("Customer's 4-digit code");
  await code.fill(otp === "0000" ? "1111" : "0000");
  await stop.getByRole("button", { name: "Confirm" }).click();
  await expect(stop.getByRole("alert")).toContainText(/doesn't match/);
  await code.fill(otp);
  await stop.getByRole("button", { name: "Confirm" }).click();
  await expect.poll(async () => (await db().order.findUniqueOrThrow({ where: { id: placed.id } })).status).toBe("DELIVERED");
  const route = await db().deliveryRoute.findFirstOrThrow({ where: { name: routeName } });
  expect(route.cashCollected).toBeGreaterThan(0);
  riderErrors();

  await customer.context().close();
  await ops.context().close();
  await rider.context().close();
});
