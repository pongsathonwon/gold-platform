# Retail Buy Domain

## Core Concept

A retail buy is the shop **buying gold from a customer**. The transaction is recorded at the counter by a cashier, tied to a branch and a customer. **No inventory coupling.** Retail buy is pure transaction recording — the business cannot trace which physical gold came from which customer transaction. Inventory is adjusted separately when physical stock is received and counted, not at the point of sale.

Legacy sync fields (`buyNumb`, `custCode`, `emplCode`, `brandText`, `sizeText`) are stored as-is. The sync service is responsible for mapping plain-text brand/size to master data IDs. This domain stores both — the raw strings for sync fidelity and the resolved IDs for inventory coupling.

---

## Tables

### `retail_buy_transactions`

One record per counter transaction. Created once, never deleted. Only `currentStatus` is mutated.

| Field                                | Description                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `id`                                 | UUID primary key                                                             |
| `buyNumb`                            | Legacy system transaction number — unique, used for sync                     |
| `branchCode`                         | FK → `branches.branchCode` — where the transaction happened                 |
| `custCode`                           | Customer ID from legacy system — plain varchar, no FK                        |
| `emplCode`                           | Cashier employee ID from legacy system — plain varchar, no FK                |
| `purityId / brandId / productTypeId` | Resolved master data IDs — required for inventory coupling                   |
| `brandText`                          | Raw brand string from legacy system — sync service maps this to `brandId`    |
| `sizeText`                           | Raw size string from legacy system — sync service maps this to bar size      |
| `weightGb / weightGm`                | Weight at transaction time                                                   |
| `conversionFactor`                   | GB-to-GM ratio snapshotted at creation time                                  |
| `pricePerGb`                         | Price paid to customer per Gold Bath                                         |
| `goldPriceSnapshot`                  | Market gold price at transaction time — for reporting and net position calc  |
| `totalAmount`                        | `weightGb * pricePerGb` — computed and stored at creation                    |
| `settlementPeriod`                   | Week index (Fri–Thu) — used for net buy/sell tracking per week               |
| `currentStatus`                      | Write-through cache — `DRAFT \| CONFIRMED \| CANCELLED`                      |
| `recordedBy`                         | Cashier who recorded — plain varchar until auth domain is settled            |
| `recordedAt`                         | Creation timestamp                                                           |

---

### `retail_buy_statuses`

Append-only status log. Never updated or deleted.

| Field           | Description                                              |
| --------------- | -------------------------------------------------------- |
| `id`            | UUID primary key                                         |
| `transactionId` | FK → `retail_buy_transactions.id`                        |
| `status`        | `DRAFT \| CONFIRMED \| CANCELLED`                        |
| `note`          | Optional free-text (required when CANCELLED)             |
| `createdBy`     | Who triggered this transition                            |
| `createdAt`     | Timestamp of the transition                              |

---

## Status Flow

```
DRAFT → CONFIRMED
  ↓          ↓
CANCELLED  CANCELLED
```

| Transition          | Guard | Inventory effect |
| ------------------- | ----- | ---------------- |
| `DRAFT → CONFIRMED` | none  | none             |
| `DRAFT → CANCELLED` | none  | none             |
| `CONFIRMED → CANCELLED` | none | none          |

---

## Exposed Usecases

| Usecase             | HTTP                             | Description                                           |
| ------------------- | -------------------------------- | ----------------------------------------------------- |
| `createTransaction` | `POST /retail-buy`               | Creates transaction + initial `DRAFT` status row      |
| `advanceStatus`     | `POST /retail-buy/:id/status`    | Appends status row, updates `currentStatus`, fires inventory side-effect if applicable |
| `getTransaction`    | `GET /retail-buy/:id`            | Returns transaction + full status history             |
| `listTransactions`  | `GET /retail-buy`                | Filterable by `currentStatus`, `settlementPeriod`, and `branchCode` |

---

## Cross-domain Inventory Coupling

None. Retail buy has no inventory side-effects. Stock is adjusted via `stockGain` or the received flow when physical gold is counted in — not at the point of sale.

---

## `advanceStatus` Transition Rules

```
allowed transitions:
  DRAFT      → CONFIRMED | CANCELLED
  CONFIRMED  → CANCELLED
  CANCELLED  → (terminal)
```

---

## Domain Errors

| Error                      | When                                           |
| -------------------------- | ---------------------------------------------- |
| `InvalidTransitionError`   | Requested `toStatus` is not a legal next state |
| `TransactionNotFoundError` | Transaction ID does not exist                  |

---

## Open Issues

1. **`custCode` / `emplCode` FK** — currently plain varchar matching legacy system codes. Replace with FK once customer and employee domains are settled.

2. **`brandText` / `sizeText` mapping** — sync service owns the mapping from raw strings to `brandId` / bar size. This domain stores both and does not validate the mapping.

3. **No user FK** — `recordedBy / createdBy` are plain `varchar`. Replace with FK after auth domain is settled.

4. **`CONFIRMED → CANCELLED`** — allowed because there is no inventory side-effect to undo. Cancellation after confirmation is purely a record correction.
