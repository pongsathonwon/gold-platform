# wholesale-sell — Domain Spec

Company sells gold **to a supplier**. Counts in Net Company Orders for the period.

The mirror of `wholesale-buy`, and deliberately so: same two-table status log, same bulk-confirm
lock, same one-entered-price rule, same "goods handling is two states behind one endpoint" shape.
What differs is the **order of the two irreversible events** — on a buy we pay first and receive
after; on a sell we hand over gold first and get paid after.

The mirroring governs *which edge of the transit window moves stock*, and nothing more. It is not
a reason for the two domains to expose the same endpoints: buy fuses `RECEIVED`/`STOCKED` behind
one call because they are one moment on the floor, while `PACKED` and `SHIPPED` stay separate here
because a packed box waits for a courier.

**One item per transaction.** There is no line-item table — a multi-item deal is recorded as
multiple transactions, so a partial handover or a single disputed bar never puts a whole deal into
an ambiguous state.

---

## 1. State Machine

```
CREATED ─┬─> CONFIRMED ──> PACKED ──> SHIPPED ─┬─> PAID
         │                  │           │      ├─> DISPUTED ─┬─> PAID
         │                  │           │      │             └─> RETURNED
         │                  │           │      ├─> PAYMENT_FAILED ─┬─> PAID
         │                  │           │      │                   └─> WRITTEN_OFF
         │                  │           └──────┴─> RETURNED
         │                  └─> RETURNED
         │
         │                (CONFIRMED also ─> CANCELLED | REJECTED)
         ├─> CANCELLED
         └─> REJECTED

decrement fires on entering PACKED · reversed on entering RETURNED
```

| Status | Meaning | Terminal |
|---|---|---|
| `CREATED` | Deal recorded. Editable for as long as it stays here. | no |
| `CONFIRMED` | Committed to the buyer. | no |
| `PACKED` | Gold pulled from the vault and boxed. **The only status that removes stock.** | no |
| `SHIPPED` | Gone — in the buyer's hands or the courier's. | no |
| `PAID` | The buyer's money arrived. | yes |
| `DISPUTED` | The buyer contests the weight after delivery. Stock already left; their figure is recorded. | no |
| `PAYMENT_FAILED` | The buyer's transfer bounced or came up short. Retryable back to `PAID`. | no |
| `CANCELLED` | We backed out, before any gold left the vault. | yes |
| `REJECTED` | The buyer declined. Tracked separately from `CANCELLED` — the counterparty killed it. | yes |
| `RETURNED` | The gold came home. **The decrement is reversed** and the stock goes back. | yes |
| `WRITTEN_OFF` | The receivable was given up on. The gold is gone and no money came for it. | yes |

Rules the server enforces on every transition:

1. **The move must be in `allowedTransitions`**, else `422 invalid transition`.
2. **Failure branches require a note** (`DISPUTED`, `PAYMENT_FAILED`, `CANCELLED`, `REJECTED`,
   `RETURNED`, `WRITTEN_OFF`), else `422 a note is required`.
3. **`RETURNED` also requires a `returnReason`** — `WEIGHT | BRAND | PURITY | DAMAGED | OTHER` —
   else `422`. Same rule and same reason set as the buy side.
4. **Cancelling is possible until gold leaves the vault, and not after.** `CREATED` and
   `CONFIRMED` both route to `CANCELLED`; from `PACKED` onward the exit is `RETURNED`, a physical
   event that reverses the decrement. This matches wholesale-buy, which relaxed the same rule for
   the same reason: forcing our own mistakes through `REJECTED` misreports them as the buyer
   walking away, and `REJECTED` is what counterparty-reliability reporting counts.
5. **Nothing that has not decremented can reach `RETURNED`.** Reversing a decrement that never
   happened would invent stock out of nothing.

---

## 2. Where Inventory Moves, and Why There

`PACKED` is the decrement, not `SHIPPED` and not delivery. Gold stops being ours the moment it
leaves the vault to be boxed — that is when we can no longer sell it to anyone else.

