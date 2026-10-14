import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import { callUpstreamTool, readBody, rpcError, rpcResult, textResult, writeRpc } from "../../../packages/mcp-http/src/index.ts";
import { probeServer, targetFor, visibleTools } from "./catalog.ts";
import { runChat } from "./chat.ts";
import type { AppConfig } from "./config.ts";
import { encryptSecret, generateApiKey, hashApiKey, hashPassword, readSession, signSession, verifyPassword } from "./crypto.ts";
import type { Role, ServerRecord, ToolTrace, User, VisibleTool } from "./domain.ts";
import { Metrics } from "./metrics.ts";
import { assertSafeUpstreamUrl } from "./ssrf.ts";
import { Store } from "./store.ts";
import { canUseTool, isWriteTool, presentTool, splitTool, suspiciousDescription } from "./tools.ts";

const SESSION_TTL = 60 * 60 * 12;
const SLUG = /^[a-z][a-z0-9_]{0,31}$/;

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Principal {
  user: User;
  apiKeyId: string | null;
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  principal: Principal | null;
}

export interface RunningGateway {
  url: string;
  port: number;
  store: Store;
  close: () => Promise<void>;
}

function log(level: string, msg: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }));
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",").map((part) => part.trim()).filter(Boolean).at(-1) ?? "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function sessionCookie(token: string, secure: boolean, maxAge: number): string {
  return `urumi_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  allow(key: string, limit: number, windowMs = 60_000): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "JSON object required");
  return value as Record<string, unknown>;
}

function roleOf(value: unknown): Role {
  if (value === "admin" || value === "member") return value;
  throw new HttpError(400, "role must be admin or member");
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function serverView(server: ServerRecord, store: Store, user: User) {
  const status = store.getStatus(server.id);
  const live = Boolean(server.enabled && status?.state === "connected");
  return {
    id: server.id,
    name: server.name,
    slug: server.slug,
    url: user.role === "admin" ? server.url : null,
    enabled: server.enabled,
    allowPrivate: user.role === "admin" ? server.allowPrivate : null,
    authType: user.role === "admin" ? server.authType : null,
    authHeaderName: user.role === "admin" ? server.authHeaderName : null,
    hasCredential: user.role === "admin" ? Boolean(server.credentialCiphertext) : null,
    writeMinRole: server.writeMinRole,
    builtin: server.builtin,
    status: server.enabled ? (status?.state ?? "unreachable") : "disabled",
    lastError: status?.lastError ?? null,
    lastCheckedAt: status?.lastCheckedAt ?? null,
    latencyMs: status?.latencyMs ?? null,
    toolsLive: live,
    tools: (status?.tools ?? []).map((tool) => {
      const visible = presentTool(server.name, server.slug, tool);
      return {
        name: visible.name,
        upstreamName: tool.name,
        description: tool.description,
        write: visible.write,
        allowed: canUseTool(user.role, server.writeMinRole, visible.write),
        suspicious: suspiciousDescription(tool.description),
      };
    }),
  };
}

function searchTools(): VisibleTool[] {
  const objectSchema = {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  };
  return [
    {
      name: "find_tools",
      description: "Search the aggregated upstream catalog and return the best matching tool names. Use this before call_tool when you do not already know the name.",
      inputSchema: {
        ...objectSchema,
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      serverSlug: "gateway",
      upstreamName: "find_tools",
      write: false,
    },
    {
      name: "call_tool",
      description: "Execute a tool returned by find_tools. Pass the full prefixed name and the argument object.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          arguments: { type: "object" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      serverSlug: "gateway",
      upstreamName: "call_tool",
      write: false,
    },
  ];
}

export async function startGateway(config: AppConfig): Promise<RunningGateway> {
  const store = Store.open(config.databasePath);
  const metrics = new Metrics();
  const limits = new RateLimiter();
  store.upsertBootstrapUser({
    email: config.admin.email,
    name: config.admin.name,
    passwordHash: hashPassword(config.admin.password),
    role: "admin",
  });
  store.upsertBootstrapUser({
    email: config.member.email,
    name: config.member.name,
    passwordHash: hashPassword(config.member.password),
    role: "member",
  });
  await reconcileBuiltins(store, config);
  ensureDevKeys(store, config);

  const refreshOne = (server: ServerRecord) =>
    probeServer(store, server, config.credentialKey, config.listTimeoutMs, config.selfHosts);

  async function refreshAll(): Promise<void> {
    await Promise.all(store.listServers().map((server) => refreshOne(server)));
  }

  async function freshTools(user: User): Promise<VisibleTool[]> {
    const servers = store.listServers();
    await Promise.all(
      servers.map(async (server) => {
        const status = store.getStatus(server.id);
        const stale = !status?.lastCheckedAt || Date.now() - Date.parse(status.lastCheckedAt) > config.statusIntervalMs;
        if (stale) await refreshOne(server);
      }),
    );
    return visibleTools(user, store.listServers(), store);
  }

  function audit(input: {
    user: User;
    apiKeyId: string | null;
    source: "mcp" | "chat";
    server: string;
    tool: string;
    startedAt: string;
    durationMs: number;
    ok: boolean;
    error?: string;
  }): void {
    store.insertAudit({
      userId: input.user.id,
      userEmail: input.user.email,
      apiKeyId: input.apiKeyId,
      source: input.source,
      serverSlug: input.server,
      toolName: input.tool,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      success: input.ok,
      error: input.error ?? null,
    });
    metrics.hit(input.server, input.tool, input.ok ? "ok" : "error");
    log("info", "tool call", {
      user: input.user.email,
      source: input.source,
      server: input.server,
      tool: input.tool,
      ok: input.ok,
      durationMs: input.durationMs,
    });
  }

  async function invoke(
    principal: Principal,
    source: "mcp" | "chat",
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolTrace> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const finish = (server: string, ok: boolean, preview: string, error?: string, reportedTool = toolName): ToolTrace => {
      const durationMs = Date.now() - started;
      audit({
        user: principal.user,
        apiKeyId: principal.apiKeyId,
        source,
        server,
        tool: reportedTool,
        startedAt,
        durationMs,
        ok,
        error,
      });
      return { tool: reportedTool, server, arguments: args, ok, durationMs, error, preview: preview.slice(0, 1200) };
    };

    if (JSON.stringify(args).length > 100_000) {
      return finish("gateway", false, "arguments are too large", "arguments are too large");
    }

    if (toolName === "find_tools") {
      const query = str(args.query)?.toLowerCase() ?? "";
      const terms = query.split(/\s+/).filter(Boolean);
      const matches = visibleTools(principal.user, store.listServers(), store)
        .map((tool) => {
          const haystack = `${tool.name} ${tool.description}`.toLowerCase();
          const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
          return { tool, score };
        })
        .filter((item) => terms.length === 0 || item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
      const text = matches.length
        ? matches.map((item) => `${item.tool.name} — ${item.tool.description.slice(0, 180)}`).join("\n")
        : "No tools matched.";
      return finish("gateway", true, text);
    }

    let resolvedName = toolName;
    let resolvedArgs = args;
    if (toolName === "call_tool") {
      const name = str(args.name);
      if (!name) return finish("gateway", false, "call_tool requires a name", "call_tool requires a name");
      resolvedName = name;
      const nested = args.arguments;
      resolvedArgs = nested && typeof nested === "object" && !Array.isArray(nested) ? (nested as Record<string, unknown>) : {};
    }

    const parsed = splitTool(resolvedName);
    if (!parsed) {
      return finish("gateway", false, `unknown tool ${resolvedName}`, `unknown tool ${resolvedName}`, resolvedName);
    }
    const server = store.getServerBySlug(parsed.slug);
    if (!server) return finish(parsed.slug, false, `unknown server ${parsed.slug}`, "unknown server", resolvedName);
    if (!server.enabled) return finish(server.slug, false, `server ${server.slug} is disabled`, "disabled", resolvedName);
    const status = store.getStatus(server.id);
    const upstream = status?.tools.find((tool) => tool.name === parsed.tool);
    if (!upstream || status?.state !== "connected") {
      const reason = status?.lastError ? `server ${server.slug} is unreachable: ${status.lastError}` : `server ${server.slug} is unreachable`;
      return finish(server.slug, false, reason, reason, resolvedName);
    }
    if (!canUseTool(principal.user.role, server.writeMinRole, isWriteTool(parsed.tool))) {
      const reason = `tool ${resolvedName} changes data and is limited to ${server.writeMinRole}s`;
      return finish(server.slug, false, reason, reason, resolvedName);
    }
    try {
      await assertSafeUpstreamUrl(server.url, { allowPrivate: server.allowPrivate });
      const result = await callUpstreamTool(targetFor(server, config.credentialKey), config.upstreamTimeoutMs, parsed.tool, resolvedArgs);
      const text = result.content.map((item) => item.text).join("\n");
      const ok = !result.isError;
      return finish(server.slug, ok, text, ok ? undefined : text, resolvedName);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "upstream call failed";
      const kind = (error as { kind?: string }).kind;
      if (kind === "timeout" || kind === "network") {
        store.setStatus(server.id, {
          state: "unreachable",
          tools: status.tools,
          lastError: reason,
          lastCheckedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
        });
      }
      return finish(server.slug, false, `server ${server.slug} failed: ${reason}. Other servers are unaffected.`, reason, resolvedName);
    }
  }

  function requireUser(ctx: Ctx): Principal {
    if (!ctx.principal) throw new HttpError(401, "sign in required");
    return ctx.principal;
  }

  function requireAdmin(ctx: Ctx): Principal {
    const principal = requireUser(ctx);
    if (principal.user.role !== "admin") throw new HttpError(403, "admin role required");
    return principal;
  }

  async function parseServerDraft(body: Record<string, unknown>, current?: ServerRecord): Promise<Omit<ServerRecord, "id" | "createdAt" | "updatedAt" | "builtin">> {
    const name = str(body.name) ?? current?.name;
    const slug = str(body.slug) ?? current?.slug;
    const url = str(body.url) ?? current?.url;
    if (!name || name.length > 80) throw new HttpError(400, "name must be 1-80 characters");
    if (!slug || !SLUG.test(slug)) throw new HttpError(400, "slug must match ^[a-z][a-z0-9_]{0,31}$");
    if (!url || url.length > 500) throw new HttpError(400, "url is required");
    const authType = (str(body.authType) ?? current?.authType ?? "none") as ServerRecord["authType"];
    if (authType !== "none" && authType !== "bearer" && authType !== "header") {
      throw new HttpError(400, "authType must be none, bearer, or header");
    }
    const allowPrivate = typeof body.allowPrivate === "boolean" ? body.allowPrivate : (current?.allowPrivate ?? false);
    const writeMinRole = body.writeMinRole === undefined ? (current?.writeMinRole ?? "admin") : roleOf(body.writeMinRole);
    const enabled = typeof body.enabled === "boolean" ? body.enabled : (current?.enabled ?? true);
    let authHeaderName = body.authHeaderName === undefined ? current?.authHeaderName ?? null : str(body.authHeaderName) ?? null;
    if (authType === "header") {
      if (!authHeaderName || !/^[A-Za-z0-9-]{1,40}$/.test(authHeaderName)) {
        throw new HttpError(400, "authHeaderName must be 1-40 letters, digits, or hyphens");
      }
    } else {
      authHeaderName = null;
    }
    await assertSafeUpstreamUrl(url, { allowPrivate });
    const host = new URL(url).hostname.toLowerCase();
    if (config.selfHosts.includes(host)) throw new HttpError(400, "the gateway URL cannot be registered as an upstream");

    let credentialCiphertext = current?.credentialCiphertext ?? null;
    if (typeof body.credential === "string") {
      credentialCiphertext = body.credential ? encryptSecret(body.credential, config.credentialKey) : null;
    }
    if (authType === "none") credentialCiphertext = null;
    if (authType !== "none" && !credentialCiphertext) throw new HttpError(400, "a credential is required for this auth type");
    return { name, slug, url, authType, authHeaderName, credentialCiphertext, enabled, allowPrivate, writeMinRole };
  }

  const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: (ctx: Ctx) => Promise<void> }> = [];
  const route = (method: string, path: string, handler: (ctx: Ctx) => Promise<void>) => {
    const keys: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:([A-Za-z]+)/g, (_match, key) => { keys.push(key); return "([^/]+)"; })}$`);
    routes.push({ method, pattern, keys, handler });
  };

  route("GET", "/healthz", async ({ res }) => {
    send(res, 200, { ok: true });
  });
  route("GET", "/readyz", async ({ res }) => {
    store.ping();
    send(res, 200, { ok: true });
  });
  route("GET", "/metrics", async ({ res }) => {
    const body = metrics.render(
      store.listServers().map((server) => {
        const status = store.getStatus(server.id);
        return { slug: server.slug, state: server.enabled ? (status?.state ?? "unreachable") : "disabled", latencyMs: status?.latencyMs ?? null };
      }),
    );
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    res.end(body);
  });

  route("POST", "/api/login", async ({ req, res }) => {
    if (!limits.allow(`login:${clientIp(req)}`, 10)) throw new HttpError(429, "too many sign-in attempts");
    const body = asObject(await readJson(req));
    const email = str(body.email)?.toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const user = email ? store.getUserByEmail(email) : null;
    const passwordHash = email ? store.getPasswordHash(email) : null;
    if (!user || !passwordHash || !verifyPassword(password, passwordHash) || user.disabled) {
      throw new HttpError(401, "invalid email or password");
    }
    const token = signSession({ sub: user.id, email: user.email, role: user.role }, config.sessionSecret, SESSION_TTL);
    send(res, 200, { id: user.id, email: user.email, name: user.name, role: user.role }, {
      "set-cookie": sessionCookie(token, config.cookieSecure, SESSION_TTL),
    });
  });

  route("POST", "/api/logout", async ({ res }) => {
    send(res, 200, { ok: true }, { "set-cookie": sessionCookie("", config.cookieSecure, 0) });
  });

  route("GET", "/api/me", async (ctx) => {
    const { user } = requireUser(ctx);
    send(ctx.res, 200, {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      llm: {
        mode: config.llm.apiKey ? "model" : "offline",
        model: config.llm.apiKey ? config.llm.model : null,
      },
      storeUrl: config.publicStoreUrl,
      storeMode: config.storeMode,
      toolExposure: config.toolExposure,
    });
  });

  route("GET", "/api/servers", async (ctx) => {
    const { user } = requireUser(ctx);
    send(ctx.res, 200, { servers: store.listServers().map((server) => serverView(server, store, user)) });
  });

  route("POST", "/api/servers", async (ctx) => {
    const { user } = requireAdmin(ctx);
    const draft = await parseServerDraft(asObject(await readJson(ctx.req)));
    if (store.getServerBySlug(draft.slug)) throw new HttpError(409, "slug is already in use");
    const created = store.insertServer({ ...draft, builtin: false });
    await refreshOne(created);
    send(ctx.res, 201, serverView(created, store, user));
  });

  route("PATCH", "/api/servers/:id", async (ctx) => {
    const { user } = requireAdmin(ctx);
    const current = store.getServer(ctx.params.id ?? "");
    if (!current) throw new HttpError(404, "server not found");
    const draft = await parseServerDraft(asObject(await readJson(ctx.req)), current);
    if (draft.slug !== current.slug && store.getServerBySlug(draft.slug)) throw new HttpError(409, "slug is already in use");
    const updated = store.updateServer(current.id, draft);
    await refreshOne(updated);
    send(ctx.res, 200, serverView(updated, store, user));
  });

  route("DELETE", "/api/servers/:id", async (ctx) => {
    requireAdmin(ctx);
    const current = store.getServer(ctx.params.id ?? "");
    if (!current) throw new HttpError(404, "server not found");
    store.deleteServer(current.id);
    send(ctx.res, 200, { ok: true, restoredOnRestart: current.builtin });
  });

  route("GET", "/api/team", async (ctx) => {
    requireAdmin(ctx);
    send(ctx.res, 200, {
      users: store.listUsers().map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        disabled: user.disabled,
        createdAt: user.createdAt,
      })),
    });
  });

  route("POST", "/api/team", async (ctx) => {
    requireAdmin(ctx);
    const body = asObject(await readJson(ctx.req));
    const email = str(body.email)?.toLowerCase();
    const name = str(body.name);
    const password = typeof body.password === "string" ? body.password : "";
    const role = roleOf(body.role ?? "member");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "a valid email is required");
    if (!name || name.length > 80) throw new HttpError(400, "name must be 1-80 characters");
    if (password.length < 8) throw new HttpError(400, "password must be at least 8 characters");
    if (store.getUserByEmail(email)) throw new HttpError(409, "that email is already a member");
    const user = store.createUser({ email, name, role, passwordHash: hashPassword(password) });
    send(ctx.res, 201, { id: user.id, email: user.email, name: user.name, role: user.role });
  });

  route("PATCH", "/api/team/:id", async (ctx) => {
    const { user } = requireAdmin(ctx);
    const target = store.getUserById(ctx.params.id ?? "");
    if (!target) throw new HttpError(404, "member not found");
    const body = asObject(await readJson(ctx.req));
    if (typeof body.disabled !== "boolean") throw new HttpError(400, "disabled boolean is required");
    if (target.id === user.id && body.disabled) throw new HttpError(400, "you cannot disable your own account");
    store.setUserDisabled(target.id, body.disabled);
    send(ctx.res, 200, { ok: true });
  });

  route("GET", "/api/keys", async (ctx) => {
    const { user } = requireUser(ctx);
    const keys = store.listKeys(user.role === "admin" ? undefined : user.id);
    send(ctx.res, 200, { keys });
  });

  route("POST", "/api/keys", async (ctx) => {
    const { user } = requireUser(ctx);
    const body = asObject(await readJson(ctx.req));
    const name = str(body.name) ?? "default";
    if (name.length > 60) throw new HttpError(400, "key name must be 60 characters or fewer");
    let owner = user;
    if (body.userId !== undefined) {
      if (user.role !== "admin") throw new HttpError(403, "only admins can issue keys for someone else");
      const found = store.getUserById(String(body.userId));
      if (!found) throw new HttpError(404, "member not found");
      owner = found;
    }
    if (!limits.allow(`keys:${user.id}`, 20)) throw new HttpError(429, "too many keys issued");
    const generated = generateApiKey();
    const record = store.insertKey({ userId: owner.id, name, hash: generated.hash, prefix: generated.prefix });
    send(ctx.res, 201, { key: record, secret: generated.plaintext });
  });

  route("POST", "/api/keys/:id/revoke", async (ctx) => {
    const { user } = requireUser(ctx);
    const key = store.getKeyById(ctx.params.id ?? "");
    if (!key) throw new HttpError(404, "key not found");
    if (user.role !== "admin" && key.userId !== user.id) throw new HttpError(403, "you can only revoke your own keys");
    store.revokeKey(key.id);
    send(ctx.res, 200, { ok: true });
  });

  route("GET", "/api/audit", async (ctx) => {
    const { user } = requireUser(ctx);
    const limit = Math.min(200, Math.max(1, Number(ctx.url.searchParams.get("limit") ?? 50)));
    const offset = Math.max(0, Number(ctx.url.searchParams.get("offset") ?? 0));
    const entries = store.listAudit({ userId: user.role === "admin" ? undefined : user.id, limit, offset });
    send(ctx.res, 200, { entries });
  });

  route("GET", "/api/chat/threads", async (ctx) => {
    const { user } = requireUser(ctx);
    send(ctx.res, 200, { threads: store.listThreads(user.id) });
  });

  route("GET", "/api/chat/threads/:id", async (ctx) => {
    const { user } = requireUser(ctx);
    const thread = store.getThread(ctx.params.id ?? "", user.id);
    if (!thread) throw new HttpError(404, "thread not found");
    send(ctx.res, 200, { thread, messages: store.listMessages(thread.id) });
  });

  route("POST", "/api/chat", async (ctx) => {
    const principal = requireUser(ctx);
    if (!limits.allow(`chat:${principal.user.id}`, config.rateLimitPerMinute)) {
      throw new HttpError(429, "rate limit exceeded");
    }
    const body = asObject(await readJson(ctx.req));
    const message = str(body.message);
    if (!message || message.length > 4000) throw new HttpError(400, "message must be 1-4000 characters");
    let thread = typeof body.threadId === "string" ? store.getThread(body.threadId, principal.user.id) : null;
    if (typeof body.threadId === "string" && !thread) throw new HttpError(404, "thread not found");
    if (!thread) thread = store.createThread(principal.user.id, message.replace(/\s+/g, " ").slice(0, 80));
    const history = store.listMessages(thread.id).map((item) => ({ role: item.role, content: item.content }));
    store.addMessage({ threadId: thread.id, role: "user", content: message, trace: null });
    const catalog = await freshTools(principal.user);
    const offered = config.llm.apiKey && config.toolExposure === "search" ? searchTools() : catalog;
    let result: { content: string; trace: ToolTrace[] };
    try {
      result = await runChat({
        llm: config.llm,
        user: principal.user,
        history,
        message,
        tools: offered,
        callTool: async (name, args) => {
          const trace = await invoke(principal, "chat", name, args);
          return { text: trace.preview, ok: trace.ok, durationMs: trace.durationMs, server: trace.server, error: trace.error };
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "chat failed";
      throw new HttpError(502, reason);
    }
    const saved = store.addMessage({ threadId: thread.id, role: "assistant", content: result.content, trace: result.trace });
    send(ctx.res, 200, { threadId: thread.id, message: saved });
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/mcp") {
      await handleMcp(req, res);
      return;
    }
    try {
      const principal = principalFromCookie(req);
      const match = routes.find((candidate) => candidate.method === req.method && candidate.pattern.test(url.pathname));
      if (!match) {
        send(res, 404, { error: "not found" });
        return;
      }
      const found = match.pattern.exec(url.pathname);
      const params: Record<string, string> = {};
      match.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(found?.[index + 1] ?? "");
      });
      await match.handler({ req, res, url, params, principal });
    } catch (error) {
      if (error instanceof HttpError) {
        send(res, error.status, { error: error.message });
        return;
      }
      log("error", "request failed", { err: error instanceof Error ? error.message : "unknown" });
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    }
  });

  function principalFromCookie(req: IncomingMessage): Principal | null {
    const token = readCookie(req.headers.cookie, "urumi_session");
    if (!token) return null;
    const claims = readSession(token, config.sessionSecret);
    if (!claims) return null;
    const user = store.getUserById(claims.sub);
    if (!user || user.disabled) return null;
    return { user, apiKeyId: null };
  }

  function principalFromBearer(req: IncomingMessage): Principal | null {
    const header = req.headers.authorization ?? "";
    const match = header.match(/^Bearer\s+(.+)$/);
    if (!match?.[1]) return null;
    const found = store.getKeyByHash(hashApiKey(match[1].trim()));
    if (!found || found.key.revokedAt || found.user.disabled) return null;
    return { user: found.user, apiKeyId: found.key.id };
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
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
      const principal = principalFromBearer(req);
      if (!principal) {
        writeRpc(res, req, 401, rpcError(null, -32001, "a valid API key is required"));
        return;
      }
      if (!limits.allow(`mcp:${principal.user.id}`, config.rateLimitPerMinute)) {
        writeRpc(res, req, 429, rpcError(null, -32029, "rate limit exceeded"));
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
        const result = await gatewayRpc(principal, message);
        if (result) results.push(result);
      }
      if (results.length === 0) {
        writeRpc(res, req, 202, null);
        return;
      }
      writeRpc(res, req, 200, Array.isArray(parsed) ? results : results[0]);
    } catch (error) {
      log("error", "mcp failed", { err: error instanceof Error ? error.message : "unknown" });
      if (!res.headersSent) writeRpc(res, req, 500, rpcError(null, -32603, "internal error"));
    }
  }

  async function gatewayRpc(principal: Principal, message: unknown) {
    const rpc = (message ?? {}) as { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };
    const id = rpc.id ?? null;
    if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return rpcError(id, -32600, "invalid request");
    if (rpc.method === "notifications/initialized" || rpc.method === "notifications/cancelled") return null;
    if (rpc.id === undefined) return null;
    if (rpc.method === "initialize") {
      const params = (rpc.params ?? {}) as { protocolVersion?: string };
      const requested = params.protocolVersion ?? "2025-03-26";
      const supported = ["2024-11-05", "2025-03-26", "2025-06-18"];
      return rpcResult(id, {
        protocolVersion: supported.includes(requested) ? requested : "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "urumi-gateway", version: "0.1.0" },
        instructions:
          "Tools from every enabled upstream are prefixed with the server slug, for example woocommerce__list_orders. Two servers can expose the same upstream name; the prefix keeps them distinct. Write tools may be hidden for your role.",
      });
    }
    if (rpc.method === "ping") return rpcResult(id, {});
    if (rpc.method === "tools/list") {
      const catalog = await freshTools(principal.user);
      const tools = (config.toolExposure === "search" ? searchTools() : catalog).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      return rpcResult(id, { tools });
    }
    if (rpc.method === "tools/call") {
      const params = (rpc.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!params.name) return rpcError(id, -32602, "tools/call requires a name");
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      const trace = await invoke(principal, "mcp", params.name, args);
      return rpcResult(id, textResult(trace.preview, !trace.ok));
    }
    return rpcError(id, -32601, `method not found: ${rpc.method}`);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });
  await refreshAll();
  const timer = setInterval(() => {
    void refreshAll().catch((error: unknown) => log("error", "status refresh failed", { err: error instanceof Error ? error.message : "unknown" }));
  }, config.statusIntervalMs);
  timer.unref?.();
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  const advertised = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
  log("info", "gateway listening", { url: `http://${advertised}:${port}` });

  return {
    url: `http://${advertised}:${port}`,
    port,
    store,
    close: async () => {
      clearInterval(timer);
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      store.close();
    },
  };
}

