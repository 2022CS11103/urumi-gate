import assert from "node:assert/strict";
import test from "node:test";
import { FixtureStore, formatOrders } from "../src/store.ts";

test("fixture store creates a product and filters today's orders", async () => {
  const store = new FixtureStore();
  const created = await store.createProduct({ name: "Harbor Mug", regularPrice: "18" });
  assert.equal(created.price, "18.00");
  assert.equal(created.status, "publish");

  const today = new Date().toISOString().slice(0, 10);
  const orders = await store.listOrders({ after: `${today}T00:00:00.000Z`, perPage: 20 });
  assert.equal(orders.some((order) => order.customer === "Ada Lovelace"), true);
  assert.equal(orders.some((order) => order.customer === "Grace Hopper"), false);
  assert.match(formatOrders(orders), /Ada Lovelace/);

  const updated = await store.updateOrderStatus(orders[0]!.id, "completed");
  assert.equal(updated.status, "completed");
});
