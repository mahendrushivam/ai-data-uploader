# syntax=docker/dockerfile:1
# ---- build: the React app (root workspace + shared rules) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --include-workspace-root --workspace shared --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src src
COPY shared shared
RUN npm run build:web

# ---- runtime: static files served by unprivileged nginx (runs as non-root, listens on 8080) ----
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
