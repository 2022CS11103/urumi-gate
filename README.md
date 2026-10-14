# Urumi Gate

Urumi Gate is a team MCP gateway in front of a WooCommerce store. An admin registers upstream MCP servers once. Every teammate then uses all of them through one Streamable HTTP endpoint, and through the chat in the dashboard. Upstream credentials never leave the gateway.

The same Helm chart runs on local Kubernetes (Kind, k3d, or Minikube) and on a VPS with k3s. Local and production differ only in values files.

This work is the author's. It was written as an internship exercise and is not licensed for production use.

## What runs

| Piece | Role | Reachable from |
| --- | --- | --- |
| WordPress + WooCommerce + MariaDB | The store. Cash on delivery, persistent disk. | Ingress only, plus the WooCommerce MCP server |
| `woo-mcp` | MCP tools for products and orders. Talks to WooCommerce REST. | Gateway only |
| `fx-mcp` | Static currency conversion, so one prompt can use a second server | Gateway only |
| `ops-mcp` | Shipping, returns, and hours | Gateway only |
| Gateway | Registry, auth, audit, tool routing, chat tool loop | Dashboard only |
| Dashboard | React UI. Proxies `/api` and `/mcp` to the gateway | Ingress |

Tool names are `{slug}__{tool}`. `woocommerce__list_orders` and a second server's `list_orders` stay distinct.

## Run the node tier locally

This path uses an in-memory WooCommerce fixture so you can exercise the gateway, chat, keys, and audit log without a cluster. The storefront itself is the Helm deployment below.

```bash
cd apps/dashboard && npm install && cd ../..
npm test
npm run dev
```

`npm run dev` writes `.env` on first launch and prints two logins. Open the dashboard at <http://127.0.0.1:43123>.

- Admin can create products. Members can read orders and policies. Write tools are hidden from members and rejected if called.
- With `LLM_API_KEY` empty, chat uses a small offline planner that still calls the real gateway tools. Set `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` in `.env` for any OpenAI-compatible API, including Ollama at `http://127.0.0.1:11434/v1`.
- API keys for the two seeded users are written once to `data/dev-keys.txt`.

Point an MCP client at `http://127.0.0.1:43124/mcp` with header `Authorization: Bearer ugk_...`.

## Local Kubernetes

Requires Docker, Kind, kubectl, and Helm.

```bash
kind create cluster --config deploy/kind-config.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/kind/deploy.yaml
kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller

./scripts/build-images.sh
for image in wordpress woo-mcp fx-mcp ops-mcp gateway dashboard; do
  kind load docker-image --name urumi "urumi/${image}:0.1.0"
done

NS=urumi ./scripts/bootstrap-secrets.sh
# optional: kubectl -n urumi patch secret urumi-credentials --type merge -p '{"stringData":{"llm-api-key":"..."}}'

helm upgrade --install urumi charts/urumi-platform \
  --namespace urumi --create-namespace \
  -f charts/urumi-platform/values.yaml \
  -f charts/urumi-platform/values-local.yaml
```

Add the hosts once:

```
127.0.0.1 store.urumi.local gate.urumi.local
```

- Dashboard: <http://gate.urumi.local>
- Storefront: <http://store.urumi.local>
- MCP endpoint: `http://gate.urumi.local/mcp`

Passwords come from the Secret. The bootstrap script prints them once. Later:

```bash
kubectl -n urumi get secret urumi-credentials -o jsonpath='{.data.admin-password}' | base64 -d; echo
kubectl -n urumi get secret urumi-credentials -o jsonpath='{.data.member-password}' | base64 -d; echo
kubectl -n urumi get secret urumi-credentials -o jsonpath='{.data.wordpress-admin-password}' | base64 -d; echo
```

The storefront becomes Ready after WordPress and WooCommerce finish bootstrapping (`/var/www/html/urumi-ready`). Watch it with `kubectl -n urumi logs deploy/urumi-wordpress`.

## Production-like VPS (k3s)

Install k3s, then point DNS for the dashboard host and the store host at the VPS. k3s already provides Traefik and the `local-path` StorageClass.

