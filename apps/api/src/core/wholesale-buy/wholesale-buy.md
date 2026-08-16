# wholesale-buy — Domain Spec

Company buys gold **from a supplier**. Counts in Net Company Orders for the period.

**One item per transaction.** There is no line-item table — a multi-item order is recorded as
multiple transactions. This is deliberate: it keeps the status machine per-item, so a partial
delivery or a single disputed bar never puts a whole order into an ambiguous state.

---

## 1. State Machine

```
CREATED ─┬─> CONFIRMED ─┬─> PAID ─┬─> RECEIVED ─┬─> STOCKED     (inventory increments here)
         │              │         │             └─> DISPUTED ─┬─> STOCKED
         │              │         │                           └─> RETURNED
         │              │         ├─> RETURNED ─┬─> REFUNDED
         │              │         │             ├─> RECEIVED      (re-delivery)
         │              │         │             └─> WRITTEN_OFF
         │              │         └─> DELIVERY_FAILED ─┬─> RECEIVED
         │              │                              └─> WRITTEN_OFF
         │              ├─> PAYMENT_FAILED ─┬─> PAID
         │              │                   ├─> CANCELLED
         │              │                   └─> REJECTED
         │              ├─> CANCELLED
         │              └─> REJECTED
         ├─> CANCELLED
         └─> REJECTED
```

| Status | Meaning | Terminal |
|---|---|---|
| `CREATED` | Order recorded. Legacy system status **1**. Editable for as long as it stays here. | no |
| `CONFIRMED` | Committed to the supplier. Legacy system status **2**. | no |
| `PAID` | Payment sent and accepted. | no |
| `RECEIVED` | Goods arrived, matched their document, and were taken in. | no |
| `STOCKED` | Put away. **The only status that moves inventory.** | yes |
| `PAYMENT_FAILED` | Transfer bounced or the amount was wrong. Retryable back to `PAID`. | no |
| `DELIVERY_FAILED` | We paid and the goods never turned up. They still might; if not, it is written off. | no |
| `DISPUTED` | Taken in, then contested; held pending resolution. | no |
| `CANCELLED` | We backed out, before anything moved. | yes |
| `REJECTED` | The supplier declined. Tracked separately from `CANCELLED` — the counterparty killed it, which is what supplier-reliability reporting needs. | yes |
| `RETURNED` | Shipment went back — refused at the door, or sent back after a dispute. **Our money is still with the supplier**, so it is not terminal. | no |
| `REFUNDED` | The supplier gave the money back. The clean close of a return. | yes |
| `WRITTEN_OFF` | Our money left, nothing came back, and we gave up chasing it. | yes |

Rules the server enforces on every transition:

1. **The move must be in `allowedTransitions`**, else `422 invalid transition`.
2. **Failure branches require a note** (`PAYMENT_FAILED`, `DELIVERY_FAILED`, `DISPUTED`,
   `CANCELLED`, `REJECTED`, `RETURNED`, `REFUNDED`, `WRITTEN_OFF`), else `422 a note is required`.
   The status log is the audit trail and "why" is the only thing it cannot reconstruct.
3. **`RETURNED` also requires a `returnReason`** — `WEIGHT | BRAND | PURITY | DAMAGED | OTHER` —
   else `422`. The note says what happened in prose; the reason is what makes it countable.
   Supplier reliability is the whole justification for keeping `REJECTED` separate from
   `CANCELLED`, and "HUA sent the wrong purity four times this quarter" is only answerable if the
   cause is a column.
4. **Cancellation is impossible once paid.** `PAID`, `RECEIVED`, `DISPUTED`, `RETURNED` and
   `DELIVERY_FAILED` have no route to `CANCELLED` — money has moved, so the exit is `REFUNDED`
   (we got it back) or `WRITTEN_OFF` (we did not).
5. **Cancellation *is* possible while `CONFIRMED`.** This reverses an earlier rule that forced
   every exit from `CONFIRMED` through `REJECTED`. BU needs a way out of a confirmed order for a
   human error, and routing that through `REJECTED` poisons the one metric it exists to feed —
   `REJECTED` means the supplier killed the order. Nothing has moved at `CONFIRMED`, so there is
   nothing to unwind. `wholesale-sell` was aligned onto this.

