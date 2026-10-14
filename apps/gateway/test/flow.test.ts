import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { startToolServer, textResult } from "../../../packages/mcp-http/src/index.ts";
import { startGateway } from "../src/app.ts";
import type { AppConfig } from "../src/config.ts";

function cookie(response: Response): string {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
}

async function login(base: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  return cookie(response);
}

test("gateway routes tools, isolates a dead upstream, and revokes keys", async () => {
  const created: string[] = [];
  const woo = await startToolServer({
    name: "woocommerce",
    port: 0,
    host: "127.0.0.1",
    bearerToken: "woo-token",
    tools: [
      {
        name: "create_product",
        description: "Create a product",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" }, regular_price: { type: "string" } },
          required: ["name", "regular_price"],
        },
        handler: (args) => {
          created.push(`${String(args.name)}:${String(args.regular_price)}`);
          return textResult(`Created product #7 "${String(args.name)}" at USD ${String(args.regular_price)}. Status: publish.`);
        },
      },
      {
        name: "list_orders",
        description: "List orders",
        inputSchema: { type: "object", properties: { after: { type: "string" }, per_page: { type: "integer" } } },
        handler: () => textResult("1 order.\n#501 processing · USD 28.00 · Ada Lovelace"),
      },
    ],
  });
  const ops = await startToolServer({
    name: "ops",
    port: 0,
    host: "127.0.0.1",
    bearerToken: "ops-token",
    tools: [
      {
        name: "get_shipping_policy",
        description: "Shipping promise",
        inputSchema: { type: "object", properties: {} },
        handler: () => textResult("Continental US delivery is 3 business days."),
      },
    ],
  });
  const hanging = createServer(() => undefined);
  await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
  const hangAddress = hanging.address();
  const hangPort = typeof hangAddress === "object" && hangAddress ? hangAddress.port : 0;
  const credentialKey = Buffer.alloc(32, 7);
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 0,
    databasePath: ":memory:",
    credentialKey,
    sessionSecret: "test-session-secret",
    cookieSecure: false,
    admin: { email: "admin@urumi.local", name: "Ada Admin", password: "admin-pass-123" },
    member: { email: "member@urumi.local", name: "Mina Member", password: "member-pass-123" },
    builtins: [
      { name: "WooCommerce", slug: "woocommerce", url: woo.url, token: "woo-token", writeMinRole: "admin" },
      { name: "Store operations", slug: "ops", url: ops.url, token: "ops-token", writeMinRole: "member" },
      { name: "Hanging", slug: "hang", url: `http://127.0.0.1:${hangPort}/mcp`, writeMinRole: "member" },
    ],
    llm: { baseUrl: "http://127.0.0.1:9/v1", apiKey: "", model: "offline" },
    toolExposure: "flat",
    publicStoreUrl: "http://store.urumi.local",
    storeMode: "fixture",
    selfHosts: [],
    upstreamTimeoutMs: 500,
    listTimeoutMs: 400,
    rateLimitPerMinute: 100,
    statusIntervalMs: 60_000,
  };
  const gateway = await startGateway(config);
  try {
    const servers = await fetch(`${gateway.url}/api/servers`, { headers: { cookie: await login(gateway.url, config.admin.email, config.admin.password) } });
    const listed = (await servers.json()) as { servers: Array<{ slug: string; status: string; url: string | null }> };
    const bySlug = Object.fromEntries(listed.servers.map((server) => [server.slug, server.status]));
    assert.equal(bySlug.woocommerce, "connected");
    assert.equal(bySlug.ops, "connected");
    assert.equal(bySlug.hang, "unreachable");
    assert.equal(listed.servers.find((server) => server.slug === "woocommerce")?.url, woo.url);

    const adminCookie = await login(gateway.url, config.admin.email, config.admin.password);
    const chat = await fetch(`${gateway.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ message: "Create a product named Harbor Mug for 18 dollars and what is our shipping promise?" }),
    });
    assert.equal(chat.status, 200);
    const chatBody = (await chat.json()) as { message: { content: string; trace: Array<{ tool: string; ok: boolean }> } };
    assert.deepEqual(created, ["Harbor Mug:18.00"]);
    assert.equal(chatBody.message.trace.some((item) => item.tool === "woocommerce__create_product" && item.ok), true);
    assert.equal(chatBody.message.trace.some((item) => item.tool === "ops__get_shipping_policy" && item.ok), true);
    assert.match(chatBody.message.content, /Harbor Mug/);
    assert.match(chatBody.message.content, /3 business days/);

    const memberCookie = await login(gateway.url, config.member.email, config.member.password);
    const memberView = await fetch(`${gateway.url}/api/servers`, { headers: { cookie: memberCookie } });
    const memberServers = (await memberView.json()) as { servers: Array<{ url: string | null; tools: Array<{ name: string; allowed: boolean }> }> };
    assert.equal(memberServers.servers.every((server) => server.url === null), true);
    const memberTools = memberServers.servers.flatMap((server) => server.tools).filter((tool) => tool.allowed).map((tool) => tool.name);
    assert.equal(memberTools.includes("woocommerce__create_product"), false);
    assert.equal(memberTools.includes("woocommerce__list_orders"), true);

    const issued = await fetch(`${gateway.url}/api/keys`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: memberCookie },
      body: JSON.stringify({ name: "cursor" }),
    });
    const secret = ((await issued.json()) as { secret: string }).secret;
    const readRpc = async (response: Response) => {
      const text = await response.text();
      const type = response.headers.get("content-type") ?? "";
      if (type.includes("text/event-stream")) {
        const data = text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .at(-1);
        return JSON.parse(data ?? "null") as { result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean } };
      }
      return JSON.parse(text) as { result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean } };
    };
    const mcp = async (token: string, method: string, params: unknown) =>
      fetch(`${gateway.url}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    const list = await mcp(secret, "tools/list", {});
    const listBody = await readRpc(list);
    const names = (listBody.result?.tools ?? []).map((tool) => tool.name);
    assert.equal(names.includes("woocommerce__list_orders"), true);
    assert.equal(names.includes("ops__get_shipping_policy"), true);
    assert.equal(names.includes("woocommerce__create_product"), false);
    assert.equal(names.some((name) => name.startsWith("hang__")), false);

    const orders = await mcp(secret, "tools/call", { name: "woocommerce__list_orders", arguments: { after: "2026-10-14T00:00:00.000Z" } });
    const ordersBody = await readRpc(orders);
    assert.match(ordersBody.result?.content?.[0]?.text ?? "", /#501/);
    assert.notEqual(ordersBody.result?.isError, true);

    const denied = await mcp(secret, "tools/call", { name: "woocommerce__create_product", arguments: { name: "Nope", regular_price: "1.00" } });
    const deniedBody = await readRpc(denied);
    assert.equal(deniedBody.result?.isError, true);
    assert.match(deniedBody.result?.content?.[0]?.text ?? "", /limited to admins/);

    const opsServer = listed.servers.find((server) => server.slug === "ops");
    assert.ok(opsServer);
    const adminServers = (await (await fetch(`${gateway.url}/api/servers`, { headers: { cookie: adminCookie } })).json()) as {
      servers: Array<{ id: string; slug: string }>;
    };
    const opsId = adminServers.servers.find((server) => server.slug === "ops")?.id;
    const disabled = await fetch(`${gateway.url}/api/servers/${opsId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(disabled.status, 200);
    const afterDisable = await mcp(secret, "tools/list", {});
    const afterNames = ((await readRpc(afterDisable)).result?.tools ?? []).map((tool) => tool.name);
    assert.equal(afterNames.includes("ops__get_shipping_policy"), false);
    assert.equal(afterNames.includes("woocommerce__list_orders"), true);

    const keys = (await (await fetch(`${gateway.url}/api/keys`, { headers: { cookie: memberCookie } })).json()) as {
      keys: Array<{ id: string; name: string }>;
    };
    const keyId = keys.keys.find((key) => key.name === "cursor")?.id;
    const revoked = await fetch(`${gateway.url}/api/keys/${keyId}/revoke`, { method: "POST", headers: { cookie: memberCookie } });
    assert.equal(revoked.status, 200);
    const rejected = await mcp(secret, "tools/list", {});
    assert.equal(rejected.status, 401);

    const audit = (await (await fetch(`${gateway.url}/api/audit`, { headers: { cookie: adminCookie } })).json()) as {
      entries: Array<{ userEmail: string; toolName: string; success: boolean; source: string }>;
    };
    assert.equal(
      audit.entries.some((entry) => entry.userEmail === config.admin.email && entry.toolName === "woocommerce__create_product" && entry.source === "chat"),
      true,
    );
    assert.equal(
      audit.entries.some((entry) => entry.userEmail === config.member.email && entry.toolName === "woocommerce__list_orders" && entry.source === "mcp" && entry.success),
      true,
    );
    const memberAudit = (await (await fetch(`${gateway.url}/api/audit`, { headers: { cookie: memberCookie } })).json()) as {
      entries: Array<{ userEmail: string }>;
    };
    assert.equal(memberAudit.entries.every((entry) => entry.userEmail === config.member.email), true);
  } finally {
    await gateway.close();
    await woo.close();
    await ops.close();
    await new Promise<void>((resolve, reject) => hanging.close((error) => (error ? reject(error) : resolve())));
  }
});
