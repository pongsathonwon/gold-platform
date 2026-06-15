# Gold Platform

Full-stack monorepo with end-to-end type safety.

| Layer       | Stack                                          |
| ----------- | ---------------------------------------------- |
| Backend     | Hono + Drizzle ORM + PostgreSQL + Effect.ts    |
| Frontend    | React + Vite + MUI + TanStack Query + React Router |
| Type safety | Hono RPC (`hc<AppType>`)                       |
| Monorepo    | pnpm workspaces + Turborepo                    |

---

## Prerequisites

- [Node.js](https://nodejs.org) 20+
- [pnpm](https://pnpm.io) 10+ — `npm install -g pnpm`
- [Docker](https://www.docker.com) (for local PostgreSQL)

---

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env`:

```env
DATABASE_URL=postgres://postgres:password@localhost:5432/gold_platform
PORT=3000
JWT_SECRET=change-me-to-a-random-32-char-secret-key
```

### 3. Start PostgreSQL

```bash
pnpm docker:up
```

### 4. Run database migrations

```bash
pnpm db:generate   # generate migration files from schema
pnpm db:migrate    # apply migrations to the database
```

### 5. Seed the database

```bash
pnpm db:seed
```

Seeds Sprint 1 master data:

| Table | Data |
|---|---|
| `purities` | 99.9% (g), 96.5% (gb) |
| `gold_product_type` | Goldbar, Gold Plate |
| `gold_brands` | NA (sentinel for 99.9% pools), ฮั่วเซ่งเฮง (non-fungible) |
| `unit_conversion` | 1 baht = 15.244 g |
| `users` | admin / admin |

Override credentials via env vars:
```bash
SEED_USERNAME=myname SEED_PASSWORD=securepass pnpm db:seed
```

The script is idempotent — safe to run multiple times (`ON CONFLICT DO NOTHING`).

### 6. Start development servers

```bash
pnpm dev
```

| Service | URL                   |
| ------- | --------------------- |
| API     | http://localhost:3000 |
| Web     | http://localhost:5173 |

---

## Project Structure

```
gold-platform/
├── apps/
│   ├── api/                          # Hono backend (hexagonal architecture)
│   │   ├── src/
│   │   │   ├── core/                 # Domain logic
│   │   │   │   ├── auth/
│   │   │   │   │   ├── adapter/      # auth.routes.ts — POST /auth/register, /auth/login
│   │   │   │   │   ├── application/  # auth.usecase.ts
│   │   │   │   │   ├── domain/       # auth.error.ts
│   │   │   │   │   └── port/         # auth.port.ts
│   │   │   │   └── user/
│   │   │   │       ├── adapter/      # user.routes.ts, user.repository.ts
│   │   │   │       ├── application/  # user.usecase.ts
│   │   │   │       ├── domain/       # user.entity.ts, user.error.ts
│   │   │   │       └── port/         # user.port.ts
│   │   │   ├── infrastructure/
│   │   │   │   ├── db/
│   │   │   │   │   ├── client.ts     # Drizzle client (Effect Layer)
│   │   │   │   │   └── schema/       # Table definitions
│   │   │   │   ├── http/middleware/  # auth.middleware.ts (JWT)
│   │   │   │   ├── runtime.ts        # Effect ManagedRuntime wiring
│   │   │   │   └── utils/            # env.ts, jwt.ts, hasher.ts, validator.ts
│   │   │   └── index.ts              # Entry point — exports AppType
│   │   ├── .env.example
│   │   └── drizzle.config.ts
│   └── web/                          # React frontend
│       └── src/
│           ├── api/
│           │   └── client.ts         # Hono RPC typed client
│           ├── components/
│           │   └── UserList.tsx
│           ├── App.tsx               # Router + MUI theme + QueryClientProvider
│           └── main.tsx
├── packages/
│   └── types/                        # Shared Zod schemas + inferred types
│       └── src/
│           └── index.ts
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

---

## Installing Dependencies

```bash
# Add a dep to the API
pnpm --filter @gold-platform/api add <package>
pnpm --filter @gold-platform/api add -D <package>   # dev dep

# Add a dep to the web
pnpm --filter @gold-platform/web add <package>
pnpm --filter @gold-platform/web add -D <package>

# Add a shared dep to packages/types
pnpm --filter @gold-platform/types add <package>
```

---

## Common Commands

### Development

| Command            | Description                            |
| ------------------ | -------------------------------------- |
| `pnpm dev`         | Start all apps in dev mode             |
| `pnpm build`       | Build all apps                         |
| `pnpm type-check`  | Run TypeScript checks across all apps  |

### Database

| Command            | Description                              |
| ------------------ | ---------------------------------------- |
| `pnpm db:generate` | Generate migration files from schema     |
| `pnpm db:migrate`  | Apply pending migrations                 |
| `pnpm db:seed`     | Seed Sprint 1 master data + admin user   |
| `pnpm db:studio`   | Open Drizzle Studio (visual DB browser)  |

### Docker

| Command            | Description      |
| ------------------ | ---------------- |
| `pnpm docker:up`   | Start PostgreSQL |
| `pnpm docker:down` | Stop PostgreSQL  |

---

## Architecture

### Hexagonal (Ports & Adapters)

The API is organized around domain cores. Each core (`auth`, `user`) has:

- **domain** — entities, error types (no dependencies)
- **port** — interfaces (contracts) the core exposes or requires
- **application** — use-case logic using Effect.ts
- **adapter** — Hono routes (inbound) and Drizzle repositories (outbound)

Infrastructure concerns (DB client, JWT, config) live in `src/infrastructure/` and are wired together as Effect Layers in `runtime.ts`.

### Effect.ts Runtime

Use cases run inside an `Effect.ManagedRuntime` that provides `AppConfig` and `DrizzleClient` as layers. Route handlers call use cases via `appRuntime.runPromise(...)` and pattern-match on `Exit` to map domain errors to HTTP responses.

### End-to-End Type Safety

1. **API** exports `AppType` from `apps/api/src/index.ts`
2. **Web** imports it as a type-only import and passes it to `hc`:

   ```ts
   // apps/web/src/api/client.ts
   import type { AppType } from "@gold-platform/api";
   import { hc } from "hono/client";

   export const client = hc<AppType>("http://localhost:3000");
   ```

3. The client has full autocomplete and type inference on every route — request body, query params, and response shape — with no codegen step.

---

## Shared Types (`packages/types`)

Zod schemas used by **both** the API and the web live in `@gold-platform/types`:

```ts
// packages/types/src/index.ts
export const registerSchema = z.object({ ... });
export const loginSchema = z.object({ ... });
```

Only put schemas here if both apps need them. DB-specific types (Drizzle `$inferSelect`) stay in the API.

---

## Adding a New Route

1. Add shared Zod schemas to `packages/types/src/index.ts` if the web will need them
2. Create a new core under `apps/api/src/core/your-resource/` following the domain/port/application/adapter structure
3. Register the router in `apps/api/src/index.ts` via `.route("/your-resource", yourRouter)`
4. The web client picks up the new routes automatically via `AppType`