### `RETURNED` is not a dead end

`RETURNED` used to be terminal, which was survivable only while it was an edge case. It is now
the main failure path — a delivery that does not match its document is refused at the door
(`PAID → RETURNED`) rather than taken in — and a terminal `RETURNED` after `PAID` closes the
transaction with the supplier holding our cash and nothing in the record saying so.

Its three exits are the three ways that can end: `REFUNDED` (money back), `RECEIVED` (they
re-delivered the correct item, and the order resumes normally), `WRITTEN_OFF` (they never made us
whole). Only `REFUNDED` and `WRITTEN_OFF` are terminal.

### `DELIVERY_FAILED` — the mirror of the sell side's `PAYMENT_FAILED`

`PAID → RECEIVED` used to be the only exit from `PAID`, so a supplier who took our money and never
shipped stranded the order there forever, with no terminal and no way to report the loss.

`DELIVERY_FAILED` closes that. It is the exact counterpart of `wholesale-sell`'s
`SHIPPED → PAYMENT_FAILED → WRITTEN_OFF`: in both domains it covers *the counterparty took the
valuable thing and never handed over its other half*. Neither has a route to `CANCELLED`, because
ours already moved.

It exists — where a wrong packed weight on the sell side does not — because it passes the test a
failure has to pass to earn a status: it is **durable** (it can drag on for weeks while someone
chases the supplier) and it **changes what happens next** (chase, then write off). A failure the
operator corrects on the spot is a `422`, not a state.

The transition map lives in `@gold-platform/types` (`WHOLE_BUY_TRANSITIONS`) so the web app offers
exactly the moves the API accepts. The port assigns it to a `Record<WholeBuyStatus, …>`, so if the
DB enum and the shared list ever diverge, the API stops compiling.

---

## 2. Confirmation — a Scheduled Sweep, Not a Per-Order Deadline

`CONFIRMED` is a real status, not a derived query condition — the legacy system's status 2 maps
onto it, and the log records who confirmed and when.

Confirmation happens in **bulk**: `POST /wholesale-buy/confirm-all` moves *every* transaction still
in `CREATED` to `CONFIRMED`. There is no per-transaction deadline the API enforces — the run itself
is the cutoff.

| Caller | Actor in the log | Note |
|---|---|---|
| the nightly scheduled job | `BOT-CONFIRM` | `ยืนยันอัตโนมัติรอบกลางคืน` |
| an operator hitting the button mid-day (`?manual=true`) | their username | `ยืนยันทั้งหมด (manual)` |

Idempotent — once a transaction leaves `CREATED` it stops matching, so the job can run as often as
you like. A per-transaction manual confirm through `/status` still works too.

**Editability follows from this**: `PATCH /wholesale-buy/:id` is accepted while the transaction is
`CREATED` and refused (`422 no longer editable`) once it is not. Confirmation *is* the lock,
whichever route produced it.

`confirmDueAt` records when the next nightly run lands (`WHOLESALE_BUY_AUTO_CONFIRM_HOUR`, default
midnight — set it to match the real cron). It is **informational**: nothing in the API tests
against it. It exists so the UI can tell an operator how long their order stays editable.

---

## 3. Pricing — One Entered Price, One Derived

Gold is quoted per **gold baht (บาททอง)**. The operator enters exactly one number: the **96.5%
quote**. The 99.9% quote is arithmetic off it and is derived server-side:

```
pricePerGb999 = pricePerGb965 × (99.9 / 96.5)
```

Both are stored on every transaction whatever the item's purity, and the item's own purity selects
which one drives the amount:

| Purity | `unitOfMeasure` | Price used | Amount |
|---|---|---|---|
| 96.5% | `gb` | `pricePerGb965` | `weightGb × pricePerGb965` |
| 99.9% | `g` | `pricePerGb999` | `weightGb × pricePerGb999` |

`createWholeBuySchema` does not accept `pricePerGb999` at all — two independently-entered prices
could disagree, a derived one cannot. `derivePricePerGb999()` in `@gold-platform/types` is the
single implementation, used by the server to store it and by the web form to preview it.

---

## 4. Accept As Documented — the Check Happens at the Door

