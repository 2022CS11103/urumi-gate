import { startToolServer, textResult } from "../../../packages/mcp-http/src/index.ts";

const empty = { type: "object" as const, properties: {}, additionalProperties: false };

async function main() {
  const server = await startToolServer({
    name: "ops",
    port: Number(process.env.PORT ?? 8080),
    bearerToken: process.env.MCP_BEARER_TOKEN || undefined,
    tools: [
      {
        name: "get_shipping_policy",
        description: "Return Northwind Supply's shipping promise: cutoff, regions, and how long delivery takes.",
        inputSchema: empty,
        handler: () =>
          textResult(
            "Northwind Supply ships from San Francisco. Orders placed before 15:00 America/Los_Angeles on a business day leave the same day. Continental US delivery is 3 business days. Alaska, Hawaii, and international orders are quoted separately and are not promised in 3 days.",
          ),
      },
      {
        name: "get_return_policy",
        description: "Return the store's return window and the condition required for a refund.",
        inputSchema: empty,
        handler: () =>
          textResult(
            "Unused items can be returned within 30 days of delivery. The customer pays return shipping unless the order arrived damaged. Refunds go back to the original payment method after the warehouse checks the item in.",
          ),
      },
      {
        name: "get_business_hours",
        description: "Return support hours and the warehouse cutoff used for same-day shipping.",
        inputSchema: empty,
        handler: () =>
          textResult(
            "Support answers Monday to Friday, 09:00-17:00 America/Los_Angeles. The warehouse is closed Saturday and Sunday. Same-day dispatch cutoff is 15:00 local time.",
          ),
      },
    ],
  });
  console.log(JSON.stringify({ level: "info", msg: "ops-mcp listening", url: server.url }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", msg: error instanceof Error ? error.message : "failed to start" }));
  process.exit(1);
});
