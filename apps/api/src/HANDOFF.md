# API Handoff Document

**Branch:** `dev`
**Date:** 2026-06-13

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
| `increment` | wholesale-buy at `RECEIVED`, | Creates a new lot + `+delta` movement |
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
  port/<domain>.port.ts         — domain errors, repository interface (Context.Tag), command shapes, allowedTransitions map
  application/<domain>.usecase.ts — orchestration, inventory side-effects
  adapter/<domain>.repository.ts  — Drizzle ORM implementation
  adapter/<domain>.routes.ts      — Hono HTTP routes with Zod validation
  <domain>.md                     — domain spec
```

**Status log pattern** — every transaction domain uses two tables:
- `*_transactions` — the deal record, `currentStatus` is a write-through cache
- `*_statuses` — append-only log, one row per transition, never updated or deleted

**Transition guard** — `allowedTransitions` map in the port file. Invalid transition → `InvalidTransitionError` (HTTP 422 territory, currently returns 500 — see open items).

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

**Deleted (superseded):**
- `whole.schema.ts` — replaced by `wholesale-buy.schema.ts` and `wholesale-sell.schema.ts`. Had no status, no `supplierId`, and a typo (`purcahsedAt`).
- `retail.schema.ts` — replaced by `retail-buy.schema.ts` and `retail-sell.schema.ts`. Same issues.

---

## Unstaged / Pending Work

The following files are modified but not yet committed — they are part of an infrastructure refactor that was in progress before this session:

| File | Change |
|---|---|
| `infrastructure/runtime.ts` | Added `runEffect()` helper, `BaseError` type, `Result<T,E>` shape |
| `infrastructure/db/client.ts` | Improved `DatabaseConnectionError` shape, fixed `healthCheck` error mapping |
| `core/master/application/bar-size.usecase.ts` | Refactored from class-based to function-based (matches inventory pattern) |
| `core/master/adapter/inbound/bar-size.routes.ts` | Updated to use `runEffect()` |
| `core/master/adapter/outbound/brand.repository.ts` | Renamed `goldBrands` → `brands` (schema rename) |
| `infrastructure/db/schema/master.schema.ts` | Minor comment move |
| `infrastructure/utils/usecase.ts` | Deleted — superseded by `runtime.ts` types |

**Untracked files** (not yet decided):
- `core/inventory/inventory.md` — domain spec doc, ready to commit
- `infrastructure/db/schema/fulfillment.schema.ts` — draft schema, not yet tied to a domain
- `infrastructure/db/schema/received.schema.ts` — draft schema, superseded by wholesale-buy pattern
- `infrastructure/db/schema/retail.schema.ts` — superseded, safe to delete
- `infrastructure/runtime-test.ts` — empty file

---

## Open Items

1. **HTTP error mapping** — `InvalidTransitionError` and `TransactionNotFoundError` currently fall through to a generic 500. They should map to 422 and 404 respectively. The `runEffect()` helper returns a string error — needs domain error discrimination at the route level or a structured error handler.

2. **`retail.schema.ts` cleanup** — untracked file, superseded. Safe to delete.

3. **`received.schema.ts` / `fulfillment.schema.ts`** — draft schemas that don't map to any active domain. Decide whether to keep, repurpose, or delete.

4. **User FK** — all `recordedBy / createdBy / movedBy / auditedBy` fields are plain `varchar`. Replace with FK once auth domain is finalized.

5. **`custCode` / `emplCode` FK** — retail domains use legacy system codes. Replace with FK once customer and employee domains exist.

6. **DB migrations** — no migration files exist yet. All schemas are Drizzle definitions only. Run `drizzle-kit generate` and `drizzle-kit migrate` before any deployment.

7. **`conversionFactor` lookup** — all domains snapshot the conversion factor at creation time from `unit_conversions ORDER BY effectiveDate DESC LIMIT 1`. This lookup is not yet implemented in any usecase — currently the caller must provide the value. Should be auto-resolved in `createTransaction`.
