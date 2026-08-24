# Build context is the repo root, not apps/api — this is a pnpm workspace and the API depends on
# @gold-platform/types, so the lockfile and both package manifests have to be in scope.
#
#   docker build -f apps/api/Dockerfile -t gold-api .

# ---------- deps ----------
# Manifests only, so a source-only change does not invalidate the install layer.
FROM node:22-alpine AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile

# ---------- build ----------
# @gold-platform/types must be compiled before the API: it is consumed as real JavaScript, not as
# TypeScript source. Shipping raw .ts meant `node dist/index.js` only ran on a Node new enough to
# strip types on its own, and failed on the Node 20 the README asks for.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @gold-platform/types build \
 && pnpm --filter @gold-platform/api build

# `pnpm deploy` resolves the workspace dependency into a self-contained node_modules with
# production dependencies only — no drizzle-kit, no tsx, no vitest in the runtime image.
RUN pnpm --filter @gold-platform/api deploy --prod --legacy /prod/api

# ---------- runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Never as root. Cloud Run does not require it, but a container that does not need write access to
# its own filesystem should not have it either.
RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /prod/api/node_modules ./node_modules
COPY --from=build --chown=app:app /prod/api/package.json ./package.json
COPY --from=build --chown=app:app /repo/apps/api/dist ./dist
# The migration SQL, beside dist/ — `dist/scripts/migrate.js` resolves ../../drizzle
COPY --from=build --chown=app:app /repo/apps/api/drizzle ./drizzle

USER app

# Documentation only. Cloud Run injects PORT and the server reads it; it is not fixed at 3000.
EXPOSE 3000

CMD ["node", "dist/index.js"]
