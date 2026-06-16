# GoldOffice Web — Developer Context

**App:** `apps/web` (`@gold-platform/web`)  
**Branch:** `dev`  
**Last updated:** 2026-06-14  
**Read first:** Root `CONTEXT.md` — business model, gold domain rules, period model, glossary.

---

## 1. Stack

| Concern       | Choice                                                 |
| ------------- | ------------------------------------------------------ |
| Framework     | React 19                                               |
| Build tool    | Vite 6                                                 |
| UI library    | MUI (Material UI) v9 + Emotion                         |
| Data fetching | TanStack Query v5                                      |
| API client    | Hono RPC client (`hono/client`) — end-to-end type-safe |
| Routing       | React Router v7                                        |
| Validation    | Zod (shared via `@gold-platform/types`)                |
| Language      | TypeScript (strict, ESM)                               |

---

## 2. Directory Structure

```
src/
├── main.tsx              — React root, BrowserRouter
├── App.tsx               — QueryClientProvider, ThemeProvider, Routes
├── api/
│   └── client.ts         — typed Hono RPC client instance
└── components/           — UI components (currently: UserList.tsx)
```

---

## 3. API Client — Hono RPC

The web app uses Hono's typed RPC client. The API exports its `AppType` and the web imports it to get full end-to-end type safety — no manual type duplication.

```typescript
// src/api/client.ts
import type { AppType } from "@gold-platform/api";
import { hc } from "hono/client";

export const client = hc<AppType>(import.meta.env.VITE_API_URL);
```

**Calling an endpoint:**

```typescript
// GET request
const res = await client.users.$get();
if (!res.ok) throw new Error("Failed");
const data = await res.json();

// POST request
const res = await client["wholesale-buy"].$post({ json: payload });
```

The client method names mirror the route paths. If a route changes on the API, TypeScript will surface the mismatch here automatically — do not cast or bypass the types.

---

## 4. Data Fetching Pattern

All server state goes through **TanStack Query**. No direct `fetch` calls outside of query/mutation functions.

```typescript
// Query
const { data, isPending, isError } = useQuery({
  queryKey: ["wholesale-buy", filters],
  queryFn: () =>
    client["wholesale-buy"].$get({ query: filters }).then((r) => r.json()),
});

// Mutation with cache invalidation
const mutation = useMutation({
  mutationFn: (payload) =>
    client["wholesale-buy"].$post({ json: payload }).then((r) => r.json()),
  onSuccess: () =>
    queryClient.invalidateQueries({ queryKey: ["wholesale-buy"] }),
});
```

**Query key conventions:**

- List: `[domain]` or `[domain, filters]`
- Single item: `[domain, id]`
- Settlement summary: `[domain, 'settlement', period]`

---

## 5. Shared Types — `@gold-platform/types`

Zod schemas live in `packages/types/src/index.ts` and are consumed by both the API (request validation) and the web (form validation). Import from the package, never redefine locally.

```typescript
import { stockGainSchema, type StockGainReq } from "@gold-platform/types";

// Use in a form:
const parsed = stockGainSchema.safeParse(formData);
```

When adding a new transaction domain, add its request schema to `packages/types` so the web can reuse it for form validation without duplicating it.

---

## 6. Routing

Routes are declared in `App.tsx`. React Router v7 with `<Routes>` / `<Route>`.

**Sprint 1 routes (implement now):**

```
/login                    — login form (public)
/inventory                — inventory balance view, today's WAC rate, snapshot trigger (protected)
/inventory/gain           — stock gain form (protected)
/inventory/loss           — stock loss form (protected)
/inventory/switch         — product switch form (protected)
```

**Deferred to Sprint 2+:**

```
/                         — management dashboard (current period net)
/wholesale-buy            — wholesale buy list + create
/wholesale-buy/:id        — wholesale buy detail + status advance
/wholesale-sell
/wholesale-sell/:id
/retail-buy
/retail-buy/:id
/retail-sell
/retail-sell/:id
/receive
/receive/:id
/period-report            — historical period net report
/master-data              — brands, purities, suppliers, branches (admin)
```

---

## 7. UI Conventions

- **MUI v9** for all UI primitives. Use MUI components — do not reach for plain HTML elements for layout or form controls.
- **Theme** is created once in `App.tsx` and passed via `ThemeProvider`. Extend it there — do not create local themes.
- **Forms** use controlled inputs with local `useState`. Validate on submit using the shared Zod schema before calling the mutation.
- **Loading / error states** come from TanStack Query (`isPending`, `isError`, `error`). Do not manage loading state manually alongside a mutation or query.

---

## 8. Environment Variables

```
VITE_API_URL=http://localhost:3000
```

All client-side env vars must be prefixed `VITE_`. Access via `import.meta.env.VITE_*`.

---

## 9. Dev Commands

```bash
npm run dev          # vite dev server — http://localhost:5173
npm run build        # tsc && vite build
npm run preview      # vite preview (built output)
npm run type-check   # tsc --noEmit
```

The API must be running at `VITE_API_URL` for data fetching to work in dev. Run both together from the repo root with `pnpm dev`.

---

## 10. Current State

The web app is a **scaffold**. Only one component exists (`UserList.tsx` — a user CRUD demo).

**Sprint 1 scope — auth + manual inventory tracking only:**

```
① Login screen — email + password → JWT → protected routes
② Inventory balance view — pool totals (purity / brand-or-origin / product type / weight / WAC)
③ Manual adjustment forms — stock gain, stock loss, product switch
④ Daily snapshot trigger — "Compute Today's Rate" button → POST /inventory/snapshots/compute
```

Transaction entry screens (wholesale, retail, receive), the management dashboard, and period reports are all deferred to Sprint 2+.

---

_GoldOffice · Web Context · 2026-06-14 · Root context: `../../CONTEXT.md`_
