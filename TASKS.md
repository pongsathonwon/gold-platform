# Sprint 1 — Auth + Manual Inventory Tracking

**Scope:** Login/auth flow and inventory balance model overhaul with manual management endpoints and their frontend.  
Transaction domains (wholesale, retail, receive, smelting, convert-out) are Sprint 2+.

---

## Backend

See [apps/api/TASKS.md](apps/api/TASKS.md) for the full breakdown.

- [ ] Schema: replace `inventoryLots` with `inventoryBalance`; add `origin`, `notes`, `productSwitchAdjustments`
- [ ] Inventory domain: WAC via daily snapshot, `computeSnapshots`, `productSwitch`
- [ ] Auth: login endpoint working, JWT middleware on inventory routes
- [ ] DB migration + seed `'NA'` brand

## Frontend

See [apps/web/TASKS.md](apps/web/TASKS.md) for the full breakdown.

- [ ] Login screen + JWT storage + auth guard
- [ ] Inventory balance view + today's WAC rate display
- [ ] Manual adjustment forms (gain, loss, product switch)
- [ ] Daily snapshot trigger button

---

## Definition of Done

- Login issues JWT; protected routes reject requests without a valid token
- `POST /inventory/snapshots/compute` freezes WAC rate; subsequent `decrement()` calls use it
- `POST /inventory/gain` and `POST /inventory/loss` update `inventoryBalance` atomically
- `POST /inventory/product-switch` atomically moves weight from non-fungible pool to fungible pool
- `GET /inventory/volume` reflects real balance table state
- Inventory balance UI shows pool totals and today's WAC per pool
- `pnpm type-check` passes across all packages
- DB migration applies cleanly from scratch on a fresh Postgres instance