**Acceptance takes no weight.** Moving to `STOCKED`, whether through `/status` or `/receive-stock`,
carries no figure at all: acceptance *means* the delivery matched its document, so the ordered
weight is what enters inventory.

This replaces an all-or-nothing equality test, and the reason is that the test could not do any
work. The only value `actualWeight` could legally hold on the accept path was the number already
on the order — a field that permits exactly one value carries no information, and mistyping it
diverted a perfectly good delivery into `DISPUTED`.

The check that matters is physical and happens **before custody transfers**: the receiver compares
weight and purity against the document with the courier still there. Three outcomes:

| At the door | Move | Effect |
|---|---|---|
| everything matches | `PAID → RECEIVED → STOCKED` | ordered weight enters inventory |
| anything disagrees | `PAID → RETURNED` + `returnReason` | nothing enters inventory, nothing is signed for |
| found wrong later, after signing | `RECEIVED → DISPUTED` + `actualWeight` | nothing enters inventory; the contested figure is recorded |

**Acceptance does take the brand split**, and this is the only thing on a buy that brand is
recorded on. See §5.1 — brand is no longer something a delivery can fail, because the order never
claimed one.

**Purity is not a discrepancy — it is the wrong product.** Purity drives `unitOfMeasure`, the
derived price and the target inventory pool, and the transaction locked at `CONFIRMED` with its
price already derived from the purity ordered. There is no amend path: refuse, terminate, and
create a new transaction. `returnReason: 'BRAND'` survives for the case where the stamp is not one
this supplier is registered to ship at all.

`RECEIVED` has **no direct route to `RETURNED`**. Once custody has transferred, sending gold back
goes through `DISPUTED`, because that is where the reason and the contested weight get recorded.

### The one weight that is recorded

`DISPUTED` is the only move that stores a second weight, and the only path where typing one is
worth anything — a dispute is meaningless without the number being disputed. On acceptance the
recorded figure is **cleared back to null**: acceptance implies the delivery matched, so a
`STOCKED` transaction must never display a weight different from its order. The `DISPUTED` entry in
the status log is where that history lives.

It resolves through `resolveMeasuredQuantity()`, not `resolveQuantity()` — a shipment coming to
11.95 GB against a 12 GB order is a real short delivery, not invalid input, so the
orderable-quantity rules (`minQuantity`, `allowedValues`) must not apply to it.

> **Open for accounting:** if audit requires a weight recorded at every receipt, this is the wrong
> design — you would need the weight always captured, always stored, with a tolerance band, and
> within-tolerance deliveries accepted at the *measured* figure. That contradicts BU's
> all-or-nothing rule and needs a tolerance policy nobody has set.

## 4b. Settled Amount

On a move into `PAID`, the caller may supply `settledAmount` — what was actually paid, when it
differs from `totalAmount`. Null always means the payment matched.

It is a **field, not a status**, and nothing branches on it: an accepted variance closes the deal
exactly like an exact payment does, so by the rule below it does not earn a state. It exists
because accounting needs the number and today it is unrecoverable from anywhere. Supplying it
again on a retry after `PAYMENT_FAILED` overwrites it; omitting it clears it.

---

## 5. Inventory Hook

| When | Effect |
|---|---|
| Entering `STOCKED` (from `RECEIVED` or `DISPUTED`) | `incrementSplit()` of the **ordered** weight — one balance upsert + one movement row **per branded pool**, all in one DB transaction, `referenceType: 'WHOLESALE_BUY'`, `referenceId` = transaction id |
| Every other status, including `DISPUTED` | nothing |

**Always `origin: 'foreign'`, at every purity.** Only smelting produces domestic stock, and only
`convert_out` may consume it — a wholesale purchase is an import by definition, so 99.9% orders
land in the foreign pool exactly like 96.5% ones. The constant is hardcoded in the usecase and is
not caller-supplied.

### 5.1 Brand is recorded here, and nowhere else

There is **no `brand_id` column** on `whole_buy_transactions`. An order cannot state what stamp
will arrive — that is an observation made when the metal is on the counter, and from a supplier
that is not `brandLock` it is routinely a mix. So brand is supplied on the move into `STOCKED`
(via `/status` or `/receive-stock`) as a `brandSplit`, and lands as one movement per pool.

