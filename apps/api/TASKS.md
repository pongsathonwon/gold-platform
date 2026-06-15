# Backend Sprint 1 Tasks

**Scope:** Auth + manual inventory tracking.  
Transaction domains (wholesale, retail, receive, smelting, convert-out) are Sprint 2.

---

## 1. Schema — `src/infrastructure/db/schema/`

### `master.schema.ts`
- [x] Add `originEnum = pgEnum('origin', ['domestic', 'foreign'])`

### `inventory.schema.ts`
- [x] Remove `inventoryLots` table and `lotSourceTypeEnum`
- [x] Add `inventoryBalance` table — one row per pool `(purityId, brandId, origin, productTypeId)` with `totalWeightGb`, `totalWeightGm`, `totalCost`; composite PK on those four columns
- [x] Update `inventoryMovements` — remove `lotId`; add `purityId`, `brandId`, `origin`, `productTypeId`, `notes`
- [x] Update `inventoryDailySnapshots` — add `origin originEnum().notNull()`; update composite PK to include `origin`
- [x] Update `stockGainAdjustments` — add `origin originEnum().notNull()`; make `brandId` nullable
- [x] Update `stockLossAdjustments` — add `origin originEnum().notNull()`; make `brandId` nullable
- [x] Add `productSwitchAdjustments` table — `id`, `purityId`, `productTypeId`, `fromBrandId`, `weightGb`, `weightGm`, `fromCostDelta`, `toCostDelta`, `notes`, `switchedBy`, `switchedAt`

---

## 2. Shared Types — `packages/types/src/index.ts`

- [x] Update `stockGainSchema` — add `origin: z.enum(['domestic','foreign'])`, make `brandId` optional (nullable for 99.9%)
- [x] Update `stockLossSchema` — same origin + optional brandId
- [x] Add `productSwitchSchema` — `purityId`, `productTypeId`, `fromBrandId`, `weightGb`, `weightGm`, `notes`, `switchedBy`

---

## 3. Port — `core/inventory/port/inventories.port.ts`

- [x] Add `NoSnapshotError` (`Data.TaggedError`)
- [x] Add `origin: 'domestic' | 'foreign'` to `IncrementReq` and `DecrementReq`
- [x] Remove `sourceId` from `IncrementReq` (no more lot source linkage)
- [x] Replace lot repository methods (`createLot`, `findLotById`, `updateLotRemaining`, `findLotsByFifo`) with balance methods:
  - `getBalance(key)` — read one balance row
  - `upsertBalance(req)` — insert or add delta on conflict
  - `decrementBalance(req)` — subtract delta (with `FOR UPDATE` row lock)
- [x] Add `getDailySnapshot(key, date)` — returns snapshot or null
- [x] Add `upsertDailySnapshotOnce(req)` — `INSERT … ON CONFLICT DO NOTHING`
- [x] Add `createProductSwitchAdjustment(req)`
- [x] Add `ProductSwitchReq` interface

---

## 4. Repository — `core/inventory/adapter/inventory.repository.ts`

- [x] Remove `findLotsByFifo`, `findLotById`, `createLot`, `updateLotRemaining`
- [x] Add `getBalance` — `SELECT … WHERE (purityId, brandId, origin, productTypeId)`
- [x] Add `upsertBalance` — `INSERT … ON CONFLICT (…) DO UPDATE SET totalWeightGb = … + EXCLUDED.totalWeightGb, …`
- [x] Add `decrementBalance` — transaction with `SELECT … FOR UPDATE` then `UPDATE`
- [x] Add `getDailySnapshot`
- [x] Add `upsertDailySnapshotOnce` — `INSERT … ON CONFLICT DO NOTHING`
- [x] Add `computeAllSnapshots` — aggregate all active balances, bulk upsert
- [x] Add `createProductSwitchAdjustment`

---

## 5. Usecase — `core/inventory/application/inventory.usecase.ts`

- [x] Remove `runFifo`, `listLots`
- [x] Rewrite `increment()` — upsert balance `+delta` + insert movement
- [x] Rewrite `decrement()` — read snapshot → `costDelta = weight × snapshotRate` → decrement balance → insert movement; yield `NoSnapshotError` if no snapshot
- [x] Rewrite `reverseDecrement()` — find movements by reference → restore balance delta (no lot lookup) → insert reverse movements
- [x] Rewrite `stockGain()` — insert adjustment → upsert balance + movement
- [x] Rewrite `stockLoss()` — insert adjustment → decrement balance + movement; yield `InsufficientStockError` if balance short
- [x] Rewrite `getInventoryVolume()` — read from `inventoryBalance` (not lots)
- [x] Add `computeSnapshots()` — `computeAllSnapshots()` on repo, return written snapshots
- [x] Add `productSwitch()` — in one Effect chain: get fungible daily snapshot → get non-fungible balance → compute `fromCostDelta` at non-fungible WAC → compute `toCostDelta` at fungible snapshot rate → decrement non-fungible → increment fungible → insert adjustment record → insert two movements

---

## 6. Routes — `core/inventory/adapter/inventory.routes.ts`

- [ ] `GET /inventory` — list balance rows (replaces lot list)
- [x] `GET /inventory/volume` — aggregate view (update to read from balance)
- [x] `POST /inventory/gain` — update Zod schema to `stockGainSchema` with origin
- [x] `POST /inventory/loss` — update Zod schema to `stockLossSchema` with origin
- [x] `POST /inventory/snapshots/compute` — call `computeSnapshots()`, return snapshots
- [x] `POST /inventory/product-switch` — call `productSwitch()`, return adjustment record
- [x] Add `toHttpError` cases for `NoSnapshotError → 422`

---

## 7. Auth

- [x] Verify `POST /auth/login` issues a valid JWT
- [x] Verify JWT middleware is applied to all `/inventory/*` routes
- [x] Confirm `POST /auth/register` works for initial admin account creation

---

## 8. Migration + Seed

- [ ] Run `pnpm db:generate` after all schema edits are complete
- [ ] Run `pnpm db:migrate` to apply
- [ ] Seed: `INSERT INTO gold_brands (id, brand, non_fungible, active) VALUES ('NA', 'N/A', false, false)`
- [ ] Smoke-test: `POST /inventory/snapshots/compute` on empty DB returns empty array without error
