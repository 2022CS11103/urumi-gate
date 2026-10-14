import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { extname, join } from "node:path";

const root = join(process.cwd(), "dist");
const upstream = process.env.UPSTREAM_ORIGIN ?? "http://127.0.0.1:43124";
const port = Number(process.env.PORT ?? 8080);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function proxy(req, res) {
  const target = new URL(req.url ?? "/", upstream);
  const headers = { ...req.headers, host: target.host };
  delete headers["accept-encoding"];
  const upstreamReq = httpRequest(
    target,
    { method: req.method, headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstreamReq.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("gateway unavailable");
  });
  req.pipe(upstreamReq);
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz" || url.pathname === "/readyz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname === "/mcp") {
    proxy(req, res);
    return;
  }
  const requested = decodeURIComponent(url.pathname);
  if (requested.includes("..") || requested.includes("\0")) {
    res.writeHead(400);
    res.end();
    return;
  }
  let file = join(root, requested.replace(/^\/+/, ""));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) file = join(root, "index.html");
  const cache = extname(file) === ".html" ? "no-cache" : "public, max-age=3600";
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": cache });
  createReadStream(file).pipe(res);
}).listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", msg: "dashboard listening", port }));
});