```bash
curl -sfL https://get.k3s.io | sh -
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
NS=urumi ./scripts/bootstrap-secrets.sh
# edit charts/urumi-platform/values-prod.yaml: hosts, and the public WordPress URL
helm upgrade --install urumi charts/urumi-platform \
  --namespace urumi --create-namespace \
  -f charts/urumi-platform/values.yaml \
  -f charts/urumi-platform/values-prod.yaml
```

What changes through values, not through a second chart:

| Concern | Local (`values-local.yaml`) | VPS (`values-prod.yaml`) |
| --- | --- | --- |
| Ingress class | `nginx` | `traefik` |
| Ingress namespace for NetworkPolicy | `ingress-nginx` | `kube-system` |
| Hosts | `*.urumi.local` | your DNS names |
| WordPress public URL | `http://store.urumi.local` | `https://store.example.com` |
| TLS | off | cert-manager issuer `letsencrypt` |
| StorageClass | `standard` (Kind) | `local-path` (k3s) |
| Session cookie | not `Secure` | `Secure` |
| Disk size | 2Gi | 10Gi |

Build or push the same images the chart references (`urumi/wordpress:0.1.0` and the five app images). On a single VPS, `docker build` followed by `k3s ctr images import` is enough. No image is pulled from a public registry by the chart unless you change `image` and `imagePullPolicy`.

Secrets stay in the Kubernetes Secret `urumi-credentials`. The chart does not embed them. See `scripts/bootstrap-secrets.sh` for the keys.

### Upgrade and rollback

```bash
helm upgrade urumi charts/urumi-platform -n urumi -f charts/urumi-platform/values.yaml -f charts/urumi-platform/values-prod.yaml
helm history urumi -n urumi
helm rollback urumi -n urumi
```

Gateway schema changes are additive, so rolling the gateway image back is safe. The SQLite file and the WordPress volume survive the rollback. Rolling WordPress back across a WooCommerce database migration is not always safe; take a volume snapshot before a store upgrade. Pin image tags. Do not use `:latest`.

Gateway replicas stay at 1. The gateway database is SQLite on one volume. More than one writer would corrupt it. A later move to Postgres is the way to run several gateway pods.

## Place an order

1. Open the storefront.
2. Open a product, add it to the cart, and check out.
3. Choose **Cash on delivery**. Guest checkout is on, so no account is required.
4. In wp-admin (`/wp-admin`, user `admin`), the order is under WooCommerce → Orders.
5. In the dashboard chat, as either user: "What orders came in today?"

Creating a product from chat, as the admin: "Create a product named Harbor Mug for 18 dollars." It is published immediately and shows on the storefront.

## Connect an external MCP client

In the dashboard, as the member, open **Team** and generate a key. Put it in Cursor or Claude Code. Do not add the WooCommerce server yourself.

```json
{
  "mcpServers": {
    "urumi": {
      "url": "http://gate.urumi.local/mcp",
      "headers": {
        "Authorization": "Bearer ugk_..."
      }
    }
  }
}
```

The client sees every tool the member is allowed to call, from every enabled server. A prompt such as "What orders came in today, and what is our shipping promise?" uses `woocommerce__list_orders` and `ops__get_shipping_policy`.

Revoke the key on the Team page. The next MCP call returns 401.

Disable the operations server on the Servers page. Its tools disappear from chat and from the external client. The WooCommerce tools keep working. Delete the `ops-mcp` pod and the dashboard shows that server as Unreachable while the others stay Connected.

## Chat

The chat calls tools through the same gateway path as an external client, using the signed-in user. Those rows show up in the audit log with source `chat`. The reply lists each tool, how long it took, and whether it succeeded.

Write tools such as `create_product` and `update_order_status` are admin-only. Members do not see them in `tools/list`, and a direct `tools/call` is rejected and audited.

## Tests

```bash
npm test
helm lint charts/urumi-platform
helm template urumi charts/urumi-platform -f charts/urumi-platform/values-local.yaml >/dev/null
```

## Where to read more

- [System design and tradeoffs](docs/system-design.md)
- [Threat model](docs/threat-model.md)
- [What was attempted beyond the core](docs/standouts.md)