This is what keeps the two domains **prudent in the same direction**, which is the point of the
pairing:

| | first goods state | second goods state | stock moves on |
|---|---|---|---|
| buy | `RECEIVED` — it is here | `STOCKED` — it is put away | the **second** |
| sell | `PACKED` — it left the vault | `SHIPPED` — it left the building | the **first** |

Both count the pessimistic edge of the transit window. Gold coming toward us is not ours until
verified; gold going out stops being ours the moment it leaves the vault. **Neither domain ever
reports stock it does not physically hold.** An earlier draft decremented at delivery, which
overstated stock for the whole time a shipment was in transit — the exact error the buy side had
already been designed to avoid.

### Packing and shipping are two actions, not one

They used to run through a single `/pack-ship` call, mirroring buy's `receive-check`. That merge
was copied by symmetry rather than taken from anything BU said, and the two cases are not alike:

- **Receiving and stocking are one moment.** The person who accepts a delivery is the person who
  puts it away, with no interval between.
- **Packing and shipping are not.** The box is pulled and sealed, then waits — for a courier, a
  rider, or the buyer's own pickup. That wait is real, sometimes hours.

Splitting them buys three things. `PACKED` becomes an observable resting state, so **"what is
boxed and waiting to go out?" is answerable** — with the merge, no transaction was ever seen in
`PACKED`. Custody is distinguished: `PACKED` is out of the vault but on the premises, `SHIPPED` is
off the premises and at the counterparty's risk, and a vault count and a premises count disagree
about exactly that gold. And `PACKED → RETURNED` stops being dead — "boxed it, the deal fell
through, put it back" becomes a path something can actually take.

Both moves now go through `/status` as ordinary transitions. The decrement did not move; it still
fires on entering `PACKED`.

A `PACKING` state was considered and rejected. Its only exit would be `PACKED` — one exit and no
decision at it is a progress indicator, not a state — and it would force the decrement either
before the box is verified or after the gold has already left the vault, breaking the property
this whole section rests on.

### The reversal

Because the decrement now happens early, anything that kills the deal afterwards has to put the
gold back. `RETURNED` is that path, reachable from `PACKED`, `SHIPPED` and `DISPUTED` — every state
after the decrement in which the shipment can still physically come home.

It books a **new, opposite movement** rather than editing the original, under its own
`referenceType: 'WHOLESALE_SELL_RETURN'`. The ledger then shows the gold leaving and coming back,
which is what actually happened; a silent unwind would show neither. This is the first domain to
wire `reverseDecrement()`.

`PAYMENT_FAILED` has **no** route to `RETURNED`: by that point the buyer has kept the gold *and*
stiffed us, which is what makes it a bad debt rather than a return.

---

## 3. Packing Records No Weight

`PACKED` takes no `actualWeight` at all. We boxed our own gold from our own vault, so there is no
second, independent measurement to capture — the only figure a caller could supply is the agreed
weight they already have. The agreed weight is what leaves.

This replaces an equality check that failed `WeightMismatchError` on anything else. The check could
only ever reject a typo, and it made the same box in the dialog mean two opposite things depending
on which move was in flight. Insufficient stock is still a hard error
(`InsufficientStockError` → 422, transaction stays `CONFIRMED`, nothing decremented).

Buy dropped its own accept-time weight for the same reason, and the two domains now obey one rule:
**the only weight ever recorded besides the agreed one is a contested one.**

### The one weight that is recorded

`DISPUTED` is where a second weight legitimately exists: what the **buyer** says their scale read.
It is the only genuinely independent measurement anywhere on a sell.
It is stored on `actualWeightGb/Gm/Amount` and moves no stock — the gold left at `PACKED` and is
sitting with them. It resolves through `resolveMeasuredQuantity()`, not `resolveQuantity()`: their
scale is reporting what it read, so orderable-quantity rules must not reject it as invalid input.

Null on those columns therefore always means "nobody is arguing".

---