async function reconcileBuiltins(store: Store, config: AppConfig): Promise<void> {
  for (const builtin of config.builtins) {
    await assertSafeUpstreamUrl(builtin.url, { allowPrivate: true });
    const ciphertext = builtin.token ? encryptSecret(builtin.token, config.credentialKey) : null;
    const existing = store.getServerBySlug(builtin.slug);
    if (!existing) {
      store.insertServer({
        name: builtin.name,
        slug: builtin.slug,
        url: builtin.url,
        authType: builtin.token ? "bearer" : "none",
        authHeaderName: null,
        credentialCiphertext: ciphertext,
        enabled: true,
        allowPrivate: true,
        writeMinRole: builtin.writeMinRole,
        builtin: true,
      });
      continue;
    }
    store.updateServer(existing.id, {
      name: builtin.name,
      url: builtin.url,
      authType: builtin.token ? "bearer" : "none",
      authHeaderName: null,
      credentialCiphertext: ciphertext,
      allowPrivate: true,
    });
  }
}

function ensureDevKeys(store: Store, config: AppConfig): void {
  if (!config.devKeyFile) return;
  if (existsSync(config.devKeyFile)) {
    const lines = readFileSync(config.devKeyFile, "utf8").split("\n").filter(Boolean);
    const hashes = lines.map((line) => hashApiKey(line.split(" ").at(-1) ?? ""));
    if (hashes.length >= 2 && hashes.every((hash) => store.getKeyByHash(hash))) return;
  }
  const lines: string[] = [];
  for (const email of [config.admin.email, config.member.email]) {
    const user = store.getUserByEmail(email);
    if (!user) continue;
    const generated = generateApiKey();
    store.insertKey({ userId: user.id, name: "dev", hash: generated.hash, prefix: generated.prefix });
    lines.push(`${user.role} ${user.email} ${generated.plaintext}`);
  }
  mkdirSync(dirname(config.devKeyFile), { recursive: true });
  writeFileSync(config.devKeyFile, `${lines.join("\n")}\n`, { mode: 0o600 });
}
