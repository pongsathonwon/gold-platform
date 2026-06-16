# Frontend Sprint 1 Tasks

**Scope:** Login + manual inventory management UI only.  
All transaction screens (wholesale, retail, receive) are Sprint 2+.

---

## 1. Auth

- [x] `POST /auth/login` mutation via Hono RPC client
- [x] Store JWT in `localStorage` (key: `gp_token`); attach as `Authorization: Bearer <token>` header on every API request
- [x] `AuthContext` + `useAuth()` hook — exposes `{ user, token, login, logout, isAuthenticated }`
- [x] Update `client.ts` to inject the stored token into every request
- [x] `<AuthGuard>` component — reads `isAuthenticated`; redirects to `/login` if false
- [x] `LoginPage` — username + password controlled form (backend schema uses `username`, not `email`); Zod validation with `loginSchema` from `@gold-platform/types`; show error on failed login
- [x] Logout button in nav — clears token, redirects to `/login`

---

## 2. Routing

- [x] Add `/login` as a public route (no `<AuthGuard>`)
- [x] Wrap all other routes with `<AuthGuard>`
- [x] `/inventory` — inventory balance + snapshot trigger (placeholder page, content in section 3)
- [x] `/inventory/gain` — stock gain form (placeholder page, content in section 4)
- [x] `/inventory/loss` — stock loss form (placeholder page, content in section 5)
- [x] `/inventory/switch` — product switch form (placeholder page, content in section 6)
- [x] Redirect `/` → `/inventory` for now (dashboard is Sprint 2)

---

## 3. Inventory Balance View — `/inventory`

- [x] `useInventoryVolume` query — `GET /inventory/volume` (TanStack Query, key: `['inventory','volume']`)
- [x] Table columns: Purity | Brand / Origin | Product Type | Weight (GB) | Weight (g) | Total Cost | WAC Rate
  - For 99.9% rows: show Origin (`domestic` / `foreign`) in the Brand column; brand is 'N/A'
  - WAC Rate = `totalCost / totalWeightGb`, formatted as THB/GB
- [x] "Compute Today's Rate" button — mutation `POST /inventory/snapshots/compute` → on success refetch volume
- [ ] Show whether today's snapshot has been computed per pool (compare `snapshotDate` to today) — **deferred**: no `GET` endpoint exists yet to read today's snapshots without triggering a write; needs a backend addition before this can be implemented
- [x] Links to `/inventory/gain`, `/inventory/loss`, `/inventory/switch`

---

## 4. Stock Gain Form — `/inventory/gain`

- [x] Fields: Purity (select) | Brand or 'N/A' (conditional on purity) | Origin (conditional: show only for 99.9%) | Product Type | Weight (GB) | Weight (g) | Conversion Factor | Total Cost | Reason (select from enum) | Notes | Audited By
- [x] Zod client-side validation with updated `stockGainSchema` from `@gold-platform/types`
- [x] Mutation `POST /inventory/gain` — on success: show toast "Stock added" + navigate to `/inventory`
- [x] On `422` (insufficient or domain error): show inline error

---

## 5. Stock Loss Form — `/inventory/loss`

- [x] Fields: Purity | Brand or 'N/A' | Origin | Product Type | Weight (GB) | Weight (g) | Reason | Notes | Audited By
- [x] Zod validation with updated `stockLossSchema`
- [x] Mutation `POST /inventory/loss` — success: toast + navigate to `/inventory`
- [x] On `422 InsufficientStockError`: show "Insufficient stock — requested X GB, available Y GB"
- [x] On `422 NoSnapshotError`: show "Today's rate not set — compute snapshot first"

---

## 6. Product Switch Form — `/inventory/switch`

- [x] Fields: Purity | Product Type | From Brand (only non-fungible brands — `nonFungible=true`) | Weight (GB) | Weight (g) | Notes | Switched By
- [x] Origin is always `foreign` — not shown to user (hardcoded server-side; not part of `productSwitchSchema`)
- [x] Zod validation with `productSwitchSchema`
- [x] Mutation `POST /inventory/product-switch` — success: toast "Reclassified to fungible pool" + navigate to `/inventory`
- [x] On `422 NoSnapshotError`: show "Compute today's rate first" (backend message: "Today's rate not set — compute snapshot first")
- [x] On `422 InsufficientStockError`: show insufficient stock message

---

## 7. Navigation

- [x] Top nav bar: "Inventory" link + logout button
- [x] Active route highlighted (`NavLink` prefix-matches, so `/inventory/*` subroutes keep "Inventory" highlighted)
- [x] Nav only renders when `isAuthenticated` is true
