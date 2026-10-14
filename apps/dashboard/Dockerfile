FROM node:22-alpine AS build
WORKDIR /src
COPY apps/dashboard/package.json apps/dashboard/package-lock.json ./
RUN npm ci
COPY apps/dashboard ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /src/dist ./dist
COPY apps/dashboard/server.mjs ./server.mjs
ENV NODE_ENV=production PORT=8080 HOME=/tmp
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
