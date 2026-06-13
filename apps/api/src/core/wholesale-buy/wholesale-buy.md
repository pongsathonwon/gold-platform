# Wholesale Buy Domain

## Core Concept

A wholesale buy is the shop **buying gold from a supplier**. The deal is agreed first (`DRAFT → CONFIRMED`), then physical gold arrives at the branch (`CONFIRMED → RECEIVED`), then the money is settled (`RECEIVED → SETTLED`). Inventory increments **at receiving** — the stock is gained when it physically arrives, not when the deal is struck.

Mirrors wholesale-sell in structure: one transaction per deal, one line item, append-only status log, `currentStatus` as write-through cache.

---

## Tables

### `whole_buy_transactions`

One record per deal. Created once, never deleted. Only `currentStatus` is mutated (write-through from status log).

| Field                                | Description                                                      |
| ------------------------------------ | ---------------------------------------------------------------- |
| `id`                                 | UUID primary key                                                 |
| `supplierId`                         | FK → `suppliers.id` — who the gold is bought from               |
| `purityId / brandId / productTypeId` | What kind of gold                                                |
| `weightGb / weightGm`                | Agreed weight                                                    |
| `conversionFactor`                   | GB-to-GM ratio snapshotted at creation time                      |
| `pricePerGb`                         | Agreed price per Gold Bath                                       |
| `totalAmount`                        | `weightGb * pricePerGb` — computed and stored at creation        |
| `settlementPeriod`                   | Week index (Fri–Thu) the deal belongs to                         |
| `currentStatus`                      | Denormalized latest status — `DRAFT \| CONFIRMED \| RECEIVED \| SETTLED \| CANCELLED` |
| `recordedBy`                         | Who created the transaction                                      |
| `recordedAt`                         | Creation timestamp                                               |

---

### `whole_buy_statuses`

Append-only status log. Never updated or deleted. Every status transition writes one row here and updates `currentStatus` on the transaction — both in the same DB transaction.

| Field           | Description                                              |
| --------------- | -------------------------------------------------------- |
| `id`            | UUID primary key                                         |
| `transactionId` | FK → `whole_buy_transactions.id`                         |
| `status`        | `DRAFT \| CONFIRMED \| RECEIVED \| SETTLED \| CANCELLED` |
| `note`          | Optional free-text reason (required when CANCELLED)      |
| `createdBy`     | Who triggered this transition                            |
| `createdAt`     | Timestamp of the transition                              |

---

## Status Flow

```
DRAFT → CONFIRMED → RECEIVED → SETTLED
  ↓          ↓
CANCELLED  CANCELLED
```

| Transition              | Guard | Inventory effect                                                    |
| ----------------------- | ----- | ------------------------------------------------------------------- |
| `DRAFT → CONFIRMED`     | none  | none                                                                |
| `CONFIRMED → RECEIVED`  | none  | `increment(...)` — creates a new lot, writes `+delta` movement      |
| `RECEIVED → SETTLED`    | none  | none — financial bookkeeping only                                   |
| `DRAFT → CANCELLED`     | none  | none                                                                |
| `CONFIRMED → CANCELLED` | none  | none — stock was never incremented                                  |

> `RECEIVED → CANCELLED` is **not allowed**. Once gold has entered inventory the lot exists — removing it requires a `stockLoss` adjustment, not a cancellation.

> **No partial receiving.** A wholesale buy transaction represents exactly one receipt of the full agreed weight. `increment` is called once at `CONFIRMED → RECEIVED` for the full `weightGb`. Splitting a deal into multiple receipts is out of scope — create separate transactions instead.

---

## Exposed Usecases

| Usecase              | HTTP                                | Description                                          |
| -------------------- | ----------------------------------- | ---------------------------------------------------- |
| `createTransaction`  | `POST /wholesale-buy`               | Creates transaction + initial `DRAFT` status row     |
| `advanceStatus`      | `POST /wholesale-buy/:id/status`    | Appends a status row, updates `currentStatus`, fires inventory side-effect if applicable |
| `getTransaction`     | `GET /wholesale-buy/:id`            | Returns transaction + full status history            |
| `listTransactions`   | `GET /wholesale-buy`                | List transactions, filterable by `currentStatus` and `settlementPeriod` |

---

## Cross-domain Inventory Coupling

| Event                   | Call                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `CONFIRMED → RECEIVED`  | `increment({ sourceId: transaction.id, purityId, brandId, productTypeId, weightGb, weightGm, conversionFactor, totalCost: totalAmount, referenceType: 'WHOLESALE_BUY', referenceId: transaction.id, createdBy })` |

`referenceType: 'WHOLESALE_BUY'` is the registration string this domain owns in the inventory movements ledger.

`totalCost` passed to `increment` is `totalAmount` — the agreed purchase price becomes the cost basis of the lot.

---

## `advanceStatus` Transition Rules

```
allowed transitions:
  DRAFT      → CONFIRMED | CANCELLED
  CONFIRMED  → RECEIVED  | CANCELLED
  RECEIVED   → SETTLED
  SETTLED    → (terminal)
  CANCELLED  → (terminal)
```

Invalid transition → `InvalidTransitionError` (domain error, maps to HTTP 422).

---

## Domain Errors

| Error                      | When                                            |
| -------------------------- | ----------------------------------------------- |
| `InvalidTransitionError`   | Requested `toStatus` is not a legal next state  |
| `TransactionNotFoundError` | Transaction ID does not exist                   |

---

## Open Issues

1. **No user FK** — `recordedBy / createdBy` are plain `varchar`. Replace with FK after auth domain is settled.

2. **`RECEIVED → CANCELLED` recovery path** — if received gold needs to be returned, the correct flow is a new `whole_sell_transaction` back to the supplier. No cancellation path is supported here.

3. **`conversionFactor` source** — must be snapshotted at creation time from `unit_conversions ORDER BY effectiveDate DESC LIMIT 1`, same invariant as inventory lots.

4. **`wholeBuyTransactions` in whole.schema.ts** — the existing table is superseded by this domain's schema. It had no supplierId, no status, and a typo (`purcahsedAt`). The new table replaces it.
