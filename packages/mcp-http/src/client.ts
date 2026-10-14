import { parseResponseBody } from "./framing.ts";
import type { McpTool, McpToolResult } from "./types.ts";

export class UpstreamError extends Error {
  readonly kind: "timeout" | "http" | "rpc" | "network";

  constructor(message: string, kind: "timeout" | "http" | "rpc" | "network") {
    super(message);
    this.name = "UpstreamError";
    this.kind = kind;
  }
}

export interface UpstreamTarget {
  url: string;
  bearerToken?: string;
  headerName?: string;
  headerValue?: string;
}

interface RpcMessage {
  error?: { message?: string };
  result?: unknown;
}

function authHeaders(target: UpstreamTarget): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  if (target.bearerToken) headers.authorization = `Bearer ${target.bearerToken}`;
  if (target.headerName && target.headerValue) headers[target.headerName.toLowerCase()] = target.headerValue;
  return headers;
}

async function post(
  target: UpstreamTarget,
  body: unknown,
  timeoutMs: number,
  sessionId?: string,
): Promise<{ status: number; sessionId?: string; message: RpcMessage | null }> {
  const headers = authHeaders(target);
  if (sessionId) headers["mcp-session-id"] = sessionId;
  headers["mcp-protocol-version"] = "2025-03-26";
  let response: Response;
  try {
    response = await fetch(target.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    if (timedOut) throw new UpstreamError(`upstream did not respond within ${timeoutMs}ms`, "timeout");
    const message = error instanceof Error ? error.message : "network error";
    throw new UpstreamError(message, "network");
  }
  const text = await response.text();
  let message: RpcMessage | null = null;
  if (text.trim()) {
    try {
      message = parseResponseBody(response.headers.get("content-type") ?? "", text) as RpcMessage;
    } catch {
      throw new UpstreamError(`upstream returned unreadable body (HTTP ${response.status})`, "http");
    }
  }
  if (response.status >= 400) {
    const detail = message?.error?.message ?? text.slice(0, 180);
    throw new UpstreamError(`upstream HTTP ${response.status}${detail ? `: ${detail}` : ""}`, "http");
  }
  return {
    status: response.status,
    sessionId: response.headers.get("mcp-session-id") ?? sessionId,
    message,
  };
}

async function withSession<T>(
  target: UpstreamTarget,
  timeoutMs: number,
  fn: (send: (method: string, params: unknown) => Promise<RpcMessage>) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  const budget = () => {
    const left = deadline - Date.now();
    if (left <= 50) throw new UpstreamError(`upstream did not respond within ${timeoutMs}ms`, "timeout");
    return left;
  };
  const init = await post(
    target,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "urumi-gateway", version: "0.1.0" },
      },
    },
    budget(),
  );
  if (init.message?.error) {
    throw new UpstreamError(init.message.error.message ?? "initialize failed", "rpc");
  }
  const sessionId = init.sessionId;
  await post(target, { jsonrpc: "2.0", method: "notifications/initialized" }, budget(), sessionId);
  try {
    return await fn(async (method, params) => {
      const response = await post(target, { jsonrpc: "2.0", id: 2, method, params }, budget(), sessionId);
      if (!response.message) throw new UpstreamError("empty upstream response", "rpc");
      if (response.message.error) {
        throw new UpstreamError(response.message.error.message ?? `${method} failed`, "rpc");
      }
      return response.message;
    });
  } finally {
    if (sessionId) {
      void fetch(target.url, {
        method: "DELETE",
        headers: { ...authHeaders(target), "mcp-session-id": sessionId },
        signal: AbortSignal.timeout(1000),
      }).catch(() => undefined);
    }
  }
}

function normalizeTool(value: unknown): McpTool | null {
  if (!value || typeof value !== "object") return null;
  const tool = value as Partial<McpTool>;
  if (typeof tool.name !== "string" || !tool.name) return null;
  const schema = (tool.inputSchema ?? { type: "object" }) as McpTool["inputSchema"];
  return {
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: {
      type: "object",
      properties: schema.properties ?? {},
      required: schema.required ?? [],
      additionalProperties: schema.additionalProperties ?? false,
    },
  };
}

export async function listUpstreamTools(target: UpstreamTarget, timeoutMs: number): Promise<McpTool[]> {
  return withSession(target, timeoutMs, async (send) => {
    const message = await send("tools/list", {});
    const tools = (message.result as { tools?: unknown } | undefined)?.tools;
    if (!Array.isArray(tools)) throw new UpstreamError("tools/list returned no tools array", "rpc");
    return tools.map(normalizeTool).filter((tool): tool is McpTool => tool !== null);
  });
}

export async function callUpstreamTool(
  target: UpstreamTarget,
  timeoutMs: number,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  return withSession(target, timeoutMs, async (send) => {
    const message = await send("tools/call", { name, arguments: args });
    const result = message.result as McpToolResult | undefined;
    if (!result || !Array.isArray(result.content)) {
      throw new UpstreamError("tools/call returned no content", "rpc");
    }
    return result;
  });
}
