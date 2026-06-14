# Retail Sell Domain

## Core Concept

A retail sell is the shop **selling gold to a customer** at the counter. Inventory decrements **at shipping** — stock leaves when the order is physically dispatched, not at confirmation.

Legacy sync fields (`saleNumb`, `custCode`, `emplCode`, `brandText`, `sizeText`) are stored as-is. The sync service handles mapping plain-text brand/size to master data IDs.

---

## Tables

### `retail_sell_transactions`

One record per counter transaction. Created once, never deleted. Only `currentStatus` is mutated.

| Field                                | Description                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `id`                                 | UUID primary key                                                             |
| `saleNumb`                           | Legacy system transaction number — unique, used for sync                     |
| `branchCode`                         | FK → `branches.branchCode` — where the transaction happened                 |
| `custCode`                           | Customer ID from legacy system — plain varchar, no FK                        |
| `emplCode`                           | Cashier employee ID from legacy system — plain varchar, no FK                |
| `purityId / brandId / productTypeId` | Resolved master data IDs — required for inventory coupling                   |
| `brandText`                          | Raw brand string from legacy system — sync service maps this to `brandId`    |
| `sizeText`                           | Raw size string from legacy system — sync service maps this to bar size      |
| `weightGb / weightGm`                | Weight at transaction time                                                   |
| `conversionFactor`                   | GB-to-GM ratio snapshotted at creation time                                  |
| `pricePerGb`                         | Price charged to customer per Gold Bath                                      |
| `goldPriceSnapshot`                  | Market gold price at transaction time — for reporting and net position calc  |
| `totalAmount`                        | `weightGb * pricePerGb` — computed and stored at creation                    |
| `settlementPeriod`                   | Week index (Fri–Thu) — used for net buy/sell tracking per week               |
| `currentStatus`                      | Write-through cache — `DRAFT \| CONFIRMED \| SHIPPED \| CANCELLED`           |
| `recordedBy`                         | Cashier who recorded — plain varchar until auth domain is settled            |
| `recordedAt`                         | Creation timestamp                                                           |

---

### `retail_sell_statuses`

Append-only status log. Never updated or deleted.

| Field           | Description                                              |
| --------------- | -------------------------------------------------------- |
| `id`            | UUID primary key                                         |
| `transactionId` | FK → `retail_sell_transactions.id`                       |
| `status`        | `DRAFT \| CONFIRMED \| SHIPPED \| CANCELLED`             |
| `note`          | Optional free-text (required when CANCELLED)             |
| `createdBy`     | Who triggered this transition                            |
| `createdAt`     | Timestamp of the transition                              |

---

## Status Flow

```
DRAFT → CONFIRMED → SHIPPED
  ↓          ↓
CANCELLED  CANCELLED
```

| Transition              | Guard           | Inventory effect                                              |
| ----------------------- | --------------- | ------------------------------------------------------------- |
| `DRAFT → CONFIRMED`     | none            | none                                                          |
| `CONFIRMED → SHIPPED`   | sufficient stock | `decrement(...)` — FIFO drains lots, writes `-delta` movement |
| `DRAFT → CANCELLED`     | none            | none                                                          |
| `CONFIRMED → CANCELLED` | none            | none — stock was never decremented                            |

> `SHIPPED → CANCELLED` is **not allowed**. Once inventory has been decremented the lot movements exist — reversing requires a new retail-buy transaction to bring stock back in, not a cancellation.

---

## Exposed Usecases

| Usecase             | HTTP                              | Description                                           |
| ------------------- | --------------------------------- | ----------------------------------------------------- |
| `createTransaction` | `POST /retail-sell`               | Creates transaction + initial `DRAFT` status row      |
| `advanceStatus`     | `POST /retail-sell/:id/status`    | Appends status row, updates `currentStatus`, fires inventory side-effect if applicable |
| `getTransaction`    | `GET /retail-sell/:id`            | Returns transaction + full status history             |
| `listTransactions`  | `GET /retail-sell`                | Filterable by `currentStatus` and `settlementPeriod`  |

---

## Cross-domain Inventory Coupling

| Event               | Call                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIRMED → SHIPPED` | `decrement({ purityId, brandId, productTypeId, weightGb, weightGm, referenceType: 'RETAIL_SELL', referenceId: transaction.id, movedBy })` |

`referenceType: 'RETAIL_SELL'` is the registration string this domain owns in the inventory movements ledger.

---

## `advanceStatus` Transition Rules

```
allowed transitions:
  DRAFT      → CONFIRMED | CANCELLED
  CONFIRMED  → SHIPPED   | CANCELLED
  SHIPPED    → (terminal)
  CANCELLED  → (terminal)
```

---

## Domain Errors

| Error                      | When                                                                              |
| -------------------------- | --------------------------------------------------------------------------------- |
| `InvalidTransitionError`   | Requested `toStatus` is not a legal next state                                    |
| `TransactionNotFoundError` | Transaction ID does not exist                                                     |
| `InsufficientStockError`   | `decrement` fails — not enough inventory (propagated from inventory domain)       |

---

## Open Issues

1. **`custCode` / `emplCode` FK** — plain varchar matching legacy system codes. Replace with FK once customer and employee domains are settled.

2. **`brandText` / `sizeText` mapping** — sync service owns the mapping. This domain stores both raw strings and resolved IDs.

3. **No user FK** — `recordedBy / createdBy` are plain `varchar`. Replace with FK after auth domain is settled.

4. **`SHIPPED → CANCELLED` is not supported** — once inventory is decremented the lot movements are permanent. Reversal requires a new `retail-buy` transaction to bring stock back in. `CONFIRMED → CANCELLED` (before shipping) is safe and requires no inventory undo.
