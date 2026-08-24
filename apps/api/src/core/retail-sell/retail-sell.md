# Retail Sell Domain

## Core Concept

A retail sell is the shop **selling gold to a customer** at the counter — written up after the fact,
not captured live. Like retail-buy it exists to answer one question: **was the price we dealt at a
good one?**

It is the exact mirror of [retail-buy](../retail-buy/retail-buy.md), and unusually for this codebase
the two are near-identical rather than merely symmetric: the same row shape, the same status
machine, the same rules. A buy and a sell here differ in direction and in nothing else. That is why
the web app renders both from one set of pages and one config, and why the shared types carry one
create schema shape for both.

**No inventory coupling.** This is a deliberate reversal — see below.

---

## The inventory decrement was removed

The previous version decremented stock on `CONFIRMED → SHIPPED`, calling
`decrement({ referenceType: 'RETAIL_SELL', ... })`.

Shipping is deferred. That made the transition unreachable and the decrement with it, leaving live
code that moved gold down a path nothing could take — a trap for the next reader, who would find a
plausible-looking inventory hook and reasonably assume it fires.

So both retail domains now move no stock at all, symmetrically, and the balance is maintained by
hand through `POST /inventory/gain|loss`. `retail-sell.usecase.test.ts` asserts that **no inventory
usecase is called** on either create or void, which is what keeps it that way.

Restoring it later means adding `SHIPPED` back to `RETAIL_SELL_TRANSITIONS` and restoring the
decrement — no migration, since the enum value was never removed. The test named *"refuses to ship,
because shipping is not built"* is the one that will fail loudly if someone does the first without
the second.

---

## Tables

`retail_sell_transactions` and `retail_sell_statuses` are field-identical to their retail-buy
counterparts — see [retail-buy.md](../retail-buy/retail-buy.md) for the column table, the note on
why the six POS-sync columns were dropped in migration 0017, and the reasoning behind `operationFee`
sitting outside `totalAmount`.

The one difference is the status enum, which additionally carries `SHIPPED`.

On this side `pricePerGb` is what the customer was **charged** and `operationFee` is typically
ค่าบล็อค on ทองแผ่น — the margin-capture half of the business. Keeping it out of `totalAmount` is
what stops a ทองแผ่น sale reading as a better price per gold baht than it achieved.

---

## Status Flow

```
CONFIRMED ──> CANCELLED

(SHIPPED exists in the enum, reachable from nothing)
```

`createTransaction` lands directly on `CONFIRMED` and writes one status row. `DRAFT` and `SHIPPED`
both survive as enum values and are unreachable — the first for a future POS feed, the second for
future shipping.

| Transition | Guard | Inventory effect |
| --- | --- | --- |
| `CONFIRMED → CANCELLED` | note required | none |

---

## Weights are measured, not ordered

`resolveMeasuredQuantity`, exactly as on the buy side: what crossed the counter weighs what it
weighs, and the supplier ordering rules would refuse a real trade. The product/purity pairing is
still validated.

---

## Endpoints

| Usecase | HTTP | Description |
| --- | --- | --- |
| `createTransaction` | `POST /retail-sell` | creates the transaction + its `CONFIRMED` status row |
| `advanceStatus` | `POST /retail-sell/:id/status` | appends a status row; returns the status reached |
| `getTransaction` | `GET /retail-sell/:id` | transaction + full status history |
| `listTransactions` | `GET /retail-sell` | filters: `currentStatus`, `settlementPeriod`, `branchCode`, `from`/`to` |

Behind `authMiddleware`, no `requireRole`, actor from the JWT. Same list window and sort as
retail-buy.

---

## Cross-domain Inventory Coupling

**None.** The `RETAIL_SELL` entry in `TRANSACTION_TYPES` remains available as a `referenceType` for
manual gain/loss adjustments, which is how a retail-driven stock correction is recorded today.

---

## Domain Errors

Identical to retail-buy: `TransactionNotFoundError` (404), `InvalidTransitionError` (422),
`NoteRequiredError` (422), `ProductTypePurityNotFoundError` (422). `InsufficientStockError` is
**gone** — nothing here can be short, because nothing here draws on a pool.

---

## Open Issues

See [retail-buy.md](../retail-buy/retail-buy.md); they apply unchanged. Additionally:

1. **Shipping.** Deferred, along with the decrement. A counter sale is hand-over-the-counter; the
   `SHIPPED` state is for deferred delivery and paper contracts, which are not built.
2. **Customer deposits.** Gold left with the shop for safekeeping without an operating fee is
   **custody, not a trade** — title does not transfer. It needs its own domain and must never be
   recorded here.
