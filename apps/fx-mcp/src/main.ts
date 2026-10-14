import { startToolServer, textResult } from "../../../packages/mcp-http/src/index.ts";

const RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.78,
  INR: 84.1,
  JPY: 149.2,
  AED: 3.67,
};

const CODES = Object.keys(RATES);

function code(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!RATES[raw]) throw new Error(`currency must be one of ${CODES.join(", ")}`);
  return raw;
}

function amount(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("amount must be a non-negative number");
  return parsed;
}

async function main() {
  const server = await startToolServer({
    name: "fx",
    port: Number(process.env.PORT ?? 8080),
    bearerToken: process.env.MCP_BEARER_TOKEN || undefined,
    tools: [
      {
        name: "list_rates",
        description: "List indicative USD exchange rates used for store pricing questions. Rates are static demo figures, not a live feed.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: () => {
          const lines = CODES.map((currency) => `${currency} ${RATES[currency]}`);
          return textResult(`USD-based rates:\n${lines.join("\n")}`);
        },
      },
      {
        name: "convert_currency",
        description: "Convert an amount between USD, EUR, GBP, INR, JPY, and AED using the static demo rates.",
        inputSchema: {
          type: "object",
          properties: {
            amount: { type: "number" },
            from: { type: "string" },
            to: { type: "string" },
          },
          required: ["amount", "from", "to"],
          additionalProperties: false,
        },
        handler: (args) => {
          const from = code(args.from);
          const to = code(args.to);
          const value = amount(args.amount);
          const usd = value / RATES[from]!;
          const converted = usd * RATES[to]!;
          return textResult(`${value.toFixed(2)} ${from} = ${converted.toFixed(2)} ${to}`);
        },
      },
    ],
  });
  console.log(JSON.stringify({ level: "info", msg: "fx-mcp listening", url: server.url }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", msg: error instanceof Error ? error.message : "failed to start" }));
  process.exit(1);
});
