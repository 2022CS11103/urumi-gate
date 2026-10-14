import { parseCredentialKey } from "./crypto.ts";
import type { Role } from "./domain.ts";

export interface BuiltinServer {
  name: string;
  slug: string;
  url: string;
  token?: string;
  writeMinRole: Role;
}

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  credentialKey: Buffer;
  sessionSecret: string;
  cookieSecure: boolean;
  admin: { email: string; name: string; password: string };
  member: { email: string; name: string; password: string };
  builtins: BuiltinServer[];
  llm: { baseUrl: string; apiKey: string; model: string };
  toolExposure: "flat" | "search";
  publicStoreUrl: string;
  storeMode: "fixture" | "woocommerce";
  selfHosts: string[];
  upstreamTimeoutMs: number;
  listTimeoutMs: number;
  rateLimitPerMinute: number;
  devKeyFile?: string;
  statusIntervalMs: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function builtin(
  env: NodeJS.ProcessEnv,
  name: string,
  slug: string,
  urlKey: string,
  tokenKey: string,
  writeMinRole: Role,
): BuiltinServer | null {
  if (!env[urlKey]) return null;
  return { name, slug, url: env[urlKey] as string, token: env[tokenKey] || undefined, writeMinRole };
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 8080),
    databasePath: required(env, "DATABASE_PATH"),
    credentialKey: parseCredentialKey(required(env, "CREDENTIAL_KEY")),
    sessionSecret: required(env, "SESSION_SECRET"),
    cookieSecure: env.COOKIE_SECURE === "true",
    admin: {
      email: env.ADMIN_EMAIL ?? "admin@urumi.local",
      name: env.ADMIN_NAME ?? "Ada Admin",
      password: required(env, "ADMIN_PASSWORD"),
    },
    member: {
      email: env.MEMBER_EMAIL ?? "member@urumi.local",
      name: env.MEMBER_NAME ?? "Mina Member",
      password: required(env, "MEMBER_PASSWORD"),
    },
    builtins: [
      builtin(env, "WooCommerce", "woocommerce", "WOO_MCP_URL", "WOO_MCP_TOKEN", "admin"),
      builtin(env, "Exchange rates", "fx", "FX_MCP_URL", "FX_MCP_TOKEN", "member"),
      builtin(env, "Store operations", "ops", "OPS_MCP_URL", "OPS_MCP_TOKEN", "member"),
    ].filter((item): item is BuiltinServer => item !== null),
    llm: {
      baseUrl: (env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: env.LLM_API_KEY ?? "",
      model: env.LLM_MODEL ?? "gpt-4o-mini",
    },
    toolExposure: env.TOOL_EXPOSURE === "search" ? "search" : "flat",
    publicStoreUrl: env.PUBLIC_STORE_URL ?? "http://store.urumi.local",
    storeMode: env.STORE_MODE === "woocommerce" ? "woocommerce" : "fixture",
    selfHosts: (env.SELF_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS ?? 8000),
    listTimeoutMs: Number(env.LIST_TIMEOUT_MS ?? 3000),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 60),
    devKeyFile: env.DEV_KEY_FILE || undefined,
    statusIntervalMs: Number(env.STATUS_INTERVAL_MS ?? 15000),
  };
}
