# Inventory Domain

> ⚠️ **STALE — do not design against this file.** It describes an early **lot-based FIFO** design (`inventory_lots`, `remainingWeightGb`, FIFO picking) that was never implemented. The shipped model is **aggregate balance + live WAC, no lots**. Source of truth is [`apps/api/CLAUDE.md`](../../../CLAUDE.md) → "Inventory Domain" and the code in `application/inventory.usecase.ts` / `adapter/inventory.repository.ts`. Key differences: one `inventory_balance` row per pool (not lots); outbound cost = live `totalCost/totalWeightGb` computed in the locked decrement (not FIFO, not a daily snapshot); gain takes `pricePerGb`; gain/loss `referenceType` comes from the shared `TRANSACTION_TYPES` list. Kept only for historical context.

## Core Concept

Gold has no physical lot stamp. The company tracks inventory as anonymous weight pools by brand and purity. A **lot** is a virtual accounting bucket — not a physical bar identity. The **transaction** that created the gold (received, stock gain) is the real business identity. Lot movements are accounting side effects of transaction status changes.

---

## Tables

### `inventory_lots`

Represents a batch of gold entering the company's possession. Created once and mostly immutable.

| Field                                | Description                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `sourceId`                           | FK to `received_transactions` or `stock_gain_adjustments` — the event that created this lot |
| `purityId / brandId / productTypeId` | What kind of gold                                                                           |
| `weightGb / weightGm / totalCost`    | Original values at creation — never updated                                                 |
| `conversionFactor`                   | GB-to-GM ratio locked at creation time                                                      |
| `remainingWeightGb / remainingCost`  | Mutable — decremented on each outbound movement in the same DB transaction                  |
| `status`                             | `active \| void` — void is set only by manual stock loss or correction                      |

**Invariant:** `remainingWeightGb` and `remainingCost` always equal `weightGb/totalCost + SUM(movements.weightGbDelta/costDelta)` for this lot.

---

### `inventory_movements`

Append-only ledger. Every change to any lot produces one movement record. Never written standalone — always fired by a transaction status change.

| Field                                       | Description                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `lotId`                                     | Which lot was affected                                                        |
| `referenceType`                             | Caller-provided string — each domain registers its own (e.g. `WHOLESALE_BUY`, `FULFILLMENT`) |
| `referenceId`                               | FK to the source transaction record                                           |
| `weightGbDelta / weightGmDelta / costDelta` | Signed — positive = stock in, negative = stock out                            |
| `fromStatus / toStatus`                     | TODO: lot status transition per movement                                      |

---

### `stock_gain_adjustments`

Manual inventory gain — physical count found unrecorded gold, or data correction. Creates a new lot.

Flow: insert adjustment → insert lot (`sourceId = adjustment.id`) → insert movement `+delta`

| Field                                | Description                                           |
| ------------------------------------ | ----------------------------------------------------- |
| `purityId / brandId / productTypeId` | Gold spec for the new lot                             |
| `weightGb / weightGm / totalCost`    | Full lot value — required because no prior lot exists |
| `reason`                             | `stock_count_gain \| correction`                      |
| `notes / auditedBy / auditedAt`      | Audit trail                                           |

---

### `stock_loss_adjustments`

Manual inventory loss — damage, lost item, or data correction. Drains existing lots via FIFO.

Flow: insert adjustment → FIFO find lots covering the loss → insert movement `-delta` per lot touched → update `remainingWeightGb / remainingCost` per lot

| Field                                | Description                                                      |
| ------------------------------------ | ---------------------------------------------------------------- |
| `purityId / brandId / productTypeId` | Identifies which pool to drain from                              |
| `weightGb / weightGm`                | How much to drain — no `totalCost` (derived from lot cost basis) |
| `reason`                             | `stock_count_loss \| damage \| lost \| correction`               |
| `notes / auditedBy / auditedAt`      | Audit trail                                                      |

