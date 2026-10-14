import type { McpTool } from "../../../packages/mcp-http/src/index.ts";

export type Role = "admin" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  userEmail: string;
  name: string;
  keyPrefix: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface ServerRecord {
  id: string;
  name: string;
  slug: string;
  url: string;
  authType: "none" | "bearer" | "header";
  authHeaderName: string | null;
  credentialCiphertext: string | null;
  enabled: boolean;
  allowPrivate: boolean;
  writeMinRole: Role;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServerStatus {
  serverId: string;
  state: "connected" | "unreachable" | "disabled";
  tools: McpTool[];
  lastError: string | null;
  lastCheckedAt: string | null;
  latencyMs: number | null;
}

export interface AuditRecord {
  id: string;
  userId: string | null;
  userEmail: string | null;
  apiKeyId: string | null;
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

export interface ChatThread {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  trace: ToolTrace[] | null;
  createdAt: string;
}

export interface VisibleTool {
  name: string;
  description: string;
  inputSchema: McpTool["inputSchema"];
  serverSlug: string;
  upstreamName: string;
  write: boolean;
}
