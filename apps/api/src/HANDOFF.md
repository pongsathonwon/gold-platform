# API Handoff Document

**Branch:** `dev`
**Date:** 2026-06-14 (updated)

---

## What Was Built

Seven transaction domains implemented, all following the same hexagonal architecture pattern. Inventory domain is the shared internal service wired to all gold flow domains.

---

## Domain Overview

### Inventory (`/inventories`)

Internal accounting service. Tracks goldbar weight in anonymous lots by brand + purity + product type. Uses FIFO for all outbound movements. Goldbar only in current phase — jewelry inventory deferred.

**Exposed HTTP:** `GET /`, `GET /volume`, `POST /gain`, `POST /loss`

**Internal cross-domain commands:**
| Command | Called by | Effect |
|---|---|---|
| `increment` | wholesale-buy at `RECEIVED`, receive/smelting at `CONFIRMED` | Creates a new lot + `+delta` movement |
| `decrement` | wholesale-sell at `SHIPPED`, retail-sell at `SHIPPED`, convert-out at `CONFIRMED` | FIFO drains lots + `-delta` movement per lot |
| `reverseDecrement` | (available, not yet wired) | Restores lots from original movements |

**`referenceType` registry:**
- `WHOLESALE_BUY`
- `WHOLESALE_SELL`
- `RETAIL_SELL`
- `RECEIVED`
- `STOCK_GAIN` / `STOCK_LOSS`

---

### Wholesale Buy (`/wholesale-buy`)

Shop buying gold from a supplier. Inventory increments when gold physically arrives.

**Status flow:** `DRAFT → CONFIRMED → RECEIVED → SETTLED` | `DRAFT/CONFIRMED → CANCELLED`

**Inventory:** `increment` fires at `CONFIRMED → RECEIVED`

---

### Wholesale Sell (`/wholesale-sell`)

Shop selling gold back to a supplier. Inventory decrements when gold physically ships.

**Status flow:** `DRAFT → CONFIRMED → SHIPPED → SETTLED` | `DRAFT/CONFIRMED → CANCELLED`

**Inventory:** `decrement` fires at `CONFIRMED → SHIPPED`

---

### Retail Buy (`/retail-buy`)

Customer selling gold to the shop at the counter. No inventory coupling.

**Status flow:** `DRAFT → CONFIRMED` | `DRAFT/CONFIRMED → CANCELLED`

**List filters:** `currentStatus`, `settlementPeriod`, `branchCode`

**Legacy sync fields:** `buyNumb`, `custCode`, `emplCode`, `brandText`, `sizeText`, `goldPriceSnapshot`

---

### Retail Sell (`/retail-sell`)

Shop selling gold to a customer at the counter. Inventory decrements when gold ships out.

**Status flow:** `DRAFT → CONFIRMED → SHIPPED` | `DRAFT/CONFIRMED → CANCELLED`

**Inventory:** `decrement` fires at `CONFIRMED → SHIPPED`

**List filters:** `currentStatus`, `settlementPeriod`, `branchCode`

**Legacy sync fields:** `saleNumb`, `custCode`, `emplCode`, `brandText`, `sizeText`, `goldPriceSnapshot`

---

### Receive (`/receive`)

Gold arriving at HQ from branches. Grouped by productType + purity + brand. Cancel only allowed within 2-hour grace period. Bot auto-confirms after grace period.

**Status flow:** `RECEIVED → CONFIRMED` | `RECEIVED → CANCELLED` (grace period only)

**Inventory:** `increment` fires at `RECEIVED → CONFIRMED`

**List filters:** `currentStatus`, `settlementPeriod`, `branchCode`

---

### Smelting (`/smelting`) — planned

Converting non-goldbar items into goldbar. Tracks output only (input is out of scope). Output is always goldbar (goldbar-only phase). Cancel only within grace period, bot auto-confirms.

**Status flow:** `DRAFT → CONFIRMED` | `DRAFT → CANCELLED` (grace period only)

**Inventory:** `increment` fires at `DRAFT → CONFIRMED`

**Fields:** `brandId`, `purityId`, `productTypeId`, `weight`, `totalCost` (business-calculated: input value − byproduct value − smelting fee — computation is out of scope, caller provides the value)

---

### Convert-out (`/convert-out`) — planned

Spending gold from inventory. Result documented as free text (non-gold output not tracked). Cancel only within grace period, bot auto-confirms.

**Status flow:** `DRAFT → CONFIRMED` | `DRAFT → CANCELLED` (grace period only)

**Inventory:** `decrement` fires at `DRAFT → CONFIRMED`

**Fields:** `brandId`, `purityId`, `productTypeId`, `weight`, `resultDescription` (free text)

---

## Architectural Pattern

Every domain follows the same structure:

```
core/<domain>/
  port/<domain>.port.ts            — domain errors, repository interface (Context.Tag), command shapes, allowedTransitions map
  application/<domain>.usecase.ts  — plain Effect functions, orchestration, inventory side-effects
  adapter/<domain>.repository.ts   — Drizzle ORM implementation
  adapter/<domain>.routes.ts       — Hono HTTP routes with Zod validation + toHttpError() mapping
  <domain>.md                      — domain spec
```

**All usecases are plain Effect functions** — no classes.

**Status log pattern** — every transaction domain uses two tables:
- `*_transactions` — the deal record, `currentStatus` is a write-through cache
- `*_statuses` — append-only log, one row per transition, never updated or deleted

**Transition guard** — `allowedTransitions` map in the port file. Invalid transition → `InvalidTransitionError` → HTTP 422.

