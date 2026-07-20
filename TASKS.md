# Sprint 1 — Auth + Manual Inventory Tracking

**Scope:** Login/auth flow and inventory balance model overhaul with manual management endpoints and their frontend.  
Transaction domains (wholesale, retail, receive, smelting, convert-out) are Sprint 2+.

---

## Backend

See [apps/api/TASKS.md](apps/api/TASKS.md) for the full breakdown.

- [x] Schema: replace `inventoryLots` with `inventoryBalance`; add `origin`, `notes`, `productSwitchAdjustments`
- [x] Inventory domain: WAC via daily snapshot, `computeSnapshots`, `productSwitch`
- [x] Auth: login endpoint working, JWT middleware on inventory routes
- [x] DB migration + seed `'NA'` brand

## Frontend

See [apps/web/TASKS.md](apps/web/TASKS.md) for the full breakdown.

- [x] Login screen + JWT storage + auth guard
- [x] Inventory balance view + today's WAC rate display
- [x] Manual adjustment forms (gain, loss, product switch)
- [x] Daily snapshot trigger button

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

---

# V1 Inventory Feedback (post-launch)

Tracking checklist for the approved plan (`~/.claude/plans/the-v1-of-this-temporal-cherny.md`).
Update this file (mark done + notes) before moving to the next task.

- [x] **1. packages/types** — `pricePerGb` on gain schema, `TRANSACTION_TYPES` + `transactionTypeSchema`, swap `reason`→`referenceType` on both schemas. _Done: added `TRANSACTION_TYPES` (bilingual), `transactionTypeSchema`, `TransactionType`; gain now takes `pricePerGb` + `referenceType`, loss takes `referenceType`._
- [x] **2. inventory.schema.ts** — add `pricePerGb`, change `reason`→`referenceType` varchar, drop reason pgEnums; `db:generate` + `db:migrate`/reseed. _Done: schema updated; hand-authored migration `drizzle/0004_flat_referral.sql` + `0004_snapshot.json` + journal entry (drizzle-kit generate needs a TTY to resolve the rename, unavailable here). **Postgres is down (5432 closed) — run `npm run db:migrate` in apps/api when the DB is up; reseed if adjustment tables have rows (new NOT NULL cols have no default).**_
- [x] **3. Backend usecase/repository** — gain `totalCost = pricePerGb × weightGb`; live-WAC `decrementBalance`; remove snapshot gate in `stockLoss`/`decrement`/`productSwitch`; set movement `referenceType` from request. _Done: `decrementBalance` now computes cost from the locked row's live WAC and returns it; `NoSnapshotError` removed from port/routes/usecase; productSwitch conserves value (`toCostDelta = fromCostDelta`); stockLoss decrements before writing the adjustment. API + types type-check clean._
- [x] **4. StockGainPage.tsx** — price-per-baht field + shared transaction-type dropdown. _Done: `pricePerGb` (ราคาต่อบาททอง) replaces Total Cost; `referenceType` select uses `TRANSACTION_TYPES`._
- [x] **5. StockLossPage.tsx** — shared transaction-type dropdown (no price). _Done: `referenceType` select uses `TRANSACTION_TYPES`; no price field._
- [x] **6. InventoryPage.tsx** — split 96.5 (GB) / 99.9 (KG) sections + per-purity total row. _Done: two `ทอง 96.5%` / `ทอง 99.9%` sections; 96.5 shows GB, 99.9 shows KG (grams/1000); each has a bold `รวม` footer summing weight + cost._
- [x] **7. InventoryMovementPage.tsx** — split sections + per-purity total row. _Done: same two-section split with signed/coloured deltas and a `รวม` footer per purity._
- [~] **8. Type-check both apps** + run the Verification flow. _Type-check PASSES for `packages/types`, `apps/api`, `apps/web`. **Migration 0004 APPLIED** (Postgres via docker-compose): `price_per_gb`/`reference_type` NOT NULL added, `reason` cols + both pgEnums dropped, existing rows backfilled (price = total_cost/weight_gb; reason→referenceType mapped, e.g. stock_count→STOCK_COUNT). Remaining: drive the app for the plan's Verification steps 3–6 (needs `pnpm dev`)._

## V1 Feedback Notes

- Docs updated: `apps/api/CLAUDE.md` now describes live-WAC (report-only snapshots, `pricePerGb`, `TRANSACTION_TYPES`); open-item #9 marked resolved. `inventory.md` got a stale banner pointing to CLAUDE.md (it described a never-built lot/FIFO model).
- `getDailySnapshot` (repo/port) is retained but no longer used by any usecase — kept for the opening-balance report feature.

---

# Inventory Nav Sidebar (post-launch)

- [x] **1. InventoryLayout.tsx** — vertical `Tabs` sidebar (Inventory / Movement History / Stock Gain / Stock Loss / Product Switch) with active tab driven by `useLocation()`; nested `/inventory/*` routes under it in `App.tsx` (index route = `InventoryPage`). Replaces the per-page row of nav buttons.
- [x] **2. InventoryPage.tsx** — dropped the `% ทอง` table column (redundant with the `ทอง 96.5%` / `ทอง 99.9%` section titles); extracted the purity-split / weight-unit / WAC math into `src/utils/inventoryVolume.ts` (`poolKey`, `weightOf`, `wacRate`, `splitByPurity`).
- [x] **3. Test infra** — added `vitest` to `apps/web` (`npm test` → `vitest run`), config in `vite.config.ts`; unit tests for the extracted helpers in `src/utils/inventoryVolume.test.ts` (6 tests, gb/kg conversion, WAC divide-by-zero guard, purity split). Verified the sidebar + column removal live via a Playwright smoke script (`playwright` added as a dev dependency for reuse).

