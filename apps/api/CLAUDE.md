# API — Claude Context

## Stack

- **Framework:** Hono (Node.js)
- **ORM:** Drizzle ORM + `postgres` driver
- **Effect system:** `effect` (v3) — all async/error handling goes through Effect
- **Validation:** Zod + `@hono/zod-validator`
- **Auth:** JWT via Hono JWT helper + bcryptjs
- **Language:** TypeScript (ESM, `tsx` for dev)

## Directory Structure

```
src/
├── index.ts                  — entry point: Hono app, route mounts, server startup
├── core/                     — business domains (hexagonal architecture)
│   ├── auth/
│   ├── user/
│   ├── master/               — brands, purities, suppliers, branches, products, sizes, product-purity rules
│   ├── inventory/            — balance tracking, WAC outbound, movement ledger, daily snapshots
│   ├── wholesale-buy/
│   ├── wholesale-sell/
│   ├── retail-buy/
│   ├── retail-sell/
│   ├── receive/              — goldbar intake from branches, grace-period cancel, bot auto-confirm
│   ├── smelting/             — (planned) non-goldbar → goldbar conversion, increment at CONFIRMED
│   └── convert-out/          — (planned) goldbar decrement with free-text result, grace-period cancel
└── infrastructure/
    ├── runtime.ts            — AppLayer composition, ManagedRuntime, runEffect()
    ├── weight.ts             — resolveWeights() shared Effect
    ├── settlement.ts         — (planned) resolveSettlementPeriod(date) using Fri–Thu boundary
    ├── db/
    │   ├── client.ts         — Drizzle connection pool, RepositoryError
    │   └── schema/index.ts   — re-exports all domain schemas
    ├── http/errors.ts        — handleExit, global error-to-HTTP mapping
    └── utils/
        ├── env.ts            — AppConfig Context.Tag, Zod env validation
        ├── jwt.ts            — JWTService
        └── hasher.ts         — HashService (bcrypt)
```

## Domain File Layout

Every domain is identical:

```
core/<domain>/
  port/<domain>.port.ts           — errors (Data.TaggedError), Context.Tag, command shapes, allowedTransitions map
  application/<domain>.usecase.ts — plain Effect.gen() functions, Layer composition, inventory side-effects
  adapter/<domain>.repository.ts  — Drizzle ORM implementation of repository interface
  adapter/<domain>.routes.ts      — Hono router, Zod validators, toHttpError() mapping
  <domain>.md                     — domain spec (business rules, state flow, tables)
```

No classes in usecases. All usecases are plain `Effect.gen()` functions.

## Effect Patterns

**Running an Effect in a route:**
```typescript
const exit = await appRuntime.runPromiseExit(myUsecase(input))
return runEffect(exit, c, toHttpError)
```

**Building a usecase layer:**
```typescript
const layer = Layer.effect(MyRepository, makeMyRepository)
return myEffect.pipe(Effect.provide(layer))
```

**Error types:**
```typescript
class MyDomainError extends Data.TaggedError("MyDomainError")<{ message: string }> {}
```

**`toHttpError()` in every routes file:**
```typescript
function toHttpError(error: unknown): [string, number] {
  if (error instanceof TransactionNotFoundError) return [error.message, 404]
  if (error instanceof InvalidTransitionError) return [error.message, 422]
  if (error instanceof InsufficientStockError) return [error.message, 422]
  return [JSON.stringify(error), 500]
}
```

## Transaction Domains

All domains share the same status-log pattern: two tables (`*_transactions` + `*_statuses`), `currentStatus` as write-through cache, `allowedTransitions` map in port file, `InvalidTransitionError` → 422 on invalid moves.

`settlementPeriod` is **auto-derived from `recordedAt`** on the server using Fri–Thu boundary — callers never send it.

| Domain | Status Flow | Inventory Hook |
|--------|-------------|----------------|
| wholesale-buy | `DRAFT → CONFIRMED → RECEIVED → SETTLED` \| `DRAFT/CONFIRMED → CANCELLED` | `increment` at `CONFIRMED → RECEIVED` |
| wholesale-sell | `DRAFT → CONFIRMED → SHIPPED → SETTLED` \| `DRAFT/CONFIRMED → CANCELLED` | `decrement` at `CONFIRMED → SHIPPED` |
| retail-buy | `DRAFT → CONFIRMED` \| `DRAFT/CONFIRMED → CANCELLED` | none |
| retail-sell | `DRAFT → CONFIRMED → SHIPPED` \| `DRAFT/CONFIRMED → CANCELLED` | `decrement` at `CONFIRMED → SHIPPED` |
| receive | `RECEIVED → CONFIRMED` \| `RECEIVED → CANCELLED` (grace period only) | `increment` at `RECEIVED → CONFIRMED` |
| smelting | `DRAFT → CONFIRMED` \| `DRAFT → CANCELLED` (grace period only) | `increment` at `DRAFT → CONFIRMED` |
| convert-out | `DRAFT → CONFIRMED` \| `DRAFT → CANCELLED` (grace period only) | `decrement` at `DRAFT → CONFIRMED` |

