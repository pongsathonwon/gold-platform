# Gold Platform

Full-stack monorepo with end-to-end type safety.

| Layer     | Stack                              |
| --------- | ---------------------------------- |
| Backend   | Hono + Drizzle ORM + PostgreSQL    |
| Frontend  | React + Vite + TanStack Query      |
| Type safety | Hono RPC (`hc<AppType>`)        |
| Monorepo  | pnpm workspaces + Turborepo        |

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
cp .env.example apps/api/.env
```

Edit `apps/api/.env` if needed (defaults match the Docker Compose setup):

```env
DATABASE_URL=postgres://postgres:password@localhost:5432/gold_platform
PORT=3000
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

### 5. Start development servers

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
│   ├── api/                    # Hono backend
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── index.ts   # Drizzle client
│   │   │   │   └── schema.ts  # Table definitions
│   │   │   ├── lib/
│   │   │   │   └── env.ts     # Zod-validated env vars
│   │   │   ├── routes/
│   │   │   │   └── users.ts   # Example CRUD routes
│   │   │   └── index.ts       # Entry point — exports AppType
│   │   └── drizzle.config.ts
│   └── web/                   # React frontend
│       └── src/
│           ├── api/
│           │   └── client.ts  # Hono RPC typed client
│           └── components/
│               └── UserList.tsx
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

# Add to both
pnpm --filter @gold-platform/api --filter @gold-platform/web add <package>
```

---

## Common Commands

### Development

| Command         | Description                        |
| --------------- | ---------------------------------- |
| `pnpm dev`      | Start all apps in dev mode         |
| `pnpm build`    | Build all apps                     |
| `pnpm type-check` | Run TypeScript checks across all apps |

### Database

| Command            | Description                              |
| ------------------ | ---------------------------------------- |
| `pnpm db:generate` | Generate migration files from schema     |
| `pnpm db:migrate`  | Apply pending migrations                 |
| `pnpm db:studio`   | Open Drizzle Studio (visual DB browser) |

### Docker

| Command            | Description             |
| ------------------ | ----------------------- |
| `pnpm docker:up`   | Start PostgreSQL        |
| `pnpm docker:down` | Stop PostgreSQL         |

---

## How End-to-End Type Safety Works

1. **API** defines routes with Zod-validated inputs and exports `AppType`:

   ```ts
   // apps/api/src/index.ts
   export type AppType = typeof app;
   ```

2. **Web** imports `AppType` as a type-only import and passes it to `hc`:

   ```ts
   // apps/web/src/api/client.ts
   import type { AppType } from "@gold-platform/api";
   import { hc } from "hono/client";

   export const client = hc<AppType>("http://localhost:3000");
   ```

3. The client now has full autocomplete and type inference on every route — request body, query params, and response shape — with no codegen step.

---

## Adding a New Route

1. Create `apps/api/src/routes/your-resource.ts`
2. Define the router with typed validators
3. Mount it in `apps/api/src/index.ts` via `.route("/your-resource", yourRouter)`
4. The web client picks up the new routes automatically via `AppType`
