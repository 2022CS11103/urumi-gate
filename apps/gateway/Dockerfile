FROM node:22-alpine
WORKDIR /app
COPY packages/mcp-http packages/mcp-http
COPY apps/gateway apps/gateway
ENV NODE_ENV=production PORT=8080 HOME=/tmp
USER node
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "--experimental-strip-types", "apps/gateway/src/main.ts"]