Grace-period domains (receive, smelting, convert-out): cancel only allowed within **2 hours** of the initial status entry. A bot job auto-confirms after the grace period using `createdBy: 'BOT-CONFIRM'`.

## Settlement Period

`settlementPeriod` is a reporting bucket — a week label (e.g. `"2026-W24"`) auto-computed from `recordedAt` using a fixed Fri–Thu boundary. Callers never supply it.

Each domain exposes a summary endpoint for net position reporting:
- `GET /retail-buy/settlement/:period/summary`
- `GET /retail-sell/settlement/:period/summary`
- `GET /wholesale-buy/settlement/:period/summary`
- `GET /wholesale-sell/settlement/:period/summary`

Endpoints are split per domain (not merged) to keep domains isolated. Client calls in parallel to build a combined dashboard view.

## Product Type × Purity Constraint

Not all purities are valid for every product type (e.g. gold-plate can only be 96.5). Admin configures valid combinations at go-live via `product_type_purities` join table.

`resolveProductPurity(productTypeId, purityId)` — shared Effect called by every `createTransaction` usecase. Fails with `InvalidProductPurityError` → 422 if the combination is not configured.

## Weight & Purity Resolution

`purity.unitOfMeasure` determines conversion direction. Callers always send a single `weight` field — the server resolves both `weightGb` and `weightGm`:

| unitOfMeasure | Purity | Caller sends | Server computes |
|---------------|--------|--------------|-----------------|
| `g` | 99.9 | grams | `weightGb = weight / conversionFactor` |
| `gb` | 96.5 | baht | `weightGm = weight * conversionFactor` |

`conversionFactor` is auto-resolved from `unit_conversions ORDER BY effectiveDate DESC`. All `createTransaction` usecases call `resolveWeights(purityId, weight)` from `infrastructure/weight.ts`. Full rationale in `core/weight-and-purity.md`.

## Inventory Domain

Internal service — not called over HTTP from other domains. Cross-domain calls are direct Effect function composition.

### Model: Aggregate Balance (no lots)

Stock is tracked as a single aggregate row per pool `(purityId, brandId, origin, productTypeId)` in `inventoryBalance`. There are no per-lot records. Cost basis is **WAC (Weighted Average Cost)** using the daily opening snapshot.

### Origin

| Origin | Produced by | Can be decremented by |
|--------|-------------|----------------------|
| `domestic` | `smelting` only — always domestic | `convert_out` only |
| `foreign` | all other inbound | any outbound domain |

All domain callers hardcode their origin. Only `convert_out` accepts `origin` as caller input.

**99.9% goldbar:** `brandId = 'NA'` (sentinel, `active=false`), origin is the meaningful pool key.  
**96.5% products:** `brandId` = actual brand, `origin = 'foreign'` always.

### Functions

| Function | Caller | Effect |
|----------|--------|--------|
| `increment(req)` | wholesale-buy at `RECEIVED`, receive at `CONFIRMED`, smelting at `CONFIRMED` | upsert balance `+delta`, insert movement |
| `decrement(req)` | wholesale-sell/retail-sell at `SHIPPED`, convert-out at `CONFIRMED` | read daily snapshot → WAC cost → update balance `-delta` → insert movement. Fails `NoSnapshotError` if no snapshot today. |
| `reverseDecrement(req)` | (not yet wired) | find movements by reference → reverse balance delta → insert reverse movements |
| `computeSnapshots()` | `POST /inventory/snapshots/compute` | aggregate balances → upsert `inventoryDailySnapshots`. Write-once per day — `INSERT … ON CONFLICT DO NOTHING`. |
| `productSwitch(req)` | `POST /inventory/product-switch` | decrement non-fungible brand pool at its WAC → increment `'NA'` pool at fungible daily rate. Same purity + productType only. Atomic. |
| `stockGain(req)` | `POST /inventory/gain` | insert adjustment record → upsert balance `+delta` → insert movement |
| `stockLoss(req)` | `POST /inventory/loss` | insert adjustment record → update balance `-delta` → insert movement. Fails `InsufficientStockError` if balance short. |

