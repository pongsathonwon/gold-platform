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

**The write-up moves no stock; one further step does.** `CONFIRMED → PACKED` takes the gold out of
inventory, and is where a sale stops for now.

---

## The inventory decrement is back, on `PACKED`

History, because the code comments used to tell the opposite story: the first version decremented
on `CONFIRMED → SHIPPED`. Shipping was deferred, which left that decrement on an unreachable path,
so it was removed and both retail domains moved no stock at all — the balance was corrected by hand
through `POST /inventory/gain|loss`.

It now decrements on entering **`PACKED`**, the same edge wholesale-sell counts: gold stops being
ours the moment it leaves the vault, because that is when we can no longer sell it to anyone else.
`SHIPPED` was deliberately **not** reused for this. Its label means *handed over*, and a real
hand-over state will follow `PACKED` later; when it does it must move no stock, because the gold
already left.

`PACKED` is a **dead end for now**. The hand-over and payment states are not built, and neither is
a return path — so a mistaken pack is corrected through `POST /inventory/gain` with
`referenceType: RETAIL_SELL` until they are. It is not marked `terminal` in the shared status list,
because it will not stay one.

---

## Tables

`retail_sell_transactions` and `retail_sell_statuses` are field-identical to their retail-buy
counterparts — see [retail-buy.md](../retail-buy/retail-buy.md) for the column table, the note on
why the six POS-sync columns were dropped in migration 0017, and the reasoning behind `operationFee`
sitting outside `totalAmount`.

The one difference is the status enum: `PACKED` where buy has `STOCKED`, plus the unreachable
`SHIPPED`.

On this side `pricePerGb` is what the customer was **charged** and `operationFee` is typically
ค่าบล็อค on ทองแผ่น — the margin-capture half of the business. Keeping it out of `totalAmount` is
what stops a ทองแผ่น sale reading as a better price per gold baht than it achieved.

---

## Status Flow

```
CONFIRMED ─┬─> PACKED       decrement fires here · the end of the line for now
           └─> CANCELLED    note required · nothing to unwind

(SHIPPED exists in the enum, reachable from nothing)
```

`createTransaction` lands directly on `CONFIRMED` and writes one status row. `DRAFT` and `SHIPPED`
both survive as enum values and are unreachable — the first for a future POS feed, the second for
the hand-over state that will follow `PACKED`.

| Transition | Guard | Inventory effect |
| --- | --- | --- |
| `CONFIRMED → PACKED` | optional `brandSplit` | `decrementSplit` of the transaction weight, costed at each pool's live WAC |
| `CONFIRMED → CANCELLED` | note required | none |

**Voiding is possible until the gold leaves the vault, and not after** — the wholesale-sell rule.
From `PACKED` there is no exit yet.

---

## Inventory

| When | Effect |
| --- | --- |
| Entering `PACKED` | `decrementSplit()` — one movement **per branded pool**, all in one DB transaction, `referenceType: 'RETAIL_SELL'`, `referenceId` = transaction id |
| Every other move | nothing |

- **What leaves is the transaction's weight; what it cost is the pool's business.** Each pool is
  costed at its own live WAC inside the locked transaction. `totalAmount` is the sale price —
  revenue — and is never sent; the margin between the two is the period's result and is not booked
  per transaction (SCOPE-002).
- **Brand is entered here, as a split — a mix of ฮั่วเซ่งเฮง and อื่นๆ, exactly as on the buy side.**
  Which stamps go over the counter is decided at the vault door out of what is on the shelf. The
  caller names the branded portions and `NA` absorbs the residual by subtraction, so the split
  decides *which* pools are drawn down and never *how much* leaves. The enterable brands are every
  active brand except `NA` (`resolveRetailBrandSplit()`), since there is no supplier to register
  them against. See [retail-buy.md](../retail-buy/retail-buy.md#inventory).
- **One short pool fails the whole move**: `InsufficientStockError` → 422, nothing decremented
  anywhere, the sale still `CONFIRMED`. The decrement runs before the status row for that reason.
- **99.9% takes no split**, and the origin is always `foreign` — only `convert_out` may draw on
  the domestic pool.
- **`getTransaction` returns `brandSplit`**, read back off the ledger. Empty before `PACKED`.

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
| `advanceStatus` | `POST /retail-sell/:id/status` | `{ toStatus, note?, brandSplit? }` — appends a status row; returns the status reached |
| `getTransaction` | `GET /retail-sell/:id` | transaction + full status history + recorded `brandSplit` |
| `listTransactions` | `GET /retail-sell` | filters: `currentStatus`, `settlementPeriod`, `branchCode`, `from`/`to` |

Behind `authMiddleware`, no `requireRole`, actor from the JWT. Same list window and sort as
retail-buy.

---

## Cross-domain Inventory Coupling

`decrementSplit` on entering `PACKED`, and nothing else. `RETAIL_SELL` also stays selectable on the
manual loss form, which is how an after-the-fact correction is filed.

---

## Domain Errors

Those of retail-buy — `TransactionNotFoundError` (404), `InvalidTransitionError`,
`NoteRequiredError`, `ProductTypePurityNotFoundError` and the three brand-split errors (all 422) —
plus **`InsufficientStockError`** (422): a pool cannot cover the pack, nothing is written, and the
sale stays `CONFIRMED`.

---

## Open Issues

See [retail-buy.md](../retail-buy/retail-buy.md); they apply unchanged. Additionally:

1. **Everything after `PACKED`.** Hand-over (`SHIPPED`), payment, and a return path that puts the
   gold back (`reverseDecrement()` under a `RETAIL_SELL_RETURN` ledger type, as wholesale-sell's
   `RETURNED` does) are all unbuilt. Until the last of those exists, a mistaken pack needs an ADMIN
   stock gain to correct.
2. **Customer deposits.** Gold left with the shop for safekeeping without an operating fee is
   **custody, not a trade** — title does not transfer. It needs its own domain and must never be
   recorded here.
