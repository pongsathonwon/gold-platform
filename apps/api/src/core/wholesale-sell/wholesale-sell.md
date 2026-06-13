# Wholesale Sell Domain

## Core Concept

A wholesale sell is the shop **selling gold back to a supplier**. The deal is agreed first (`DRAFT → CONFIRMED`), then physical gold leaves the building (`CONFIRMED → SHIPPED`), then the money is settled (`SHIPPED → SETTLED`). Inventory decrements **at shipping** — the stock is gone when it physically leaves, not when the deal is struck.

The transaction record captures the deal terms. A separate append-only status log captures every state change for audit. `currentStatus` on the transaction is a write-through cache for query convenience — always recomputable from the status log.

---

## Tables

### `whole_sell_transactions`

One record per deal. Created once, never deleted. Only `currentStatus` is mutated (write-through from status log).

| Field                                | Description                                                      |
| ------------------------------------ | ---------------------------------------------------------------- |
| `id`                                 | UUID primary key                                                 |
| `supplierId`                         | FK → `suppliers.id` — who the gold is sold to                   |
| `purityId / brandId / productTypeId` | What kind of gold                                                |
| `weightGb / weightGm`                | Agreed weight                                                    |
| `conversionFactor`                   | GB-to-GM ratio snapshotted at creation time                      |
| `pricePerGb`                         | Agreed price per Gold Bath                                       |
| `totalAmount`                        | `weightGb * pricePerGb` — computed and stored at creation        |
| `settlementPeriod`                   | Week index (Fri–Thu) the deal belongs to                         |
| `currentStatus`                      | Denormalized latest status — `DRAFT \| CONFIRMED \| SHIPPED \| SETTLED \| CANCELLED` |
| `recordedBy`                         | Who created the transaction                                      |
| `recordedAt`                         | Creation timestamp                                               |

---

### `whole_sell_statuses`

Append-only status log. Never updated or deleted. Every status transition writes one row here and updates `currentStatus` on the transaction — both in the same DB transaction.

| Field           | Description                                              |
| --------------- | -------------------------------------------------------- |
| `id`            | UUID primary key                                         |
| `transactionId` | FK → `whole_sell_transactions.id`                        |
| `status`        | `DRAFT \| CONFIRMED \| SHIPPED \| SETTLED \| CANCELLED`  |
| `note`          | Optional free-text reason (required when CANCELLED)      |
| `createdBy`     | Who triggered this transition                            |
| `createdAt`     | Timestamp of the transition                              |

---

## Status Flow

```
DRAFT → CONFIRMED → SHIPPED → SETTLED
  ↓          ↓
CANCELLED  CANCELLED
```

| Transition          | Guard                                   | Inventory effect                                            |
| ------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `DRAFT → CONFIRMED` | none                                    | none                                                        |
| `CONFIRMED → SHIPPED` | none                                  | `decrement(...)` — FIFO drains lots, writes `-delta` movements |
| `SHIPPED → SETTLED` | none                                    | none — financial bookkeeping only                           |
| `DRAFT → CANCELLED` | none                                    | none                                                        |
| `CONFIRMED → CANCELLED` | none                                | none — stock was never decremented                          |

> `SHIPPED → CANCELLED` is **not allowed**. Once gold has left the building the movement cannot be undone unilaterally — a new buy transaction is required to bring stock back in.

> **No partial shipment.** A wholesale sell transaction represents exactly one shipment of the full agreed weight. `decrement` is called once at `CONFIRMED → SHIPPED` for the full `weightGb`. Splitting a deal into multiple shipments is out of scope — create separate transactions instead.

---

## Exposed Usecases

| Usecase            | HTTP                                  | Description                                          |
| ------------------ | ------------------------------------- | ---------------------------------------------------- |
| `createTransaction` | `POST /wholesale-sell`               | Creates transaction + initial `DRAFT` status row     |
| `advanceStatus`    | `POST /wholesale-sell/:id/status`     | Appends a status row, updates `currentStatus`, fires inventory side-effect if applicable |
| `getTransaction`   | `GET /wholesale-sell/:id`             | Returns transaction + full status history            |
| `listTransactions` | `GET /wholesale-sell`                 | List transactions, filterable by `currentStatus` and `settlementPeriod` |

---

## Cross-domain Inventory Coupling

The wholesale-sell domain calls inventory's internal usecases directly — inventory has no knowledge of wholesale-sell internals.

| Event                         | Call                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `CONFIRMED → SHIPPED`         | `decrement({ purityId, brandId, productTypeId, weightGb, weightGm, referenceType: 'WHOLESALE_SELL', referenceId: transaction.id, movedBy })` |

`referenceType: 'WHOLESALE_SELL'` is the registration string this domain owns in the inventory movements ledger.

---

## `advanceStatus` Transition Rules

Validated in the usecase before any DB write:

```
allowed transitions:
  DRAFT      → CONFIRMED | CANCELLED
  CONFIRMED  → SHIPPED   | CANCELLED
  SHIPPED    → SETTLED
  SETTLED    → (terminal — no further transitions)
  CANCELLED  → (terminal — no further transitions)
```

Invalid transition → `InvalidTransitionError` (domain error, maps to HTTP 422).

---

## Domain Errors

| Error                    | When                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `InvalidTransitionError` | Requested `toStatus` is not a legal next state                |
| `InsufficientStockError` | `decrement` fails — not enough inventory to fulfill the order (propagated from inventory domain) |
| `TransactionNotFoundError` | Transaction ID does not exist                               |

---

## Open Issues

1. **No user FK** — `recordedBy / createdBy` are plain `varchar`. Replace with FK after auth domain is settled.

2. **`SHIPPED → CANCELLED` recovery path** — if a shipment needs to be reversed after the fact, the correct flow is a new `whole_buy_transaction` (supplier returns the gold). No cancellation path is supported here.

3. **`conversionFactor` source** — must be snapshotted at creation time from `unit_conversions ORDER BY effectiveDate DESC LIMIT 1`, same invariant as inventory lots.
