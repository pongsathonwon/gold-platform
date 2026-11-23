# The SPA, served by nginx, with /api/ proxied to the api container (deploy/nginx/web.conf).
# Build context is the repo root: this is a pnpm workspace and the web app depends on
# @gold-platform/api (for the client's types) and @gold-platform/types.
#
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://host/api -t gold-platform-web .

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile
COPY . .

# Inlined into the bundle. vite.config.ts refuses a production build without it, because a bundle
# silently pointing at the wrong host builds, deploys and loads fine and only fails at login.
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || { echo "--build-arg VITE_API_URL is required"; exit 1; }
# `...` = the web app and its workspace dependencies, built in order (types and api compile first)
RUN VITE_API_URL="$VITE_API_URL" pnpm --filter '@gold-platform/web...' build

# ---------- runtime ----------
FROM nginx:1.27-alpine
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
