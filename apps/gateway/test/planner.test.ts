import assert from "node:assert/strict";
import test from "node:test";
import { planToolCalls } from "../src/planner.ts";

const tools = [
  { name: "woocommerce__create_product" },
  { name: "woocommerce__list_orders" },
  { name: "woocommerce__list_products" },
  { name: "ops__get_shipping_policy" },
  { name: "fx__convert_currency" },
];

test("plans a product create and a two-server question", () => {
  const created = planToolCalls("Create a product named Harbor Mug for 18 dollars", tools, new Date("2026-10-14T18:00:00.000Z"));
  assert.deepEqual(created.calls, [
    { name: "woocommerce__create_product", arguments: { name: "Harbor Mug", regular_price: "18.00" } },
  ]);

  const combined = planToolCalls("What orders came in today, and what is our shipping promise?", tools, new Date("2026-10-14T18:00:00.000Z"));
  assert.deepEqual(combined.calls, [
    { name: "woocommerce__list_orders", arguments: { per_page: 20, after: "2026-10-14T00:00:00.000Z" } },
    { name: "ops__get_shipping_policy", arguments: {} },
  ]);

  const converted = planToolCalls("Convert 18 USD to EUR", tools);
  assert.equal(converted.calls[0]?.name, "fx__convert_currency");
  assert.deepEqual(converted.calls[0]?.arguments, { amount: 18, from: "USD", to: "EUR" });
});

test("asks for a name and price instead of guessing", () => {
  const plan = planToolCalls("please create a product", tools);
  assert.equal(plan.calls.length, 0);
  assert.match(plan.clarify ?? "", /name and price/i);
});
