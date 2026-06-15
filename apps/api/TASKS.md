# Backend Sprint 1 Tasks

**Scope:** Auth + manual inventory tracking.  
Transaction domains (wholesale, retail, receive, smelting, convert-out) are Sprint 2.

---

## 1. Schema — `src/infrastructure/db/schema/`

### `master.schema.ts`
- [ ] Add `originEnum = pgEnum('origin', ['domestic', 'foreign'])`

### `inventory.schema.ts`
- [ ] Remove `inventoryLots` table and `lotSourceTypeEnum`
- [ ] Add `inventoryBalance` table — one row per pool `(purityId, brandId, origin, productTypeId)` with `totalWeightGb`, `totalWeightGm`, `totalCost`; composite PK on those four columns
- [ ] Update `inventoryMovements` — remove `lotId`; add `purityId`, `brandId`, `origin`, `productTypeId`, `notes`
- [ ] Update `inventoryDailySnapshots` — add `origin originEnum().notNull()`; make `brandId` nullable; update composite PK to include `origin`
- [ ] Update `stockGainAdjustments` — add `origin originEnum().notNull()`; make `brandId` nullable
- [ ] Update `stockLossAdjustments` — add `origin originEnum().notNull()`; make `brandId` nullable
- [ ] Add `productSwitchAdjustments` table — `id`, `purityId`, `productTypeId`, `fromBrandId`, `weightGb`, `weightGm`, `fromCostDelta`, `toCostDelta`, `notes`, `switchedBy`, `switchedAt`

---

## 2. Shared Types — `packages/types/src/index.ts`

- [ ] Update `stockGainSchema` — add `origin: z.enum(['domestic','foreign'])`, make `brandId` optional (nullable for 99.9%)
- [ ] Update `stockLossSchema` — same origin + optional brandId
- [ ] Add `productSwitchSchema` — `purityId`, `productTypeId`, `fromBrandId`, `weightGb`, `weightGm`, `notes`, `switchedBy`

---

## 3. Port — `core/inventory/port/inventories.port.ts`

- [ ] Add `NoSnapshotError` (`Data.TaggedError`)
- [ ] Add `origin: 'domestic' | 'foreign'` to `IncrementReq` and `DecrementReq`
- [ ] Remove `sourceId` from `IncrementReq` (no more lot source linkage)
- [ ] Replace lot repository methods (`createLot`, `findLotById`, `updateLotRemaining`, `findLotsByFifo`) with balance methods:
  - `getBalance(key)` — read one balance row
  - `upsertBalance(req)` — insert or add delta on conflict
  - `decrementBalance(req)` — subtract delta (with `FOR UPDATE` row lock)
- [ ] Add `getDailySnapshot(key, date)` — returns snapshot or null
- [ ] Add `upsertDailySnapshotOnce(req)` — `INSERT … ON CONFLICT DO NOTHING`
- [ ] Add `createProductSwitchAdjustment(req)`
- [ ] Add `ProductSwitchReq` interface

---

## 4. Repository — `core/inventory/adapter/inventory.repository.ts`

- [ ] Remove `findLotsByFifo`, `findLotById`, `createLot`, `updateLotRemaining`
- [ ] Add `getBalance` — `SELECT … WHERE (purityId, brandId, origin, productTypeId)`
- [ ] Add `upsertBalance` — `INSERT … ON CONFLICT (…) DO UPDATE SET totalWeightGb = … + EXCLUDED.totalWeightGb, …`
- [ ] Add `decrementBalance` — transaction with `SELECT … FOR UPDATE` then `UPDATE`
- [ ] Add `getDailySnapshot`
- [ ] Add `upsertDailySnapshotOnce` — `INSERT … ON CONFLICT DO NOTHING`
- [ ] Add `computeAllSnapshots` — aggregate all active balances, bulk upsert
- [ ] Add `createProductSwitchAdjustment`

---

## 5. Usecase — `core/inventory/application/inventory.usecase.ts`

- [ ] Remove `runFifo`, `listLots`
- [ ] Rewrite `increment()` — upsert balance `+delta` + insert movement
- [ ] Rewrite `decrement()` — read snapshot → `costDelta = weight × snapshotRate` → decrement balance → insert movement; yield `NoSnapshotError` if no snapshot
- [ ] Rewrite `reverseDecrement()` — find movements by reference → restore balance delta (no lot lookup) → insert reverse movements
- [ ] Rewrite `stockGain()` — insert adjustment → upsert balance + movement
- [ ] Rewrite `stockLoss()` — insert adjustment → decrement balance + movement; yield `InsufficientStockError` if balance short
- [ ] Rewrite `getInventoryVolume()` — read from `inventoryBalance` (not lots)
- [ ] Add `computeSnapshots()` — `computeAllSnapshots()` on repo, return written snapshots
- [ ] Add `productSwitch()` — in one Effect chain: get fungible daily snapshot → get non-fungible balance → compute `fromCostDelta` at non-fungible WAC → compute `toCostDelta` at fungible snapshot rate → decrement non-fungible → increment fungible → insert adjustment record → insert two movements

---

## 6. Routes — `core/inventory/adapter/inventory.routes.ts`

- [ ] `GET /inventory` — list balance rows (replaces lot list)
- [ ] `GET /inventory/volume` — aggregate view (update to read from balance)
- [ ] `POST /inventory/gain` — update Zod schema to `stockGainSchema` with origin
- [ ] `POST /inventory/loss` — update Zod schema to `stockLossSchema` with origin
- [ ] `POST /inventory/snapshots/compute` — call `computeSnapshots()`, return snapshots
- [ ] `POST /inventory/product-switch` — call `productSwitch()`, return adjustment record
- [ ] Add `toHttpError` cases for `NoSnapshotError → 422`

---

## 7. Auth

- [ ] Verify `POST /auth/login` issues a valid JWT
- [ ] Verify JWT middleware is applied to all `/inventory/*` routes
- [ ] Confirm `POST /auth/register` works for initial admin account creation

---

## 8. Migration + Seed

- [ ] Run `pnpm db:generate` after all schema edits are complete
- [ ] Run `pnpm db:migrate` to apply
- [ ] Seed: `INSERT INTO gold_brands (id, brand, non_fungible, active) VALUES ('NA', 'N/A', false, false)`
- [ ] Smoke-test: `POST /inventory/snapshots/compute` on empty DB returns empty array without error
