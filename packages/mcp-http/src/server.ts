import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readBody, rpcError, rpcResult, writeRpc } from "./framing.ts";
import { textResult, type JsonRpcRequest, type ToolHandler } from "./types.ts";

const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];

export interface ToolServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

function schemaObject(tool: ToolHandler) {
  return {
    type: "object" as const,
    properties: tool.inputSchema.properties ?? {},
    required: tool.inputSchema.required ?? [],
    additionalProperties: tool.inputSchema.additionalProperties ?? false,
  };
}

function missingRequired(tool: ToolHandler, args: Record<string, unknown>): string | null {
  for (const key of tool.inputSchema.required ?? []) {
    const value = args[key];
    if (value === undefined || value === null || value === "") {
      return `missing required argument ${key}`;
    }
  }
  return null;
}

async function handleMessage(msg: JsonRpcRequest, tools: Map<string, ToolHandler>) {
  const id = msg.id ?? null;
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(id, -32600, "invalid request");
  }
  if (msg.method === "notifications/initialized" || msg.method === "notifications/cancelled") {
    return null;
  }
  if (msg.id === undefined) {
    return null;
  }
  if (msg.method === "initialize") {
    const params = (msg.params ?? {}) as { protocolVersion?: string };
    const requested = params.protocolVersion ?? "2025-03-26";
    const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : "2025-03-26";
    return rpcResult(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "placeholder", version: "1.0.0" },
    });
  }
  if (msg.method === "ping") {
    return rpcResult(id, {});
  }
  if (msg.method === "tools/list") {
    return rpcResult(id, {
      tools: [...tools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: schemaObject(tool),
      })),
    });
  }
  if (msg.method === "tools/call") {
    const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    if (!params.name) return rpcError(id, -32602, "tools/call requires a name");
    const tool = tools.get(params.name);
    if (!tool) {
      return rpcResult(id, textResult(`unknown tool ${params.name}`, true));
    }
    const args = params.arguments ?? {};
    const missing = missingRequired(tool, args);
    if (missing) return rpcResult(id, textResult(missing, true));
    try {
      const result = await tool.handler(args);
      return rpcResult(id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "tool failed";
      return rpcResult(id, textResult(message, true));
    }
  }
  return rpcError(id, -32601, `method not found: ${msg.method}`);
}

export function startToolServer(options: {
  name: string;
  version?: string;
  host?: string;
  port: number;
  bearerToken?: string;
  tools: ToolHandler[];
}): Promise<ToolServer> {
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/readyz")) {
        writeRpc(res, req, 200, { ok: true, name: options.name });
        return;
      }
      if (url.pathname !== "/mcp") {
        writeRpc(res, req, 404, { error: "not found" });
        return;
      }
      if (options.bearerToken) {
        if (req.headers.authorization !== `Bearer ${options.bearerToken}`) {
          writeRpc(res, req, 401, { error: "unauthorized" });
          return;
        }
      }
      if (req.method === "GET") {
        res.writeHead(405, { allow: "POST, DELETE" });
        res.end();
        return;
      }
      if (req.method === "DELETE") {
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST, DELETE" });
        res.end();
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        writeRpc(res, req, 400, rpcError(null, -32700, "parse error"));
        return;
      }
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      const results = [];
      for (const message of messages) {
        const result = await handleMessage(message as JsonRpcRequest, tools);
        if (result && result.result && (result.result as { serverInfo?: { name: string } }).serverInfo) {
          (result.result as { serverInfo: { name: string; version: string } }).serverInfo = {
            name: options.name,
            version: options.version ?? "1.0.0",
          };
        }
        if (result) results.push(result);
      }
      if (results.length === 0) {
        writeRpc(res, req, 202, null);
        return;
      }
      writeRpc(res, req, 200, Array.isArray(parsed) ? results : results[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal error";
      if (!res.headersSent) writeRpc(res, req, 500, rpcError(null, -32603, message));
    }
  });

  const host = options.host ?? "0.0.0.0";
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      const advertisedHost = host === "0.0.0.0" ? "127.0.0.1" : host;
      resolve({
        port,
        url: `http://${advertisedHost}:${port}/mcp`,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}
