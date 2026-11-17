# syntax=docker/dockerfile:1
# API and background worker share this image; docker-compose picks the command.

# ---- build: compile TypeScript (server + shared) to JavaScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --workspace server --no-audit --no-fund
COPY shared shared
COPY server server
RUN npm run build --workspace server

# ---- runtime: production dependencies + compiled output only ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --workspace server --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/server/dist server/dist
WORKDIR /app/server
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/api.js"]
