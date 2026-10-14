#!/usr/bin/env bash
set -euo pipefail

tag="${TAG:-0.1.0}"
root="$(cd "$(dirname "$0")/.." && pwd)"

docker build -f "${root}/images/wordpress/Dockerfile" -t "urumi/wordpress:${tag}" "${root}/images/wordpress"
docker build -f "${root}/apps/woo-mcp/Dockerfile" -t "urumi/woo-mcp:${tag}" "${root}"
docker build -f "${root}/apps/fx-mcp/Dockerfile" -t "urumi/fx-mcp:${tag}" "${root}"
docker build -f "${root}/apps/ops-mcp/Dockerfile" -t "urumi/ops-mcp:${tag}" "${root}"
docker build -f "${root}/apps/gateway/Dockerfile" -t "urumi/gateway:${tag}" "${root}"
docker build -f "${root}/apps/dashboard/Dockerfile" -t "urumi/dashboard:${tag}" "${root}"

echo "Built urumi/*:${tag}. Load them into Kind with: kind load docker-image --name urumi urumi/wordpress:${tag} ..."