**Grace period pattern** — cancel checks elapsed time since the initial status entry (`createdAt` on the status row, not `recordedAt` on the transaction). Window is 2 hours. After expiry → `GracePeriodExpiredError` → HTTP 422. Bot confirms via `createdBy: 'BOT-CONFIRM'`.

**Error handling** — `runEffect()` preserves typed domain errors. Each routes file has a `toHttpError(error)` function. Fallback is 500 with `JSON.stringify`.

**Weight resolution** — `infrastructure/weight.ts` exports `resolveWeights(purityId, weight)`. Called by all `createTransaction` usecases. See `core/weight-and-purity.md`.

**Settlement period** — `infrastructure/settlement.ts` (planned) exports `resolveSettlementPeriod(date)`. Auto-derived from `recordedAt` using Fri–Thu boundary. Callers never send it.

**Product type × purity constraint** — `resolveProductPurity(productTypeId, purityId)` (planned) validates the combination against `product_type_purities` join table. Called by all `createTransaction` usecases.

---

## Weight & Purity Rules

`purity.unitOfMeasure` drives the conversion direction on every `createTransaction`:

| unitOfMeasure | Purity | Caller sends | Server computes |
|---|---|---|---|
| `g` | 99.9 | `weight` in grams | `weightGb = weight / conversionFactor` |
| `gb` | 96.5 | `weight` in baht | `weightGm = weight * conversionFactor` |

`conversionFactor` is auto-resolved from `unit_conversions ORDER BY effectiveDate`. Full rationale in `core/weight-and-purity.md`.

---

## Settlement Period Rules

`settlementPeriod` is a reporting bucket — a week label (e.g. `"2026-W24"`) auto-computed from `recordedAt`. Callers never supply it.

- Boundary: **Friday to Thursday** (fixed)
- Format: ISO week string e.g. `"2026-W24"`
- Purpose: net buy/sell reporting per week — no locking or period management in current scope

Each domain exposes a split summary endpoint (not merged — keeps domains isolated):
- `GET /retail-buy/settlement/:period/summary`
- `GET /retail-sell/settlement/:period/summary`
- `GET /wholesale-buy/settlement/:period/summary`
- `GET /wholesale-sell/settlement/:period/summary`

---

## Product Type × Purity Constraint

Not all purities are valid for every product type:
- Goldbar: 99.9, 96.5
- Gold-plate: 96.5 only
- Jewelry (future): 99.9, 96.5, 90, 75

Admin configures valid combinations at go-live via `product_type_purities` join table in master data. `resolveProductPurity()` guards all `createTransaction` calls.

---

## Schema Files

| File | Tables |
|---|---|
| `master.schema.ts` | `gold_product_type`, `gold_brands`, `purities`, `bar_sizes`, `suppliers`, `supplier_product_types`, `suppler_brands`, `unit_conversion`, `branches`, `product_type_purities` (planned) |
| `inventory.schema.ts` | `inventory_lots`, `inventory_movements`, `stock_gain_adjustments`, `stock_loss_adjustments`, `inventory_daily_snapshots` |
| `wholesale-buy.schema.ts` | `whole_buy_transactions`, `whole_buy_statuses` |
| `wholesale-sell.schema.ts` | `whole_sell_transactions`, `whole_sell_statuses` |
| `retail-buy.schema.ts` | `retail_buy_transactions`, `retail_buy_statuses` |
| `retail-sell.schema.ts` | `retail_sell_transactions`, `retail_sell_statuses` |
| `received.schema.ts` | `received_transactions`, `received_statuses` |
| `smelting.schema.ts` | (planned) `smelting_transactions`, `smelting_statuses` |
| `convert-out.schema.ts` | (planned) `convert_out_transactions`, `convert_out_statuses` |

**Deleted (superseded):**
- `whole.schema.ts` — replaced by `wholesale-buy.schema.ts` and `wholesale-sell.schema.ts`
- `retail.schema.ts` — replaced by `retail-buy.schema.ts` and `retail-sell.schema.ts`
- `fulfillment.schema.ts` — deleted; branch transfer is out of scope (no branch inventory in current phase)
- `infrastructure/utils/usecase.ts` — superseded by `runtime.ts` types

---

## Open Items

1. **User FK** — `recordedBy / createdBy / movedBy / auditedBy` are plain `varchar`; blocked on employee/customer domain decision
2. **`custCode` / `emplCode` FK** — retail domains use legacy system codes; blocked on same decision
3. **Employee vs user identity** — recommendation: separate `employees` table (carries `emplCode`) from `users` (login only); `customers` table for `custCode`. Defer until legacy sync strategy is decided with stakeholders
4. **`users` table PK** — currently `serial` (integer); migrate to `uuid` before adding any user FKs
5. **DB migrations** — no migration files yet; run `drizzle-kit generate` then `drizzle-kit migrate` before any deployment
6. **Goldbar-to-goldbar conversion** — unclear if this is a convert-out + smelting pair or needs its own domain
7. **Jewelry inventory** — deferred to next phase; requires non-fungible inventory model (discrete items by design/SKU)
8. **`reverseDecrement()`** — implemented in inventory usecase but not wired to any domain yet

---

## Planned Work (next tasks in order)

1. `resolveSettlementPeriod(date)` utility — Fri–Thu boundary
2. Strip `settlementPeriod` from all `createTransaction` request schemas — auto-derive from `recordedAt`
3. Settlement summary endpoints — per domain (retail-buy, retail-sell, wholesale-buy, wholesale-sell)
4. `product_type_purities` join table + admin CRUD endpoint
5. `resolveProductPurity(productTypeId, purityId)` guard — wire into all `createTransaction` usecases
6. Smelting domain — full implementation
7. Convert-out domain — full implementation
8. DB migrations — after all schema changes are done
