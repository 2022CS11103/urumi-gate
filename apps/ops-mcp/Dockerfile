FROM node:22-alpine
WORKDIR /app
COPY packages/mcp-http packages/mcp-http
COPY apps/ops-mcp apps/ops-mcp
ENV NODE_ENV=production PORT=8080 HOME=/tmp
USER node
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "--experimental-strip-types", "apps/ops-mcp/src/main.ts"]
