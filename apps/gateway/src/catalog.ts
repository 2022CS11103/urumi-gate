import { listUpstreamTools, type UpstreamTarget } from "../../../packages/mcp-http/src/index.ts";
import { decryptSecret } from "./crypto.ts";
import type { ServerRecord, ServerStatus, User, VisibleTool } from "./domain.ts";
import { assertSafeUpstreamUrl } from "./ssrf.ts";
import type { Store } from "./store.ts";
import { canUseTool, presentTool } from "./tools.ts";

export function targetFor(server: ServerRecord, key: Buffer): UpstreamTarget {
  if (server.authType === "none") return { url: server.url };
  if (!server.credentialCiphertext) throw new Error("upstream credential is missing");
  let secret: string;
  try {
    secret = decryptSecret(server.credentialCiphertext, key);
  } catch {
    throw new Error("upstream credential could not be decrypted");
  }
  if (server.authType === "bearer") return { url: server.url, bearerToken: secret };
  return { url: server.url, headerName: server.authHeaderName ?? "x-api-key", headerValue: secret };
}

export function assertNotSelf(url: string, selfHosts: string[]): void {
  const host = new URL(url).hostname.toLowerCase();
  if (selfHosts.includes(host)) {
    throw new Error("refusing to call the gateway itself");
  }
}

export async function probeServer(
  store: Store,
  server: ServerRecord,
  key: Buffer,
  timeoutMs: number,
  selfHosts: string[],
): Promise<ServerStatus> {
  const previous = store.getStatus(server.id);
  if (!server.enabled) {
    const status: Omit<ServerStatus, "serverId"> = {
      state: "disabled",
      tools: previous?.tools ?? [],
      lastError: null,
      lastCheckedAt: new Date().toISOString(),
      latencyMs: null,
    };
    store.setStatus(server.id, status);
    return { serverId: server.id, ...status };
  }
  const started = Date.now();
  try {
    await assertSafeUpstreamUrl(server.url, { allowPrivate: server.allowPrivate });
    assertNotSelf(server.url, selfHosts);
    const tools = await listUpstreamTools(targetFor(server, key), timeoutMs);
    const status: Omit<ServerStatus, "serverId"> = {
      state: "connected",
      tools,
      lastError: null,
      lastCheckedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
    };
    store.setStatus(server.id, status);
    return { serverId: server.id, ...status };
  } catch (error) {
    const status: Omit<ServerStatus, "serverId"> = {
      state: "unreachable",
      tools: previous?.tools ?? [],
      lastError: error instanceof Error ? error.message : "probe failed",
      lastCheckedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
    };
    store.setStatus(server.id, status);
    return { serverId: server.id, ...status };
  }
}

export function visibleTools(user: User, servers: ServerRecord[], store: Store): VisibleTool[] {
  const tools: VisibleTool[] = [];
  for (const server of servers) {
    if (!server.enabled) continue;
    const status = store.getStatus(server.id);
    if (!status || status.state !== "connected") continue;
    for (const tool of status.tools) {
      const visible = presentTool(server.name, server.slug, tool);
      if (!canUseTool(user.role, server.writeMinRole, visible.write)) continue;
      tools.push(visible);
    }
  }
  return tools;
}
