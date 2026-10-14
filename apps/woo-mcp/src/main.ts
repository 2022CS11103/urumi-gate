import { startToolServer, textResult, type ToolHandler } from "../../../packages/mcp-http/src/index.ts";
import {
  FixtureStore,
  ORDER_STATUSES,
  WooRestStore,
  formatOrder,
  formatOrders,
  formatProductCreated,
  formatProducts,
  type WooStore,
} from "./store.ts";

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function perPage(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(50, Math.max(1, Math.trunc(parsed)));
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

function price(value: unknown): string {
  const raw = typeof value === "number" ? String(value) : str(value);
  if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error("regular_price must be a non-negative amount with up to two decimals");
  }
  return Number(raw).toFixed(2);
}

function schema(properties: Record<string, unknown>, required: string[] = []): ToolHandler["inputSchema"] {
  return { type: "object", properties, required, additionalProperties: false };
}

function toolsFor(store: WooStore): ToolHandler[] {
  return [
    {
      name: "list_products",
      description: "List published products in the WooCommerce store. Optional search matches the name.",
      inputSchema: schema({
        search: { type: "string", description: "Case-insensitive name search" },
        per_page: { type: "integer", minimum: 1, maximum: 50 },
      }),
      handler: async (args) =>
        textResult(formatProducts(await store.listProducts({ search: str(args.search), perPage: perPage(args.per_page) }))),
    },
    {
      name: "create_product",
      description: 'Create and publish a simple product. regular_price is a decimal string such as "18.00".',
      inputSchema: schema(
        {
          name: { type: "string" },
          regular_price: { type: "string", description: "Price in store currency, e.g. 18.00" },
          description: { type: "string" },
          sku: { type: "string" },
        },
        ["name", "regular_price"],
      ),
      handler: async (args) => {
        const name = str(args.name);
        if (!name || name.length > 120) throw new Error("name must be 1-120 characters");
        const product = await store.createProduct({
          name,
          regularPrice: price(args.regular_price),
          description: str(args.description)?.slice(0, 4000),
          sku: str(args.sku)?.slice(0, 60),
        });
        return textResult(formatProductCreated(product));
      },
    },
    {
      name: "list_orders",
      description: "List orders. For orders placed today, set after to today's date at 00:00:00Z.",
      inputSchema: schema({
        after: { type: "string", description: "ISO-8601 timestamp, inclusive" },
        before: { type: "string", description: "ISO-8601 timestamp, inclusive" },
        status: { type: "string", enum: [...ORDER_STATUSES] },
        per_page: { type: "integer", minimum: 1, maximum: 50 },
      }),
      handler: async (args) => {
        const status = str(args.status);
        if (status && !ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
          throw new Error(`status must be one of ${ORDER_STATUSES.join(", ")}`);
        }
        const orders = await store.listOrders({
          after: str(args.after),
          before: str(args.before),
          status,
          perPage: perPage(args.per_page),
        });
        return textResult(formatOrders(orders));
      },
    },
    {
      name: "get_order",
      description: "Get one order by its numeric id.",
      inputSchema: schema({ id: { type: "integer" } }, ["id"]),
      handler: async (args) => {
        const id = integer(args.id, "id");
        const order = await store.getOrder(id);
        if (!order) return textResult(`order ${id} was not found`, true);
        return textResult(formatOrder(order));
      },
    },
    {
      name: "update_order_status",
      description: `Set an order's status. Allowed: ${ORDER_STATUSES.join(", ")}.`,
      inputSchema: schema(
        {
          id: { type: "integer" },
          status: { type: "string", enum: [...ORDER_STATUSES] },
        },
        ["id", "status"],
      ),
      handler: async (args) => {
        const status = str(args.status) ?? "";
        if (!ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
          throw new Error(`status must be one of ${ORDER_STATUSES.join(", ")}`);
        }
        return textResult(formatOrder(await store.updateOrderStatus(integer(args.id, "id"), status)));
      },
    },
  ];
}

export function buildStore(env: NodeJS.ProcessEnv = process.env): WooStore {
  if ((env.WOO_MODE ?? "fixture") === "rest") {
    const baseUrl = env.WOO_BASE_URL;
    const key = env.WOO_CONSUMER_KEY;
    const secret = env.WOO_CONSUMER_SECRET;
    if (!baseUrl || !key || !secret) {
      throw new Error("WOO_MODE=rest requires WOO_BASE_URL, WOO_CONSUMER_KEY, and WOO_CONSUMER_SECRET");
    }
    return new WooRestStore(baseUrl, key, secret);
  }
  return new FixtureStore();
}

export async function main() {
  const server = await startToolServer({
    name: "woocommerce",
    port: Number(process.env.PORT ?? 8080),
    bearerToken: process.env.MCP_BEARER_TOKEN || undefined,
    tools: toolsFor(buildStore()),
  });
  console.log(
    JSON.stringify({ level: "info", msg: "woo-mcp listening", url: server.url, mode: process.env.WOO_MODE ?? "fixture" }),
  );
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("main.ts") || entry.endsWith("main.js")) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ level: "error", msg: error instanceof Error ? error.message : "failed to start" }));
    process.exit(1);
  });
}
