export interface PlannedCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface Plan {
  calls: PlannedCall[];
  clarify?: string;
}

function findTool(tools: Array<{ name: string }>, suffix: string): string | null {
  return tools.find((tool) => tool.name === suffix || tool.name.endsWith(`__${suffix}`))?.name ?? null;
}

function startOfUtcDay(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function extractProductName(message: string): string | null {
  const quoted = message.match(/["“]([^"”]{1,120})["”]/);
  if (quoted?.[1]) return quoted[1].trim();
  const named = message.match(/\b(?:named|called)\s+(.+?)(?:\s+(?:priced|price|for|at|costing)\b|\s+\$|\s+\d|$)/i);
  if (!named?.[1]) return null;
  return named[1].replace(/[?.!,]+$/, "").trim() || null;
}

function extractPrice(message: string): string | null {
  const match = message.match(
    /(?:\$|priced at|price|for|at|costing)\s*\$?\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd)\b/i,
  );
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return null;
  return Number(raw).toFixed(2);
}

const CURRENCY: Record<string, string> = {
  usd: "USD",
  dollar: "USD",
  dollars: "USD",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  gbp: "GBP",
  pound: "GBP",
  pounds: "GBP",
  inr: "INR",
  rupee: "INR",
  rupees: "INR",
  jpy: "JPY",
  yen: "JPY",
  aed: "AED",
};

export function planToolCalls(message: string, tools: Array<{ name: string }>, now = new Date()): Plan {
  const calls: PlannedCall[] = [];
  const wantsCreate = /\b(create|add|make)\b/i.test(message) && /\bproduct\b/i.test(message);
  if (wantsCreate) {
    const tool = findTool(tools, "create_product");
    const name = extractProductName(message);
    const regularPrice = extractPrice(message);
    if (!tool) return { calls: [], clarify: "Creating products is limited to admins on this gateway." };
    if (!name || !regularPrice) {
      return { calls: [], clarify: "Tell me the product name and price, for example: create a product named Harbor Mug for 18 dollars." };
    }
    calls.push({ name: tool, arguments: { name, regular_price: regularPrice } });
  }

  const update = message.match(
    /\b(?:mark|set|update|change)\s+order\s+#?(\d+)\s+(?:as\s+|to\s+)?(pending|processing|on-hold|completed|cancelled|canceled|refunded|failed)\b/i,
  );
  if (update) {
    const tool = findTool(tools, "update_order_status");
    if (tool) {
      calls.push({
        name: tool,
        arguments: { id: Number(update[1]), status: update[2]!.toLowerCase() === "canceled" ? "cancelled" : update[2]!.toLowerCase() },
      });
    }
  } else if (/\borders?\b/i.test(message)) {
    const single = message.match(/\border\s+#?(\d+)\b/i);
    if (single && !/\borders\b/i.test(message)) {
      const tool = findTool(tools, "get_order");
      if (tool) calls.push({ name: tool, arguments: { id: Number(single[1]) } });
    } else {
      const tool = findTool(tools, "list_orders");
      if (tool) {
        const args: Record<string, unknown> = { per_page: 20 };
        if (/\btoday\b/i.test(message)) args.after = startOfUtcDay(now);
        calls.push({ name: tool, arguments: args });
      }
    }
  }

  if (/\bproducts?\b/i.test(message) && !wantsCreate && /\b(list|show|what|which|catalog|available)\b/i.test(message)) {
    const tool = findTool(tools, "list_products");
    if (tool) calls.push({ name: tool, arguments: { per_page: 20 } });
  }

  if (/\b(shipping|delivery promise|dispatch)\b/i.test(message)) {
    const tool = findTool(tools, "get_shipping_policy");
    if (tool) calls.push({ name: tool, arguments: {} });
  }
  if (/\breturns?\b/i.test(message)) {
    const tool = findTool(tools, "get_return_policy");
    if (tool) calls.push({ name: tool, arguments: {} });
  }
  if (/\b(hours|open|cutoff)\b/i.test(message)) {
    const tool = findTool(tools, "get_business_hours");
    if (tool) calls.push({ name: tool, arguments: {} });
  }

  const conversion = message.match(
    /(\d+(?:\.\d+)?)\s*(usd|eur|gbp|inr|jpy|aed|dollars?|euros?|pounds?|rupees?|yen)\b[\s\S]{0,40}?\b(?:to|in|into)\s*(usd|eur|gbp|inr|jpy|aed|dollars?|euros?|pounds?|rupees?|yen)\b/i,
  );
  if (conversion) {
    const tool = findTool(tools, "convert_currency");
    if (tool) {
      calls.push({
        name: tool,
        arguments: {
          amount: Number(conversion[1]),
          from: CURRENCY[conversion[2]!.toLowerCase()],
          to: CURRENCY[conversion[3]!.toLowerCase()],
        },
      });
    }
  }

  if (calls.length === 0) {
    return {
      calls: [],
      clarify:
        "I can list or create products, list and update orders, convert currency, and look up shipping, returns, and hours. Ask for one of those and I will call the gateway tools.",
    };
  }
  return { calls };
}

export function summarizeOffline(traces: Array<{ tool: string; ok: boolean; preview: string }>): string {
  if (traces.length === 0) return "I did not call a tool.";
  const body = traces
    .map((trace) => (trace.ok ? trace.preview : `${trace.tool} failed: ${trace.preview}`))
    .join("\n\n");
  const names = traces.map((trace) => trace.tool).join(", ");
  return `I called ${names}.\n\n${body}`;
}
