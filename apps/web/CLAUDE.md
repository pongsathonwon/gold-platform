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
/inventory                — inventory balance view, split 96.5 (GB) / 99.9 (KG), per-purity totals (protected)
/inventory/movements      — movement ledger, split by purity with per-purity totals (protected)
/inventory/gain           — stock gain form (protected)
/inventory/loss           — stock loss form (protected)
/inventory/switch         — product switch form (protected)
/wholesale-buy            — wholesale buy list, filterable by status + supplier (protected)
/wholesale-buy/new        — create form (protected)
/wholesale-buy/:id        — detail, status timeline, status actions (protected)
```

**Deferred to Sprint 2+:**

```
/                         — management dashboard (current period net)
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

## 9b. Wholesale Buy UI

Three pages plus one shared helper:

| File | Role |
| --- | --- |
| `pages/WholesaleBuyListPage.tsx` | split into `ทอง 96.5%` (บาท) and `ทอง 99.9%` (กก.) sections like the inventory pages, each with its own `รวม` footer. Status/supplier filters. Shows the delivered weight, with the ordered one beside it when they differ |
| `pages/WholesaleBuyCreatePage.tsx` | create form on the shared `useDynamicForm` / `DynamicFormField` pattern. The 99.9% price auto-fills from the 96.5% one via `derivePricePerGb999()` and stays editable |
| `pages/WholesaleBuyDetailPage.tsx` | summary, status timeline, action buttons + confirm dialog |
| `utils/wholeBuyStatus.ts` | chip colours, Thai labels, `nextStatuses()`, `requiresNote()` |

**Action buttons come from `WHOLE_BUY_TRANSITIONS` in `@gold-platform/types`** — the same map the
API validates against, so the UI cannot offer a move the server will reject. Never hard-code a
status list in a component.

The dialog collects a **note** (mandatory for failure-branch moves, which the API rejects without
one) and, on any move into `CHECKED`, an optional **delivered weight**. Leaving the weight blank
books the ordered weight.

**Never show a 99.9% weight in gold baht.** It is ordered in kilograms, so a 2 kg order displayed
as its 131.20 GB equivalent is a number nobody typed. Sectioning by purity is what lets each table
state one unit in its header. `splitByPurity()` in `utils/inventoryVolume.ts` is generic over the
row shape and is the shared helper for this.

List totals exclude `CANCELLED` / `REJECTED` / `RETURNED` rows via `countsTowardTotal()` — those
orders delivered no gold and settled no money. The footer renders whenever the section has rows,
even when every one is excluded: an explicit `0` with the exclusion caption is an answer, a missing
footer looks like a bug.

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