| Supplier | What the operator enters |
|---|---|
| `brandLock = true` (ฮั่วเซ่งเฮง) | nothing — its single registered brand takes 100%, and sending a split is a 422 |
| `brandLock = false` | a weight per brand in `suppler_brands`; the fungible `NA` pool takes the residual |
| 99.9%, any supplier | nothing — those pools are keyed by origin, so brand is not a dimension of them and a split is a 422 |

**The split can never change how much enters stock.** Callers name only the branded portions and
the residual is `weightGb − Σ named`, taken by subtraction. There is no total field to disagree
with and no residual field to mistype, so an unequal increment is not representable — the one
failure mode left is naming *more* than the order, which is refused outright rather than clamped.
Cost is apportioned by weight with the last line absorbing the rounding, so the pools reconcile to
`totalAmount` exactly.

Which brands a supplier may ship is `suppler_brands` data, not code: registering a second stamp is
a row, not a change here. BU tracks only ฮั่วเซ่งเฮง and `NA` today because identifying every stamp
on the floor is not work they can do.

`GET /wholesale-buy/:id` returns the recorded split by reading the movements back under the
transaction's reference. **There is no allocation table** — the movements the balances were built
from *are* the split, so the two cannot drift.

**Corrections after `STOCKED`** do not reopen the transaction. It is terminal by design. Post a
manual adjustment through `POST /inventory/loss` (or `/gain`) with `referenceType: WHOLESALE_BUY`
and a note pointing at the transaction — the correction then shows up in the movement ledger
alongside the original, which a silent edit never would.

---

## 6. Endpoints

