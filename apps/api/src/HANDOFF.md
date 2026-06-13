# API Handoff Document

**Branch:** `dev`
**Date:** 2026-06-13 (updated)

---

## What Was Built

Four transaction domains were designed and implemented from scratch, all following the same hexagonal architecture pattern. The inventory domain was also wired as the shared internal service that all outbound gold flows call into.

---

## Domain Overview

### Inventory (`/inventories`)

Internal accounting service. Tracks gold weight in anonymous lots by brand + purity + product type. Uses FIFO for all outbound movements.

**Exposed HTTP:** `GET /`, `GET /volume`, `POST /gain`, `POST /loss`

**Internal cross-domain commands** (never called from HTTP directly):
| Command | Called by | Effect |
|---|---|---|
| `increment` | wholesale-buy at `RECEIVED` | Creates a new lot + `+delta` movement |
| `decrement` | wholesale-sell at `SHIPPED`, retail-sell at `SHIPPED` | FIFO drains lots + `-delta` movement per lot |
| `reverseDecrement` | (available, not yet wired) | Restores lots from original movements |

**`referenceType` registry** — each domain registers its own string in `inventory_movements`:
- `WHOLESALE_BUY`
- `WHOLESALE_SELL`
- `RETAIL_SELL`
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

Customer selling gold to the shop at the counter. **No inventory coupling** — the business cannot trace which customer transaction maps to which physical lot. Inventory is adjusted separately via `stockGain` or the received flow.

**Status flow:** `DRAFT → CONFIRMED` | `DRAFT/CONFIRMED → CANCELLED`

**Legacy sync fields:** `buyNumb`, `custCode`, `emplCode`, `brandText`, `sizeText`, `goldPriceSnapshot`

---

### Retail Sell (`/retail-sell`)

Shop selling gold to a customer at the counter. Inventory decrements when gold ships out.

**Status flow:** `DRAFT → CONFIRMED → SHIPPED` | `DRAFT/CONFIRMED → CANCELLED`

**Inventory:** `decrement` fires at `CONFIRMED → SHIPPED`

**Legacy sync fields:** `saleNumb`, `custCode`, `emplCode`, `brandText`, `sizeText`, `goldPriceSnapshot`

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

**All usecases are plain Effect functions** — no classes. The class-based pattern was fully retired in this session. Every usecase builds a `Layer` internally and uses `runEffect()` from `infrastructure/runtime.ts`.

**Status log pattern** — every transaction domain uses two tables:
- `*_transactions` — the deal record, `currentStatus` is a write-through cache
- `*_statuses` — append-only log, one row per transition, never updated or deleted

**Transition guard** — `allowedTransitions` map in the port file. Invalid transition → `InvalidTransitionError` → HTTP 422.

**Error handling** — `runEffect()` preserves typed domain errors. Each routes file has a `toHttpError(error)` function that discriminates by `instanceof` and returns the correct status code. Fallback is 500 with `JSON.stringify`.

**Weight resolution** — `infrastructure/weight.ts` exports `resolveWeights(purityId, weight)`. Called by all four `createTransaction` usecases. See `core/weight-and-purity.md` for the full decision record.

---

## Weight & Purity Rules

`purity.unitOfMeasure` drives the conversion direction on every `createTransaction`:

| unitOfMeasure | Purity | Caller sends | Server computes |
|---|---|---|---|
| `g` | 99.9 | `weight` in grams | `weightGb = weight / conversionFactor` |
| `gb` | 96.5 | `weight` in baht | `weightGm = weight * conversionFactor` |

`conversionFactor` is auto-resolved from `unit_conversions ORDER BY effectiveDate` — callers no longer supply it. Both `weightGb`, `weightGm`, and `conversionFactor` are snapshotted on the transaction row.

Full rationale in `core/weight-and-purity.md`.

---

## Schema Files

| File | Tables |
|---|---|
| `master.schema.ts` | `gold_product_type`, `gold_brands`, `purities`, `bar_sizes`, `suppliers`, `supplier_product_types`, `suppler_brands`, `unit_conversion`, `branches` |
| `inventory.schema.ts` | `inventory_lots`, `inventory_movements`, `stock_gain_adjustments`, `stock_loss_adjustments`, `inventory_daily_snapshots` |
| `wholesale-buy.schema.ts` | `whole_buy_transactions`, `whole_buy_statuses` |
| `wholesale-sell.schema.ts` | `whole_sell_transactions`, `whole_sell_statuses` |
| `retail-buy.schema.ts` | `retail_buy_transactions`, `retail_buy_statuses` |
| `retail-sell.schema.ts` | `retail_sell_transactions`, `retail_sell_statuses` |
| `fulfillment.schema.ts` | Draft — not yet tied to a domain. Keep pending domain decision. |
| `received.schema.ts` | Draft — superseded by wholesale-buy pattern. Needs implementation or deletion. |

**Deleted (superseded):**
- `whole.schema.ts` — replaced by `wholesale-buy.schema.ts` and `wholesale-sell.schema.ts`.
- `retail.schema.ts` — replaced by `retail-buy.schema.ts` and `retail-sell.schema.ts`.
- `infrastructure/utils/usecase.ts` — superseded by `runtime.ts` types.

---

## Open Items

1. **`received.schema.ts`** — draft schema kept intentionally. Needs a domain implementation or deletion once the received flow is scoped.

2. **`fulfillment.schema.ts`** — draft schema not yet tied to any domain. Decide whether to keep, repurpose, or delete.

3. **User FK** — all `recordedBy / createdBy / movedBy / auditedBy` fields are plain `varchar`. Replace with FK once auth domain is finalized.

4. **`custCode` / `emplCode` FK** — retail domains use legacy system codes. Replace with FK once customer and employee domains exist.

5. **DB migrations** — no migration files exist yet. All schemas are Drizzle definitions only. Run `drizzle-kit generate` and `drizzle-kit migrate` before any deployment.

---

## Completed This Session

- Deleted superseded files: `retail.schema.ts`, `runtime-test.ts`
- Committed infrastructure refactor: `runEffect()`, `BaseError`, function-based usecases, `DatabaseConnectionError` shape, `brand.repository.ts` rename
- Converted all master domain usecases (bar-size, brand, branch, purity, product-type, supplier) from class-based to plain Effect functions
- Converted all master domain routes from `handleExit` + class instantiation to `runEffect` + `toHttpError`
- Cleaned all port files: removed dead `AppReturnShape`, `TBaseError`, `ForXxxUseCase`, `XxxErrorTag` types
- Implemented HTTP error mapping: `TransactionNotFoundError` → 404, `InvalidTransitionError` → 422 across all transaction domains
- Implemented `resolveWeights`: auto-lookup of purity unit and conversion factor on `createTransaction`; callers now send a single `weight` field
- Added `core/weight-and-purity.md` decision record