### WAC / Daily Snapshot Flow

`POST /inventory/snapshots/compute` freezes today's opening rate per pool:
- `snapshotRate = balance.totalCost / balance.totalWeightGb`
- Write-once per day — second call returns the existing snapshot, never overwrites
- `decrement()` reads the snapshot before applying cost: `costDelta = weightGb × snapshotRate`
- `decrement()` before snapshot exists → `NoSnapshotError → 422`

`referenceType` on `inventory_movements` is a **free-text varchar** (not an enum — new domains just register a new string). Current values: `WHOLESALE_BUY`, `WHOLESALE_SELL`, `RETAIL_SELL`, `RECEIVED`, `STOCK_GAIN`, `STOCK_LOSS`, `PRODUCT_SWITCH`.

## Schema Files

| File | Tables |
|------|--------|
| `master.schema.ts` | `gold_product_type`, `gold_brands`, `purities`, `bar_sizes`, `suppliers`, `supplier_product_types`, `suppler_brands`, `unit_conversion`, `branches`, `product_type_purities` (planned) |
| `inventory.schema.ts` | `inventory_balance`, `inventory_movements`, `stock_gain_adjustments`, `stock_loss_adjustments`, `inventory_daily_snapshots`, `product_switch_adjustments` |
| `wholesale-buy.schema.ts` | `whole_buy_transactions`, `whole_buy_statuses` |
| `wholesale-sell.schema.ts` | `whole_sell_transactions`, `whole_sell_statuses` |
| `retail-buy.schema.ts` | `retail_buy_transactions`, `retail_buy_statuses` |
| `retail-sell.schema.ts` | `retail_sell_transactions`, `retail_sell_statuses` |
| `received.schema.ts` | `received_transactions`, `received_statuses` |
| `smelting.schema.ts` | (planned) `smelting_transactions`, `smelting_statuses` |
| `convert-out.schema.ts` | (planned) `convert_out_transactions`, `convert_out_statuses` |

## List Filters

| Domain | Filters |
|--------|---------|
| retail-buy | `currentStatus`, `settlementPeriod`, `branchCode` |
| retail-sell | `currentStatus`, `settlementPeriod`, `branchCode` |
| wholesale-buy | `currentStatus`, `settlementPeriod` |
| wholesale-sell | `currentStatus`, `settlementPeriod` |
| receive | `currentStatus`, `settlementPeriod`, `branchCode` |

## Open Items

1. **User FK** — `recordedBy / createdBy / movedBy / auditedBy` are plain `varchar`; blocked on employee/customer domain decision (see below)
2. **`custCode` / `emplCode` FK** — retail domains use legacy codes; blocked on same decision
3. **Employee vs user identity** — recommendation: separate `employees` table (carries `emplCode`) from `users` (login only); `customers` table for `custCode`. Defer until stakeholders decide legacy sync strategy
4. **`users` table PK** — currently `serial` (integer); should migrate to `uuid` to match all other tables before adding any FKs
5. **DB migrations** — no migration files yet; run `drizzle-kit generate` then `drizzle-kit migrate` before any deployment. Seed: insert `'NA'` brand (`id='NA', brand='N/A', nonFungible=false, active=false`) after first migration.
6. **Goldbar-to-goldbar conversion** — resolved: `smelting` increments domestic 99.9% pool; `convert_out` decrements domestic or foreign pool. No separate conversion domain needed.
7. **Jewelry inventory** — deferred. Non-fungible tracking in Sprint 1 uses `productSwitch` to reclassify into the fungible pool when legacy POS discrepancy occurs. True item-level non-fungible tracking is a future phase.
8. **`reverseDecrement()`** — not yet wired to any domain transition. Works without lot lookup — movements now carry pool keys directly, so reversal finds and restores the correct balance row.
9. **Daily snapshot as hard gate** — `decrement()` fails if no snapshot exists for today. Operations team must call `POST /inventory/snapshots/compute` at day-open before any outbound transaction is processed.

## Dev Commands

```bash
npm run dev          # tsx watch --env-file=.env src/index.ts
npm run build        # tsc -p tsconfig.build.json
npm run db:generate  # drizzle-kit generate
npm run db:migrate   # drizzle-kit migrate
```

## Environment Variables

```
DATABASE_URL=postgres://postgres:password@localhost:5432/gold_platform
PORT=3000
JWT_SECRET=<32-char random secret>
```
