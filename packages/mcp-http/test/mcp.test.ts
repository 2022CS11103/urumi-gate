import assert from "node:assert/strict";
import test from "node:test";
import { callUpstreamTool, listUpstreamTools, startToolServer, textResult } from "../src/index.ts";

test("streamable HTTP initialize, list, and call", async () => {
  const server = await startToolServer({
    name: "fixture",
    port: 0,
    bearerToken: "secret",
    tools: [
      {
        name: "echo",
        description: "Echo the text",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        handler: (args) => textResult(`echo:${String(args.text)}`),
      },
    ],
  });
  try {
    const denied = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(denied.status, 401);

    const tools = await listUpstreamTools({ url: server.url, bearerToken: "secret" }, 2000);
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "echo");

    const result = await callUpstreamTool({ url: server.url, bearerToken: "secret" }, 2000, "echo", {
      text: "mug",
    });
    assert.equal(result.content[0]?.text, "echo:mug");
    assert.equal(result.isError, undefined);
  } finally {
    await server.close();
  }
});

test("client times out when the upstream accepts and never answers", async () => {
  const { createServer } = await import("node:http");
  const hanging = createServer(() => undefined);
  await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
  const address = hanging.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await assert.rejects(
      () => listUpstreamTools({ url: `http://127.0.0.1:${port}/mcp` }, 300),
      (error: unknown) => {
        assert.equal((error as { kind?: string }).kind, "timeout");
        return true;
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) => hanging.close((error) => (error ? reject(error) : resolve())));
  }
});
