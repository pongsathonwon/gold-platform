# Retail Buy Domain

## Core Concept

A retail buy is the shop **buying gold from a customer** at the counter — written up after the fact,
not captured live. It exists to answer one question: **was the price we dealt at a good one?**

That framing is what makes this domain thin. It records the trade — what was paid, for how much
metal, on which day — and nothing else. It is not a counter system, and it is deliberately not the
system of record for anything but the figures a buy-versus-sell price comparison needs.

POS integration is deferred: the sell-gold-bar document it depends on is unfinished. Manual entry is
how retail figures reach the system in the meantime, and `source` distinguishes the two once a feed
does arrive.

**No inventory coupling.** Stock is adjusted by hand through `POST /inventory/gain|loss`. The shop
cannot trace which physical gold came from which customer, so tying a pool to a counter trade would
assert a link that does not exist.

---

## Tables

### `retail_buy_transactions`

One record per counter trade. Created once, never deleted. Only `currentStatus` is mutated.

| Field | Description |
| --- | --- |
| `id` | UUID primary key |
| `branchCode` | FK → `branches.branchCode` — the only party to the trade the system can name |
| `purityId` / `productTypeId` | resolved master data; the pairing is validated at creation |
| `brandId` | **nullable and unread** — brand keys an inventory pool, and this domain touches none |
| `weightGb` / `weightGm` | the weight as measured, both units resolved server-side |
| `conversionFactor` | GB-to-GM ratio, snapshotted at creation |
| `pricePerGb` | what the customer was paid, per gold baht — one price at both purities |
| `totalAmount` | `weightGb × pricePerGb` — **gold value only** |
| `operationFee` | nullable, THB. Deliberately **outside** `totalAmount`; see below |
| `transactionDate` | the business day the trade happened — picked, defaults to today, never future |
| `settlementPeriod` | Fri–Thu week label, **derived** from `transactionDate`, never caller-supplied |
| `currentStatus` | write-through cache — `CONFIRMED \| CANCELLED` in practice |
| `source` | `MANUAL` today; a POS feed registers its own value |
| `notes` | free text |
| `recordedBy` | taken from the JWT, never the request body |
| `recordedAt` | server clock |

**Dropped in migration 0017** (the tables were empty): `buyNumb`, `custCode`, `emplCode`,
`brandText`, `sizeText`, `goldPriceSnapshot`. All six existed only so a sync service could fill
them. A column whose only filler does not exist reads as data someone forgot to populate.

### `retail_buy_statuses`

Append-only status log. Never updated or deleted. `note` is required on `CANCELLED`.

---

## The fee sits beside the total, never inside it

`totalAmount` is gold value alone, and `operationFee` rides alongside. Three reasons, in order of
how much they matter:

1. **Comparability.** The wholesale domains carry no fees at all. If a retail total silently
   included labour, the cross-domain comparison this whole feature exists for would be apples to
   oranges.
2. **The average would lie.** Every report divides value by volume in gold baht. Folding a fee in
   would make a ทองแผ่น trade look like it fetched a better price per gold baht than it did.
3. **It is unrecoverable if blended.** Record three months of combined prices and the two cannot be
   separated afterwards. The column exists before anything reads it for exactly this reason.

Anything needing all-in cash — the period net, eventually — adds the two. The detail page does this
on screen as `รวมทั้งสิ้น`, which is the pattern: sum at the point of consumption.

---

## Status Flow

```
CONFIRMED ──> CANCELLED
```

`createTransaction` lands directly on `CONFIRMED` and writes **one** status row. There was never a
draft — the trade happened before anyone opened the form — and logging one would put an event in the
audit trail that nobody performed.

`DRAFT` survives in the enum and is unreachable. It is kept for a POS feed, which does have a
pending state, and removing a pgEnum value is a painful migration where leaving one costs nothing.

| Transition | Guard | Inventory effect |
| --- | --- | --- |
| `CONFIRMED → CANCELLED` | note required | none |

**Voiding requires a reason** (`NoteRequiredError` → 422). The row already counted toward a week's
figures, and "why is this week's average different" is not answerable from a status alone.

**There is no edit path.** A confirmed write-up is voided and re-entered rather than corrected,
which keeps the change in the status log instead of overwriting a figure that has been reported on.

---

## Weights are measured, not ordered

`createTransaction` calls **`resolveMeasuredQuantity`**, not `resolveQuantity`.

The `product_type_purities` rules — 96.5% gold bar in multiples of 5 GB, minimums, closed value
lists — describe what can be *ordered from a supplier*. A customer's gold weighs what it weighs, and
applying those rules here would refuse a real trade that already happened. A 3.7 GB necklace is
valid input.

The pairing is still looked up, so an impossible product/purity combination is refused
(`ProductTypePurityNotFoundError` → 422) and the weight is read in that pairing's unit (kg or gold
baht).

---

## Scope

**ทองแท่ง (`BAR`) and ทองแผ่น (`PLATE`) only** — the same two product types and three pairings
wholesale uses. Anything else lives in another system. `operationFee` therefore carries ค่าบล็อค on
ทองแผ่น rather than ค่าแรง/ค่ากำเน็จ.

---

## Endpoints

| Usecase | HTTP | Description |
| --- | --- | --- |
| `createTransaction` | `POST /retail-buy` | creates the transaction + its `CONFIRMED` status row |
| `advanceStatus` | `POST /retail-buy/:id/status` | appends a status row; returns the status reached |
| `getTransaction` | `GET /retail-buy/:id` | transaction + full status history |
| `listTransactions` | `GET /retail-buy` | filters: `currentStatus`, `settlementPeriod`, `branchCode`, `from`/`to` |

All routes sit behind `authMiddleware`; no `requireRole`. Recording the day's counter trades is
ordinary operator work — the ADMIN gate exists for the inventory adjustments, which move gold with
nobody on the other side of the transaction.

`from`/`to` window over `transactionDate`, both ends inclusive, and the list sorts
`(transactionDate DESC, recordedAt DESC)` so a backdated write-up reads where it belongs rather than
jumping to the top.

---

## Cross-domain Inventory Coupling

None, on either retail domain. See the note at the top.

---

## Domain Errors

| Error | When |
| --- | --- |
| `TransactionNotFoundError` | id does not exist → 404 |
| `InvalidTransitionError` | `toStatus` is not a legal next state → 422 |
| `NoteRequiredError` | voiding without a reason → 422 |
| `ProductTypePurityNotFoundError` | the product/purity pairing does not exist → 422 |

---

## Open Issues

1. **No customer entity.** A walk-in is not modelled, and `custCode` was dropped rather than left
   unfilled. Customer gold deposits — custody, where title does not transfer — will need their own
   domain and must **not** be recorded as a retail buy.
2. **No employee entity.** `recordedBy` is the login that typed it, which is not necessarily the
   cashier who dealt.
3. **No POS sync.** `source` is the seam. A feed will also want a document-number column to group
   multi-line receipts; one row is one line today.
4. **No market-price benchmark.** `goldPriceSnapshot` was dropped: there is no `gold_market_price`
   table to source it from, and the spread between our own buy and sell price is the first-order
   answer anyway.
