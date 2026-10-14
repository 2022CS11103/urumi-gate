export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  llm: { mode: "model" | "offline"; model: string | null };
  storeUrl: string;
  storeMode: "fixture" | "woocommerce";
  toolExposure: "flat" | "search";
}

export interface ServerTool {
  name: string;
  upstreamName: string;
  description: string;
  write: boolean;
  allowed: boolean;
  suspicious: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  slug: string;
  url: string | null;
  enabled: boolean;
  allowPrivate: boolean | null;
  authType: "none" | "bearer" | "header" | null;
  authHeaderName: string | null;
  hasCredential: boolean | null;
  writeMinRole: "admin" | "member";
  builtin: boolean;
  status: "connected" | "unreachable" | "disabled";
  lastError: string | null;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  toolsLive: boolean;
  tools: ServerTool[];
}

export interface Member {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  disabled: boolean;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  userEmail: string;
  name: string;
  keyPrefix: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  userEmail: string | null;
  source: "mcp" | "chat";
  serverSlug: string;
  toolName: string;
  startedAt: string;
  durationMs: number;
  success: boolean;
  error: string | null;
}

export interface ToolTrace {
  tool: string;
  server: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  error?: string;
  preview: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  trace: ToolTrace[] | null;
  createdAt: string;
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as { error?: string }) : {};
  if (response.status === 401 && path !== "/api/login") {
    if (!window.location.pathname.startsWith("/login")) window.location.assign("/login");
    throw new ApiError("Sign in required", 401);
  }
  if (!response.ok) throw new ApiError(data.error ?? response.statusText, response.status);
  return data as T;
}

export const api = {
  me: () => request<SessionUser>("/api/me"),
  login: (email: string, password: string) =>
    request<SessionUser>("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST" }),
  servers: () => request<{ servers: McpServer[] }>("/api/servers"),
  createServer: (body: Record<string, unknown>) =>
    request<McpServer>("/api/servers", { method: "POST", body: JSON.stringify(body) }),
  updateServer: (id: string, body: Record<string, unknown>) =>
    request<McpServer>(`/api/servers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteServer: (id: string) => request<{ ok: boolean; restoredOnRestart: boolean }>(`/api/servers/${id}`, { method: "DELETE" }),
  team: () => request<{ users: Member[] }>("/api/team"),
  invite: (body: { email: string; name: string; password: string; role: "admin" | "member" }) =>
    request<Member>("/api/team", { method: "POST", body: JSON.stringify(body) }),
  setDisabled: (id: string, disabled: boolean) =>
    request<{ ok: boolean }>(`/api/team/${id}`, { method: "PATCH", body: JSON.stringify({ disabled }) }),
  keys: () => request<{ keys: ApiKey[] }>("/api/keys"),
  createKey: (body: { name: string; userId?: string }) =>
    request<{ key: ApiKey; secret: string }>("/api/keys", { method: "POST", body: JSON.stringify(body) }),
  revokeKey: (id: string) => request<{ ok: boolean }>(`/api/keys/${id}/revoke`, { method: "POST" }),
  audit: () => request<{ entries: AuditEntry[] }>("/api/audit?limit=100"),
  threads: () => request<{ threads: ChatThread[] }>("/api/chat/threads"),
  thread: (id: string) => request<{ thread: ChatThread; messages: ChatMessage[] }>(`/api/chat/threads/${id}`),
  chat: (body: { message: string; threadId?: string }) =>
    request<{ threadId: string; message: ChatMessage }>("/api/chat", { method: "POST", body: JSON.stringify(body) }),
};
