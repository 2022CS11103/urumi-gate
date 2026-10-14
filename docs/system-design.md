# System design and tradeoffs

## Shape

```
browser / Cursor
        │  one host, one API key or session cookie
        ▼
   dashboard (static + reverse proxy)
        │  /api and /mcp only
        ▼
   gateway  ── MCP Streamable HTTP ──►  woo-mcp ── REST ──► WordPress
        │                                 fx-mcp
        └──────────────────────────────── ops-mcp
```

The gateway is the only MCP client of the upstreams and the only MCP server the team uses. The dashboard is a proxy so the session cookie stays same-origin and so NetworkPolicy can keep the gateway off the ingress.

## Why WooCommerce REST, not WP-CLI

The MCP server is a long-running HTTP process. REST is a normal request path: one product or order call, a timeout, a JSON body. WP-CLI would mean shelling out of the MCP pod into the WordPress pod, a broader permission, and a worse timeout story. REST also matches how a store integration behaves in production.

WooCommerce 11 accepts HTTP Basic auth only when `is_ssl()` is true, and it stores the consumer secret in plaintext in a `char(43)` column while the consumer key is stored as `hash_hmac('sha256', key, 'wc-api')`. The mu-plugin marks requests that carry `X-Urumi-Internal: 1` as HTTPS and disables the canonical redirect, so service-to-service HTTP works without publishing the store on TLS inside the cluster. Browsers still use the ingress URL.

## Tool aggregation

On a probe, the gateway calls `initialize`, `notifications/initialized`, and `tools/list` on each enabled upstream, with a short timeout, in parallel. A timeout or connection error marks that server Unreachable and leaves the others in the list. Disabled servers are not called.

`tools/list` on the gateway returns the cached live set. Tool names are `{slug}__{upstream_tool}`. The slug is unique, so two servers can both expose `list_orders`. `tools/call` splits on the first `__`, checks that the server is enabled and currently connected, checks the caller's role, then performs the same handshake and `tools/call` against that one upstream with its own timeout. The error names the server and says the others are unaffected.

A dead upstream is also flipped to Unreachable when a live call times out, so the dashboard does not wait for the next probe.

## Auth and records

Passwords are scrypt. API keys are random `ugk_` tokens; only the SHA-256 hash and an 8-character prefix are stored. The full key is returned once. Upstream secrets are AES-256-GCM with a key from the Kubernetes Secret, and API responses never include them. Admins see the URL and whether a credential is set. Members do not see the URL.

The chat tool loop uses the session user. External clients use the API key's user. Both write the same audit row: user, server, tool, time, duration, success.

## Chat

If `LLM_API_KEY` is set, the gateway sends the user's visible tools to an OpenAI-compatible chat completions endpoint and executes tool calls through the gateway, up to four rounds. If it is empty, an offline planner maps a few store questions onto those same tools. The planner is there so the tool loop is demonstrable without a paid API. It is not a substitute for the model path, which is the one a deployment should use.

`TOOL_EXPOSURE=search` changes `tools/list` to `find_tools` and `call_tool` only. The model searches the catalog and then calls one tool. The default is `flat`, because the demo needs the real tool names visible in MCP Inspector.

## Failure and security boundaries

SSRF checks run when a server is saved and again before every upstream call. Metadata and link-local addresses are always rejected. Private, loopback, and cluster DNS names require an explicit "allow private" flag, which the three platform servers set because they are ClusterIP. Redirects are not followed.

NetworkPolicy is default deny. MariaDB accepts only WordPress. WordPress accepts the ingress controller and `woo-mcp`. The MCP servers accept only the gateway. The gateway accepts only the dashboard. The dashboard accepts only the ingress controller. The gateway's extra egress is TCP 443 to public addresses, for the language model, with private and link-local ranges excluded.

Our own containers run as uid 1000, non-root, read-only root filesystem, all capabilities dropped, and without a service-account token. Nothing in the chart has permission to call the Kubernetes API. WordPress and MariaDB keep their upstream images' user model because those entrypoints still start as root to lay out data directories.

## What changes in production

DNS, ingress class, TLS annotations, the public WordPress URL, the storage class, cookie `Secure`, and disk size. Those live in `values-prod.yaml`. The Secret is created out of band. See the README for the upgrade and rollback commands.

The gateway is one replica on purpose. SQLite gives us one file to back up and no second database to operate. It cannot be shared by two writers. Scaling out means moving that file to Postgres and keeping sessions stateless, which they already are: the gateway does not require an MCP session id.