## 4. Pricing — One Entered Price, One Derived

Same rule as wholesale-buy. The operator enters exactly one number: the **96.5% quote** per gold
baht. The 99.9% quote is arithmetic off it and is derived server-side:

```
pricePerGb999 = pricePerGb965 × (99.9 / 96.5)
```

| Purity | `unitOfMeasure` | Price used | Amount |
|---|---|---|---|
| 96.5% | `gb` | `pricePerGb965` | `weightGb × pricePerGb965` |
| 99.9% | `g` | `pricePerGb999` | `weightGb × pricePerGb999` |

`createWholeSellSchema` does not accept `pricePerGb999` at all — two independently-entered prices
could disagree, a derived one cannot.

`totalAmount` is the **sale price** — revenue. It is not the cost basis removed from stock; that
comes from the pool's live WAC at decrement time. The margin between them is the period's business
result and is not booked per transaction (SCOPE-002).

---

## 5. Confirmation — a Scheduled Sweep, Not a Per-Deal Deadline

Identical to wholesale-buy. `POST /wholesale-sell/confirm-all` moves *every* transaction still in
`CREATED` to `CONFIRMED`; the run itself is the cutoff.

| Caller | Actor in the log | Note |
|---|---|---|
| the nightly scheduled job | `BOT-CONFIRM` | `ยืนยันอัตโนมัติรอบกลางคืน` |
| an operator hitting the button mid-day (`?manual=true`) | their username | `ยืนยันทั้งหมด (manual)` |

Idempotent — once a transaction leaves `CREATED` it stops matching.

**Editability follows from this**: `PATCH /wholesale-sell/:id` is accepted while `CREATED` and
refused (`422 no longer editable`) once it is not. Confirmation *is* the lock.

`confirmDueAt` records when the next nightly run lands (`WHOLESALE_SELL_AUTO_CONFIRM_HOUR`, default
midnight). It is **informational**: nothing in the API tests against it.

---

## 6. Inventory Hook

| When | Effect |
|---|---|
| Entering `PACKED` | `decrementSplit()` of the agreed weight — one movement **per branded pool**, all in one DB transaction, `referenceType: 'WHOLESALE_SELL'`, `referenceId` = transaction id |
| Entering `RETURNED` | `reverseDecrement()` — restores the balance, books opposite movements under `WHOLESALE_SELL_RETURN` |
| Every other status, including `DISPUTED` | nothing |

Both run **before** the status row is written, so a movement that fails leaves the transaction
where it was rather than recording a move that never physically happened.

**Always `origin: 'foreign'`, at every purity.** The domestic pool is smelted stock and only
`convert_out` may consume it. Hardcoded in the usecase, never caller-supplied.

### Brand is recorded at the vault door

There is **no `brand_id` column** on `whole_sell_transactions`, mirroring the buy side for the
mirror-image reason: which stamps go in the box is decided when the vault is opened, out of
whatever is actually on the shelf, not months earlier when the deal was struck. The split is
supplied on the move into `PACKED` and becomes one `decrement` per pool — `brandLock`
counterparties take their single brand, everyone else names weights with the fungible `NA` pool
absorbing the residual, and 99.9% never splits at all. The full rule lives in
`infrastructure/brand-split.ts` and is shared verbatim with wholesale-buy.

**A split cannot change how much leaves the vault**, only which pools it comes out of: the caller
names branded portions and the residual is taken by subtraction, so the lines always reconstruct
the agreed weight.

**All the pools move in one DB transaction.** One pool short of stock fails the whole move with
nothing decremented anywhere and the transaction still `CONFIRMED` — a half-packed shipment is
worse than an unpacked one.

`RETURNED` needs no split of its own: `reverseDecrement()` replays every movement booked under the
reference back into the pool it came from, which is precisely why the ledger rather than a column
is where the split belongs.

**Corrections after `PAID`** do not reopen the transaction. Post a manual adjustment through
`POST /inventory/gain` (or `/loss`) with `referenceType: WHOLESALE_SELL` and a note pointing at the
transaction.

