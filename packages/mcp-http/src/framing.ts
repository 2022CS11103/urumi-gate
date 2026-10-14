import type { IncomingMessage, ServerResponse } from "node:http";
import type { JsonRpcId } from "./types.ts";

export const BODY_LIMIT = 1_000_000;

export async function readBody(req: IncomingMessage, limit = BODY_LIMIT): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) {
      throw new Error("request body exceeds 1MB");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function wantsSse(req: IncomingMessage): boolean {
  const accept = String(req.headers.accept ?? "");
  return accept.includes("text/event-stream");
}

export function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

export function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

export function writeRpc(
  res: ServerResponse,
  req: IncomingMessage,
  status: number,
  payload: unknown | null,
): void {
  if (payload === null) {
    res.writeHead(status);
    res.end();
    return;
  }
  const body = JSON.stringify(payload);
  if (status === 200 && wantsSse(req)) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    res.end(`event: message\ndata: ${body}\n\n`);
    return;
  }
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(body);
}

export function parseResponseBody(contentType: string, text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (contentType.includes("text/event-stream")) {
    const data = trimmed
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");
    const last = data.at(-1);
    if (!last) return null;
    return JSON.parse(last);
  }
  return JSON.parse(trimmed);
}