All require a JWT. `recordedBy` / `updatedBy` come from the token, never the body.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/wholesale-buy` | create; one price in, `settlementPeriod` derived server-side |
| `GET` | `/wholesale-buy` | filters: `currentStatus`, `settlementPeriod`, `supplierId`. Newest first |
| `GET` | `/wholesale-buy/:id` | `{ transaction, statuses }`, status log oldest→newest |
| `PATCH` | `/wholesale-buy/:id` | edit; `CREATED` only |
| `POST` | `/wholesale-buy/:id/status` | `{ toStatus, note?, actualWeight?, settledAmount?, returnReason? }` → `{ status }` |
| `POST` | `/wholesale-buy/:id/receive-stock` | `{ note? }` — `PAID → RECEIVED → STOCKED` in one call |
| `POST` | `/wholesale-buy/confirm-all` | bulk confirm. `?manual=true` attributes it to the operator; without it, `BOT-CONFIRM` |

Each optional field on `/status` is read on exactly one move: `actualWeight` on `DISPUTED`,
`settledAmount` on `PAID`, `returnReason` on `RETURNED`. Nothing diverts any more — the caller asks
for a status and gets it, or gets a `422`.

### Why `receive-stock` exists

Receiving and stocking are one operator action, and BU wants them to stay one: the person who
accepts a delivery is the person who puts it away, and they would staff that role rather than split
it. The endpoint still writes **both** status entries, so when the two steps do get separated
later, nothing already recorded needs migrating.

This is deliberately *not* mirrored on the sell side. The symmetry between the domains governs
which edge of the transit window moves stock, not how many endpoints each exposes — and a packed
box waits for a courier where an accepted delivery does not wait to be put away.

---

## 7. Two dates, and the settlement period

A transaction carries **`transactionDate`** — the day the order was placed, as the operator states
it — and **`recordedAt`**, the instant the row was written. On day one these routinely differ,
because the shop is documenting orders that already happened; under a proper workflow they agree
and nothing draws attention to them. `transactionDate` is optional on the wire and defaults to
today (Bangkok); `recordedAt` is the server clock and is never accepted from a caller.

`settlementPeriod` is derived from **`transactionDate`** by `resolveSettlementPeriodOn()`
(`infrastructure/settlement.ts`) using the Fri 00:00 → Thu 23:59 boundary, and frozen. Callers
never supply it. Deriving it from `recordedAt` would make backdating decorative — an order
backdated to last Thursday has to land in last week's period.

Correcting the date via `PATCH` re-derives the period with it; both are refused once the
transaction leaves `CREATED`, which is the same lock that governs every other editable field.
`confirmDueAt` is unaffected — the edit window closes at the next real nightly sweep, however old
the order being typed in is.

---

## 8. Tables

`whole_buy_transactions` — one row per item. `price_per_gb` is the 96.5% quote (the column keeps
its original name; the `pricePerGb965` field name just makes the meaning explicit),
`price_per_gb_999` the derived 99.9% one. `actual_weight_gb` / `actual_weight_gm` / `actual_amount`
hold an **outstanding discrepancy** only: written on a move into `DISPUTED`, cleared again if the
shipment is later accepted. Null therefore always means "nobody is arguing".

`settled_amount` — what was actually paid, when it differed from `total_amount`. Null means it
matched. `return_reason` — `WEIGHT | BRAND | PURITY | DAMAGED | OTHER`, set on a move into
`RETURNED`.

`whole_buy_statuses` — append-only log, never updated or deleted. `current_status` on the
transaction is a write-through cache of the latest entry and is recomputable from this table.

---

## 9. Domain Errors

| Error | HTTP | When |
|---|---|---|
| `TransactionNotFoundError` | 404 | id does not exist |
| `InvalidTransitionError` | 422 | `toStatus` is not a legal next state |
| `NoteRequiredError` | 422 | failure-branch transition with no note |
| `ReturnReasonRequiredError` | 422 | move into `RETURNED` with no `returnReason` |
| `NotEditableError` | 422 | edit attempted on a transaction that is no longer `CREATED` |
| `ProductTypePurityNotFoundError` | 422 | purity is not configured for that product type |
| `InvalidQuantityError` | 422 | ordered weight breaks the pairing's quantity rule |

---

## 10. Open Issues

1. **No user FK** — `recordedBy` / `createdBy` are plain `varchar`, blocked on the employee/user
   identity decision shared with every other domain.
2. **No settlement summary endpoint yet** — `GET /wholesale-buy/settlement/:period/summary` is
   part of the Phase 4 position work, not built here.
3. **No partial receiving.** One transaction is one receipt. A split delivery is recorded as
   separate transactions, not as multiple receipts against one.
4. **`settled_amount` has no accounting hook.** It records the variance for reporting; whether an
   accepted under- or over-payment should also post somewhere is a Phase 4 question, shared with
   `wholesale-sell`.
5. **Does audit require a weight at receipt?** See §4. If yes, accept-as-documented has to be
   replaced by an always-captured weight with a tolerance band. Blocked on the accounting team.
6. **`DISPUTED` may not survive.** It only has a job if verification can happen *after* the
   courier leaves. If BU confirms the rider always waits, refuse-at-the-door covers every case and
   `RECEIVED → DISPUTED` can go.
7. **A re-delivery cannot be refused at the door. Enhancement, not a defect — deliberately not
   built.**

   The door check is asymmetric between a first delivery and a re-delivery:

   ```
   PAID     ─┬─> RECEIVED    correct at the door
            └─> RETURNED     wrong — refused, no custody taken

   RETURNED ──> RECEIVED     re-delivery — custody is taken whatever turns up
   ```

   A second refusal is still *reachable*, via `RETURNED → RECEIVED → DISPUTED → RETURNED`, but
   only by taking the goods in first — which is what refuse-at-the-door exists to avoid, and it
   records the attempt as though we had accepted it.

   The fix is one entry in `WHOLE_BUY_TRANSITIONS`: allow `RETURNED → RETURNED`, so a supplier
   delivery attempt has the same two outcomes from `RETURNED` as it does from `PAID`. Nothing else
   needs changing — `assertTransitionAllowed` does a plain `includes`, so a self-transition passes
   without special-casing, and on the buy side `RETURNED` fires no inventory effect (the increment
   never happened), so repeating it is side-effect-free beyond a new log row and an overwritten
   `returnReason`. Column holds the latest, log holds every attempt — the same split as
   `actualWeight` and `settledAmount`.

   **This must never be mirrored on `wholesale-sell`,** where `RETURNED` calls
   `reverseDecrement()`: a self-loop there would reverse the same decrement twice and invent stock
   out of nothing. On buy `RETURNED` is bookkeeping; on sell it is a stock movement.

   Why it is worth doing eventually: repeat failures are currently invisible to exactly the
   reporting `return_reason` was added for. A supplier who shipped wrong once and a supplier who
   shipped wrong four times against the same order are indistinguishable today.