---

### `inventory_daily_snapshots`

End-of-day immutable summary. Computed nightly from `SUM(remainingWeightGb)` and `SUM(remainingCost)` across active lots grouped by `purityId / brandId / productTypeId`. Used for reporting — not the live source of truth.

---

## Exposed Usecases

| Usecase              | Description                                                      |
| -------------------- | ---------------------------------------------------------------- |
| `listLots`           | List all available lots with remaining weight > 0                |
| `getInventoryVolume` | Current total weight and value grouped by brand and product type |
| `stockGain`          | Manual adjustment gain — creates a new lot                       |
| `stockLoss`          | Manual adjustment loss — FIFO drains existing lots               |

---

## Internal Usecases (cross-domain)

Called by other domains (received, fulfillment) via command — never directly from HTTP routes.

| Usecase            | Trigger                                      | Description                                       |
| ------------------ | -------------------------------------------- | ------------------------------------------------- |
| `increment`        | `received_transactions` status → `completed` | Creates lot + movement `+delta`                   |
| `decrement`        | `fulfillments` status → `in_transit`         | FIFO drains lots + movement `-delta` per lot      |
| `reverseDecrement` | `fulfillments` status → `rejected`           | Restores lots + movement `+delta` per lot touched |

---

## FIFO Picking Logic

Shared internal mechanic used by both `stockLoss` and `decrement`. They are distinct operations — different callers, different reference types, different audit requirements — but both resolve to the same picking algorithm:

1. Select lots matching `brandId + purityId + productTypeId` where `status = active` and `remainingWeightGb > 0`, ordered by `createdAt ASC`
2. Drain oldest lot first — take `MIN(lot.remainingWeightGb, remaining)` from each
3. For each lot touched: insert movement with signed `-delta`, update `remainingWeightGb` and `remainingCost`
4. If total available weight across all lots is less than requested — rollback entirely

### `stockLoss` (public, manual)

- Caller: HTTP API
- Requires: `auditedBy`, `reason` enum, optional `notes`
- Creates: `stock_loss_adjustments` record first, then runs FIFO
- `referenceType: STOCK_LOSS`, `referenceId: stock_loss_adjustments.id`
- Rollback: cancel the adjustment record, no movements written

### `decrement` (internal, automated)

- Caller: fulfillment domain — fires when fulfillment status → `in_transit`
- No adjustment record created
- `referenceType: FULFILLMENT`, `referenceId: fulfillments.id`
- Rollback: `reverseDecrement` fires when fulfillment status → `rejected`, inserts compensating `+delta` movements per lot touched

---

## Open Issues

1. ~~Lot status~~ — resolved: `active | void` added to schema. Lot is infrastructure, status derived from transaction ownership. No `fromStatus / toStatus` on movements needed.

2. ~~LIFO vs FIFO for loss~~ — resolved: FIFO confirmed for `stockLoss` (fair default, no traceable lot) and `decrement` (stock rotation business rule). Same algorithm, different intent.

3. ~~Wholesale lot link~~ — resolved: wholesale domain's responsibility. Calls `increment` / `decrement` as cross-domain commands, providing its own `referenceType` (`WHOLESALE_BUY` / `WHOLESALE_SALE`) and `referenceId`. Inventory has no knowledge of wholesale internals.

4. ~~Retail lot link~~ — resolved: same pattern as wholesale. Retail domain calls `increment` / `decrement` with `referenceType` (`RETAIL_BUY` / `RETAIL_SALE`). Each domain owns its inventory wiring.

5. **No user FK** — `createdBy / auditedBy / movedBy` are plain `varchar`. TODO: after auth domain is settled, replace with proper FK to users table.

6. ~~`conversionFactor` source~~ — resolved: factor is snapshotted on the lot at creation time, intentionally immutable. Application must look up current rate from `unit_conversions ORDER BY effectiveDate DESC LIMIT 1` when creating a lot.
