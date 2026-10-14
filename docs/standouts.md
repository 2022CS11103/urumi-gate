# Beyond the core

The multi-store provisioning bonus is not implemented. A working single store, gateway, and chat was the cut line. These extras are in the tree:

| Item | Where |
| --- | --- |
| Tool permissions. Members get read tools. Write tools are hidden and rejected. | `apps/gateway/src/tools.ts`, server `writeMinRole`, dashboard badges |
| SSRF checks on save and on every call, including metadata, decimal IPs, and DNS to private ranges | `apps/gateway/src/ssrf.ts` |
| Upstream secrets encrypted with AES-256-GCM. API keys stored as SHA-256. Passwords scrypt. | `apps/gateway/src/crypto.ts` |
| Default-deny NetworkPolicy. MCP servers have no ingress except the gateway. | `charts/urumi-platform/templates/networkpolicy.yaml` |
| Non-root, read-only root, dropped capabilities, no service-account token on the services we build | gateway, dashboard, and MCP deployments |
| No Kubernetes API access. Provisioning is Helm, not a controller. | chart has no Role or RoleBinding |
| Prompt-injection hint on tool descriptions, plus a system prompt that treats them as data | `apps/gateway/src/tools.ts`, `apps/gateway/src/chat.ts` |
| Per-user rate limit, and a tighter limit on login | `apps/gateway/src/app.ts` |
| Prometheus text metrics and a status reason when a probe fails | `GET /metrics` on the gateway, `apps/gateway/src/metrics.ts` |
| Optional search-then-call tool surface for a large catalog | `TOOL_EXPOSURE=search` |
| Upgrade, rollback, and the local-versus-VPS values diff | README |

Not done, on purpose: a real VPS deploy in this environment, OAuth for MCP clients, hosting an upstream from a container image, and more than one gateway replica. The last one is documented as a SQLite limit rather than faked.
