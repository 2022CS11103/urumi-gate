import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const root = new URL("..", import.meta.url).pathname;
process.chdir(root);
mkdirSync("data", { recursive: true });

const envPath = ".env";
if (!existsSync(envPath)) {
  const password = () => randomBytes(12).toString("base64url");
  const token = () => randomBytes(24).toString("hex");
  const body = [
    "DATABASE_PATH=data/gateway.sqlite",
    `CREDENTIAL_KEY=${randomBytes(32).toString("base64")}`,
    `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
    "ADMIN_EMAIL=admin@urumi.local",
    `ADMIN_PASSWORD=${password()}`,
    "ADMIN_NAME=Ada Admin",
    "MEMBER_EMAIL=member@urumi.local",
    `MEMBER_PASSWORD=${password()}`,
    "MEMBER_NAME=Mina Member",
    "WOO_MCP_URL=http://127.0.0.1:43125/mcp",
    `WOO_MCP_TOKEN=${token()}`,
    "FX_MCP_URL=http://127.0.0.1:43126/mcp",
    `FX_MCP_TOKEN=${token()}`,
    "OPS_MCP_URL=http://127.0.0.1:43127/mcp",
    `OPS_MCP_TOKEN=${token()}`,
    "PUBLIC_STORE_URL=http://store.urumi.local",
    "STORE_MODE=fixture",
    "COOKIE_SECURE=false",
    "DEV_KEY_FILE=data/dev-keys.txt",
    "LLM_BASE_URL=https://api.openai.com/v1",
    "LLM_API_KEY=",
    "LLM_MODEL=gpt-4o-mini",
    "TOOL_EXPOSURE=flat",
    "HOST=0.0.0.0",
    "PORT=43124",
    "",
  ].join("\n");
  writeFileSync(envPath, body, { mode: 0o600 });
}

const fileEnv = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const env = { ...process.env, ...fileEnv };
const children = [];

function start(name, args, extra, cwd = root) {
  const child = spawn(args[0], args.slice(1), {
    cwd,
    env: { ...env, ...extra },
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) return;
    console.error(`${name} exited with ${code}`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

const node = process.execPath;
const flags = ["--disable-warning=ExperimentalWarning", "--experimental-strip-types"];
start("woo-mcp", [node, ...flags, "apps/woo-mcp/src/main.ts"], {
  PORT: "43125",
  WOO_MODE: "fixture",
  MCP_BEARER_TOKEN: env.WOO_MCP_TOKEN,
});
start("fx-mcp", [node, ...flags, "apps/fx-mcp/src/main.ts"], {
  PORT: "43126",
  MCP_BEARER_TOKEN: env.FX_MCP_TOKEN,
});
start("ops-mcp", [node, ...flags, "apps/ops-mcp/src/main.ts"], {
  PORT: "43127",
  MCP_BEARER_TOKEN: env.OPS_MCP_TOKEN,
});
async function waitFor(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`timed out waiting for ${url}`);
}

await Promise.all([
  waitFor("http://127.0.0.1:43125/healthz"),
  waitFor("http://127.0.0.1:43126/healthz"),
  waitFor("http://127.0.0.1:43127/healthz"),
]);
start("gateway", [node, ...flags, "apps/gateway/src/main.ts"], { PORT: "43124", HOST: "0.0.0.0" });
await waitFor("http://127.0.0.1:43124/healthz");
start(
  "dashboard",
  [node, "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "43123"],
  {},
  "apps/dashboard",
);

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`
Urumi Gate is running.
  Dashboard   http://127.0.0.1:43123
  Gateway MCP http://127.0.0.1:43124/mcp
  Admin       ${env.ADMIN_EMAIL}  ${env.ADMIN_PASSWORD}
  Member      ${env.MEMBER_EMAIL}  ${env.MEMBER_PASSWORD}
  API keys    data/dev-keys.txt  (written on first gateway start)
`);
