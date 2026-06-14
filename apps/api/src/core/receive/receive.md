# receive domain

## definition

Receive documents gold items that have physically arrived at HQ from branches (typically retail-buy transfers). The document is created after all physical processes are done — not when a shipment is expected.

- management groups arriving items by productType, purity, and brand (fungibility)
- each group becomes one receive transaction
- a 1-2 hour grace period allows cancellation in case of input mistakes
- confirming the document locks it and triggers inventory increment
- mistakes after confirmation are corrected via stock loss adjustment, not reversal

## status flow

```
RECEIVED → CONFIRMED (terminal)
      └──→ CANCELLED (grace period only)
```

| transition | trigger | side effect |
| --- | --- | --- |
| RECEIVED → CONFIRMED | management confirms (or bot auto-confirms after grace period) | inventory lot created (`referenceType: 'RECEIVED'`) |
| RECEIVED → CANCELLED | cancelled within grace period | — |

CONFIRMED is terminal. There is no path back once inventory has been incremented.

## grace period

Cancel is only allowed within **2 hours** of the `createdAt` timestamp on the `RECEIVED` status row (the append-only log entry, not `recordedAt` on the transaction). The usecase enforces this check and rejects the cancel if the window has passed.

## auto-confirm (bot)

A background job may advance `RECEIVED → CONFIRMED` after the grace period expires using a bot employee ID (e.g. `'BOT-CONFIRM'`) as `updatedBy`. The status log records `createdBy: 'BOT-CONFIRM'` so auto-confirms are distinguishable from human confirms.

## fields

| field | notes |
| --- | --- |
| `branchCode` | originating branch |
| `purityId` | gold purity (drives weight conversion) |
| `brandId` | gold brand |
| `productTypeId` | product category |
| `weightGb` / `weightGm` | snapshotted at creation via `resolveWeights` |
| `conversionFactor` | snapshotted from `unit_conversions` at creation |
| `totalCost` | management-calculated value, required at creation |
| `settlementPeriod` | week index e.g. `"2026-W24"` |
| `currentStatus` | write-through cache of latest status row |

## inventory increment

Fires exactly once on `RECEIVED → CONFIRMED`. `totalCost` is already on the transaction (set at creation) so no additional input is needed at confirm time.

## post-confirmation corrections

If a confirmed document has wrong data (weight, branch, etc.), the correct remedy is:

1. stock loss adjustment against the affected lot
2. create a new corrected receive transaction

The original receive record is never modified or reversed — it remains the honest record of what was claimed when the gold arrived.

## api

| method | path | description |
| --- | --- | --- |
| POST | `/receive` | create a new receive transaction (status: RECEIVED, totalCost required) |
| GET | `/receive` | list transactions (filter: `currentStatus`, `settlementPeriod`, `branchCode`) |
| GET | `/receive/:id` | get transaction + status history |
| POST | `/receive/:id/status` | advance status (`CONFIRMED` or `CANCELLED`) |

## files

```
core/receive/
  receive.md                          — this file
  port/receive.port.ts                — errors, repository interface, command shapes, transitions
  application/receive.usecase.ts      — createTransaction, advanceStatus, getTransaction, listTransactions
  adapter/receive.repository.ts       — Drizzle ORM implementation
  adapter/receive.routes.ts           — Hono HTTP routes

infrastructure/db/schema/
  received.schema.ts                  — received_transactions + received_statuses tables
```
