import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { McpTool } from "../../../packages/mcp-http/src/index.ts";
import type {
  ApiKeyRecord,
  AuditRecord,
  ChatMessage,
  ChatThread,
  Role,
  ServerRecord,
  ServerStatus,
  ToolTrace,
  User,
} from "./domain.ts";

function now(): string {
  return new Date().toISOString();
}

function bool(value: unknown): boolean {
  return Number(value) === 1;
}

type Row = Record<string, unknown>;

function userFrom(row: Row | undefined): User | null {
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: row.role === "admin" ? "admin" : "member",
    disabled: bool(row.disabled),
    createdAt: String(row.created_at),
  };
}

function serverFrom(row: Row): ServerRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    url: String(row.url),
    authType: row.auth_type === "bearer" || row.auth_type === "header" ? row.auth_type : "none",
    authHeaderName: row.auth_header_name ? String(row.auth_header_name) : null,
    credentialCiphertext: row.credential_ciphertext ? String(row.credential_ciphertext) : null,
    enabled: bool(row.enabled),
    allowPrivate: bool(row.allow_private),
    writeMinRole: row.write_min_role === "member" ? "member" : "admin",
    builtin: bool(row.builtin),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class Store {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(path: string): Store {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys = ON;");
    if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
    const store = new Store(db);
    store.migrate();
    return store;
  }

  close(): void {
    this.db.close();
  }

  ping(): void {
    this.db.prepare("SELECT 1 AS ok").get();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        auth_type TEXT NOT NULL,
        auth_header_name TEXT,
        credential_ciphertext TEXT,
        enabled INTEGER NOT NULL,
        allow_private INTEGER NOT NULL,
        write_min_role TEXT NOT NULL,
        builtin INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS server_status (
        server_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        tools_json TEXT NOT NULL,
        last_error TEXT,
        last_checked_at TEXT,
        latency_ms INTEGER,
        FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        user_email TEXT,
        api_key_id TEXT,
        source TEXT NOT NULL,
        server_slug TEXT,
        tool_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_started ON audit_log(started_at DESC);
      CREATE TABLE IF NOT EXISTS chat_threads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        trace_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  upsertBootstrapUser(input: { email: string; name: string; passwordHash: string; role: Role }): User {
    const email = input.email.toLowerCase();
    const existing = this.getUserByEmail(email);
    if (!existing) {
      this.db
        .prepare("INSERT INTO users (id, email, name, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
        .run(randomUUID(), email, input.name, input.passwordHash, input.role, now());
    } else {
      this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(input.passwordHash, existing.id);
    }
    return this.getUserByEmail(email) as User;
  }

  createUser(input: { email: string; name: string; passwordHash: string; role: Role }): User {
    const email = input.email.toLowerCase();
    this.db
      .prepare("INSERT INTO users (id, email, name, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
      .run(randomUUID(), email, input.name, input.passwordHash, input.role, now());
    return this.getUserByEmail(email) as User;
  }

  getUserByEmail(email: string): User | null {
    return userFrom(this.db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as Row | undefined);
  }

  getPasswordHash(email: string): string | null {
    const row = this.db.prepare("SELECT password_hash FROM users WHERE email = ?").get(email.toLowerCase()) as Row | undefined;
    return row?.password_hash ? String(row.password_hash) : null;
  }

  getUserById(id: string): User | null {
    return userFrom(this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined);
  }

  listUsers(): User[] {
    return (this.db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as Row[]).map((row) => userFrom(row) as User);
  }

  setUserDisabled(id: string, disabled: boolean): void {
    this.db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, id);
  }

  insertKey(input: { userId: string; name: string; hash: string; prefix: string }): ApiKeyRecord {
    const id = randomUUID();
    const createdAt = now();
    this.db
      .prepare("INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)")
      .run(id, input.userId, input.name, input.hash, input.prefix, createdAt);
    return this.getKeyById(id) as ApiKeyRecord;
  }

  getKeyByHash(hash: string): { key: ApiKeyRecord; user: User } | null {
    const row = this.db
      .prepare(
        `SELECT api_keys.*, users.email AS user_email, users.name AS user_name, users.role AS user_role,
                users.disabled AS user_disabled, users.created_at AS user_created_at, users.password_hash AS user_password_hash
         FROM api_keys JOIN users ON users.id = api_keys.user_id WHERE api_keys.key_hash = ?`,
      )
      .get(hash) as Row | undefined;
    if (!row) return null;
    return { key: keyFrom(row), user: userFromJoined(row) };
  }

  getKeyById(id: string): ApiKeyRecord | null {
    const row = this.db
      .prepare(
        `SELECT api_keys.*, users.email AS user_email FROM api_keys
         JOIN users ON users.id = api_keys.user_id WHERE api_keys.id = ?`,
      )
      .get(id) as Row | undefined;
    return row ? keyFrom(row) : null;
  }

  listKeys(userId?: string): ApiKeyRecord[] {
    const rows = this.db
      .prepare(
        `SELECT api_keys.*, users.email AS user_email FROM api_keys
         JOIN users ON users.id = api_keys.user_id
         WHERE (? IS NULL OR api_keys.user_id = ?)
         ORDER BY api_keys.created_at DESC`,
      )
      .all(userId ?? null, userId ?? null) as Row[];
    return rows.map(keyFrom);
  }

  revokeKey(id: string): boolean {
    const result = this.db
      .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(now(), id);
    return Number(result.changes) > 0;
  }

  listServers(): ServerRecord[] {
    return (this.db.prepare("SELECT * FROM mcp_servers ORDER BY created_at ASC").all() as Row[]).map(serverFrom);
  }

  getServer(id: string): ServerRecord | null {
    const row = this.db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as Row | undefined;
    return row ? serverFrom(row) : null;
  }

  getServerBySlug(slug: string): ServerRecord | null {
    const row = this.db.prepare("SELECT * FROM mcp_servers WHERE slug = ?").get(slug) as Row | undefined;
    return row ? serverFrom(row) : null;
  }

  insertServer(input: Omit<ServerRecord, "id" | "createdAt" | "updatedAt">): ServerRecord {
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO mcp_servers (
          id, name, slug, url, auth_type, auth_header_name, credential_ciphertext,
          enabled, allow_private, write_min_role, builtin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.slug,
        input.url,
        input.authType,
        input.authHeaderName,
        input.credentialCiphertext,
        input.enabled ? 1 : 0,
        input.allowPrivate ? 1 : 0,
        input.writeMinRole,
        input.builtin ? 1 : 0,
        timestamp,
        timestamp,
      );
    return this.getServer(id) as ServerRecord;
  }

  updateServer(id: string, patch: Partial<Omit<ServerRecord, "id" | "createdAt" | "builtin">>): ServerRecord {
    const current = this.getServer(id);
    if (!current) throw new Error("server not found");
    const next = { ...current, ...patch, updatedAt: now() };
    this.db
      .prepare(
        `UPDATE mcp_servers SET name = ?, slug = ?, url = ?, auth_type = ?, auth_header_name = ?,
         credential_ciphertext = ?, enabled = ?, allow_private = ?, write_min_role = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.name,
        next.slug,
        next.url,
        next.authType,
        next.authHeaderName,
        next.credentialCiphertext,
        next.enabled ? 1 : 0,
        next.allowPrivate ? 1 : 0,
        next.writeMinRole,
        next.updatedAt,
        id,
      );
    return this.getServer(id) as ServerRecord;
  }

  deleteServer(id: string): void {
    this.db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
  }

  setStatus(serverId: string, status: Omit<ServerStatus, "serverId">): void {
    this.db
      .prepare(
        `INSERT INTO server_status (server_id, state, tools_json, last_error, last_checked_at, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id) DO UPDATE SET
           state = excluded.state,
           tools_json = excluded.tools_json,
           last_error = excluded.last_error,
           last_checked_at = excluded.last_checked_at,
           latency_ms = excluded.latency_ms`,
      )
      .run(serverId, status.state, JSON.stringify(status.tools), status.lastError, status.lastCheckedAt, status.latencyMs);
  }

  getStatus(serverId: string): ServerStatus | null {
    const row = this.db.prepare("SELECT * FROM server_status WHERE server_id = ?").get(serverId) as Row | undefined;
    if (!row) return null;
    let tools: McpTool[] = [];
    try {
      const parsed = JSON.parse(String(row.tools_json));
      if (Array.isArray(parsed)) tools = parsed as McpTool[];
    } catch {
      tools = [];
    }
    const state = row.state === "connected" || row.state === "unreachable" || row.state === "disabled" ? row.state : "unreachable";
    return {
      serverId,
      state,
      tools,
      lastError: row.last_error ? String(row.last_error) : null,
      lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
      latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
    };
  }

  insertAudit(input: Omit<AuditRecord, "id">): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (
          id, user_id, user_email, api_key_id, source, server_slug, tool_name, started_at, duration_ms, success, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.userId,
        input.userEmail,
        input.apiKeyId,
        input.source,
        input.serverSlug,
        input.toolName,
        input.startedAt,
        input.durationMs,
        input.success ? 1 : 0,
        input.error,
      );
  }

  listAudit(options: { userId?: string; limit: number; offset: number }): AuditRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_log WHERE (? IS NULL OR user_id = ?)
         ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      )
      .all(options.userId ?? null, options.userId ?? null, options.limit, options.offset) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      userId: row.user_id ? String(row.user_id) : null,
      userEmail: row.user_email ? String(row.user_email) : null,
      apiKeyId: row.api_key_id ? String(row.api_key_id) : null,
      source: row.source === "chat" ? "chat" : "mcp",
      serverSlug: String(row.server_slug ?? ""),
      toolName: String(row.tool_name),
      startedAt: String(row.started_at),
      durationMs: Number(row.duration_ms),
      success: bool(row.success),
      error: row.error ? String(row.error) : null,
    }));
  }

  createThread(userId: string, title: string): ChatThread {
    const thread = { id: randomUUID(), userId, title: title.slice(0, 80), createdAt: now() };
    this.db
      .prepare("INSERT INTO chat_threads (id, user_id, title, created_at) VALUES (?, ?, ?, ?)")
      .run(thread.id, thread.userId, thread.title, thread.createdAt);
    return thread;
  }

  listThreads(userId: string): ChatThread[] {
    return (this.db.prepare("SELECT * FROM chat_threads WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Row[]).map(
      (row) => ({
        id: String(row.id),
        userId: String(row.user_id),
        title: String(row.title),
        createdAt: String(row.created_at),
      }),
    );
  }

  getThread(id: string, userId: string): ChatThread | null {
    const row = this.db.prepare("SELECT * FROM chat_threads WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
    if (!row) return null;
    return { id: String(row.id), userId: String(row.user_id), title: String(row.title), createdAt: String(row.created_at) };
  }

  addMessage(input: { threadId: string; role: "user" | "assistant"; content: string; trace: ToolTrace[] | null }): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      trace: input.trace,
      createdAt: now(),
    };
    this.db
      .prepare("INSERT INTO chat_messages (id, thread_id, role, content, trace_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(message.id, message.threadId, message.role, message.content, message.trace ? JSON.stringify(message.trace) : null, message.createdAt);
    return message;
  }

  listMessages(threadId: string): ChatMessage[] {
    const rows = this.db.prepare("SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC").all(threadId) as Row[];
    return rows.map((row) => {
      let trace: ToolTrace[] | null = null;
      if (row.trace_json) {
        try {
          const parsed = JSON.parse(String(row.trace_json));
          if (Array.isArray(parsed)) trace = parsed as ToolTrace[];
        } catch {
          trace = null;
        }
      }
      return {
        id: String(row.id),
        threadId: String(row.thread_id),
        role: row.role === "assistant" ? "assistant" : "user",
        content: String(row.content),
        trace,
        createdAt: String(row.created_at),
      };
    });
  }
}

function keyFrom(row: Row): ApiKeyRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    userEmail: String(row.user_email ?? ""),
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    createdAt: String(row.created_at),
  };
}

function userFromJoined(row: Row): User {
  return {
    id: String(row.user_id),
    email: String(row.user_email),
    name: String(row.user_name),
    role: row.user_role === "admin" ? "admin" : "member",
    disabled: bool(row.user_disabled),
    createdAt: String(row.user_created_at),
  };
}