---

## 7. Endpoints

All require a JWT. `recordedBy` / `updatedBy` come from the token, never the body.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/wholesale-sell` | create; one price in, `settlementPeriod` derived server-side |
| `GET` | `/wholesale-sell` | filters: `currentStatus`, `settlementPeriod`, `supplierId`. Newest first |
| `GET` | `/wholesale-sell/:id` | `{ transaction, statuses }`, status log oldest→newest |
| `PATCH` | `/wholesale-sell/:id` | edit; `CREATED` only |
| `POST` | `/wholesale-sell/:id/status` | `{ toStatus, note?, actualWeight?, settledAmount?, returnReason? }` |
| `POST` | `/wholesale-sell/confirm-all` | bulk confirm. `?manual=true` attributes it to the operator |

---

## 8. Two dates, and the settlement period

Exactly as on the buy side: **`transactionDate`** is the day the deal was struck, picked by the
operator and defaulting to today; **`recordedAt`** is when the row was written, from the server
clock. `settlementPeriod` is derived from `transactionDate` by `resolveSettlementPeriodOn()` using
the Fri 00:00 → Thu 23:59 boundary, and frozen. Callers never supply the period. Correcting the
date re-derives it, and is accepted only while the transaction is still `CREATED`.

---

## 9. Tables

`whole_sell_transactions` — one row per item. `price_per_gb` is the 96.5% quote,
`price_per_gb_999` the derived one. `actual_weight_gb` / `actual_weight_gm` / `actual_amount` hold
**the buyer's contested weight** only, set on a `DISPUTED` move. Null means nobody is arguing.

`settled_amount` — what the buyer actually paid, when it differed from `total_amount`. Null means
it matched. `return_reason` — `WEIGHT | BRAND | PURITY | DAMAGED | OTHER`, set on a move into
`RETURNED`.

`whole_sell_statuses` — append-only log, never updated or deleted. `current_status` is a
write-through cache of the latest entry and is recomputable from this table.

Migration `0007_wholesale_sell_domain.sql` remaps the legacy statuses: `DRAFT → CREATED`,
`SETTLED → PAID`. `SHIPPED` and `CANCELLED` keep their names — and `SHIPPED` keeps its inventory
meaning, since the old model decremented on entering it and the new one has already decremented (at
`PACKED`) by the time a row reaches it. Legacy rows simply have no `PACKED` entry in their log.

---

## 10. Domain Errors

| Error | HTTP | When |
|---|---|---|
| `TransactionNotFoundError` | 404 | id does not exist |
| `InvalidTransitionError` | 422 | `toStatus` is not a legal next state |
| `NoteRequiredError` | 422 | failure-branch transition with no note |
| `NotEditableError` | 422 | edit attempted on a transaction that is no longer `CREATED` |
| `ReturnReasonRequiredError` | 422 | move into `RETURNED` with no `returnReason` |
| `ProductTypePurityNotFoundError` | 422 | purity is not configured for that product type |
| `InvalidQuantityError` | 422 | agreed weight breaks the pairing's quantity rule |
| `InsufficientStockError` | 422 | the pool cannot cover the pack; nothing is written |

---

## 11. Open Issues

1. **No user FK** — `recordedBy` / `createdBy` are plain `varchar`, blocked on the employee/user
   identity decision shared with every other domain.
2. **No settlement summary endpoint yet** — Phase 4 position work.
3. **No partial handover.** One transaction is one shipment.
4. **`WRITTEN_OFF` and `settled_amount` have no accounting hook.** Both record a fact for
   reporting; whether a bad-debt entry or a settlement variance should also post somewhere is a
   Phase 4 question, shared with `wholesale-buy`.
5. **`RETURNED` restores stock at the original cost**, because `reverseDecrement()` replays the
   recorded movement. If the pool's WAC moved while the gold was out, the restored cost is the old
   one — correct for the gold that came back, but it does shift the pool average.
