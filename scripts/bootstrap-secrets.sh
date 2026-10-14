#!/usr/bin/env bash
# Create the credential Secret the chart reads. Re-running does not rotate an existing Secret.
set -euo pipefail

NS="${NS:-urumi}"
SECRET="${SECRET:-urumi-credentials}"

kubectl create namespace "${NS}" --dry-run=client -o yaml | kubectl apply -f -

if kubectl -n "${NS}" get secret "${SECRET}" >/dev/null 2>&1; then
  echo "Secret ${NS}/${SECRET} already exists. Delete it yourself if you mean to rotate credentials."
  exit 0
fi

admin_password="$(openssl rand -base64 18)"
member_password="$(openssl rand -base64 18)"
wordpress_admin_password="$(openssl rand -base64 18)"

kubectl -n "${NS}" create secret generic "${SECRET}" \
  --from-literal=admin-email="${ADMIN_EMAIL:-admin@urumi.local}" \
  --from-literal=admin-password="${admin_password}" \
  --from-literal=member-email="${MEMBER_EMAIL:-member@urumi.local}" \
  --from-literal=member-password="${member_password}" \
  --from-literal=wordpress-admin-password="${wordpress_admin_password}" \
  --from-literal=session-secret="$(openssl rand -hex 32)" \
  --from-literal=credential-key="$(openssl rand -base64 32)" \
  --from-literal=woo-consumer-key="ck_$(openssl rand -hex 20)" \
  --from-literal=woo-consumer-secret="cs_$(openssl rand -hex 20)" \
  --from-literal=woo-mcp-token="$(openssl rand -hex 24)" \
  --from-literal=fx-mcp-token="$(openssl rand -hex 24)" \
  --from-literal=ops-mcp-token="$(openssl rand -hex 24)" \
  --from-literal=mariadb-password="$(openssl rand -hex 18)" \
  --from-literal=mariadb-root-password="$(openssl rand -hex 18)" \
  --from-literal=llm-api-key="${LLM_API_KEY:-}"

echo
echo "Created ${NS}/${SECRET}."
echo "Gateway admin ${ADMIN_EMAIL:-admin@urumi.local} password: ${admin_password}"
echo "Gateway member ${MEMBER_EMAIL:-member@urumi.local} password: ${member_password}"
echo "WordPress admin password: ${wordpress_admin_password}"
echo "Set LLM_API_KEY and re-run after deleting the Secret, or patch the llm-api-key key, to use a model instead of the offline planner."
