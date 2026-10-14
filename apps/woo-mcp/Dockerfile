FROM node:22-alpine
WORKDIR /app
COPY packages/mcp-http packages/mcp-http
COPY apps/woo-mcp apps/woo-mcp
ENV NODE_ENV=production PORT=8080 HOME=/tmp WOO_MODE=rest
USER node
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "--experimental-strip-types", "apps/woo-mcp/src/main.ts"]
