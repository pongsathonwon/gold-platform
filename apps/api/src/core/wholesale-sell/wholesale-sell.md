# wholesale-sell — Domain Spec

Company sells gold **to a supplier**. Counts in Net Company Orders for the period.

The mirror of `wholesale-buy`, and deliberately so: same two-table status log, same bulk-confirm
lock, same one-entered-price rule, same "goods handling is two states behind one endpoint" shape.
What differs is the **order of the two irreversible events** — on a buy we pay first and receive
after; on a sell we hand over gold first and get paid after.

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
         ├─> CANCELLED
         └─> REJECTED

         (CONFIRMED also ─> REJECTED)

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
| `CANCELLED` | We backed out, before committing to the buyer. | yes |
| `REJECTED` | The buyer declined. Tracked separately from `CANCELLED` — the counterparty killed it. | yes |
| `RETURNED` | The gold came home. **The decrement is reversed** and the stock goes back. | yes |
| `WRITTEN_OFF` | The receivable was given up on. The gold is gone and no money came for it. | yes |

Rules the server enforces on every transition:

1. **The move must be in `allowedTransitions`**, else `422 invalid transition`.
2. **Failure branches require a note** (`DISPUTED`, `PAYMENT_FAILED`, `CANCELLED`, `REJECTED`,
   `RETURNED`, `WRITTEN_OFF`), else `422 a note is required`.
3. **No cancelling once we have committed to the buyer.** `CONFIRMED` onward has no route to
   `CANCELLED` — only the counterparty can kill it, via `REJECTED`. This matches wholesale-buy
   exactly; the two domains had diverged here and were aligned onto buy's stricter rule.
4. **Nothing that has not decremented can reach `RETURNED`.** Reversing a decrement that never
   happened would invent stock out of nothing.

---

## 2. Where Inventory Moves, and Why There

`PACKED` is the decrement, not `SHIPPED` and not delivery. Gold stops being ours the moment it
leaves the vault to be boxed — that is when we can no longer sell it to anyone else.

This is what keeps the two domains **prudent in the same direction**, which is the point of the
pairing:

| | first goods state | second goods state | stock moves on |
|---|---|---|---|
| buy | `RECEIVED` — it is here | `CHECKED` — it is verified | the **second** |
| sell | `PACKED` — it left the vault | `SHIPPED` — it left the building | the **first** |

Both count the pessimistic edge of the transit window. Gold coming toward us is not ours until
verified; gold going out stops being ours the moment it leaves the vault. **Neither domain ever
reports stock it does not physically hold.** An earlier draft decremented at delivery, which
overstated stock for the whole time a shipment was in transit — the exact error the buy side had
already been designed to avoid.

`POST /wholesale-sell/:id/pack-ship` performs both transitions in one call — the mirror of buy's
`receive-check`, and one action on the floor for the same reason: the people who pull the gold are
the people who hand it to the courier. Both status rows are still written, so splitting the steps
later needs no migration.

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

## 3. A Wrong Packed Weight is an Error, Not a Status

At `PACKED` the operator may supply `actualWeight` — what came out of the vault. **It must equal
the agreed weight**, and anything else fails `WeightMismatchError` → `422` with nothing written and
nothing decremented. The transaction stays `CONFIRMED`.

This is the deliberate asymmetry with buy's `DISPUTED`, and it follows from custody: on a buy the
goods are the supplier's work and a wrong weight is a fact to record and argue about. On a sell the
gold is still in **our own vault** and we control what goes in the box, so a wrong weight is an
operator correction — re-pack and call again — not a durable state for anyone to work.

The general rule this comes from: *a failure earns its own status only when it is durable and
changes what happens next.* A wrong pack is neither. Insufficient stock is treated identically
(`InsufficientStockError` → 422, transaction stays `CONFIRMED`).

The equality test compares in the pairing's **input unit** (kg or gold baht), not in GB, because
GB for a 99.9% deal is derived through a per-transaction `conversionFactor` snapshot.

### The one weight that is recorded

`DISPUTED` is where a second weight legitimately exists: what the **buyer** says their scale read.
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
| Entering `PACKED` | `decrement()` of the agreed weight — `referenceType: 'WHOLESALE_SELL'`, `referenceId` = transaction id |
| Entering `RETURNED` | `reverseDecrement()` — restores the balance, books opposite movements under `WHOLESALE_SELL_RETURN` |
| Every other status, including `DISPUTED` | nothing |

Both run **before** the status row is written, so a movement that fails leaves the transaction
where it was rather than recording a move that never physically happened.

**Always `origin: 'foreign'`, at every purity.** The domestic pool is smelted stock and only
`convert_out` may consume it. Hardcoded in the usecase, never caller-supplied.

For 99.9% the server also forces `brandId = 'NA'` (those pools are keyed by origin, not brand).

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
| `POST` | `/wholesale-sell/:id/status` | `{ toStatus, note?, actualWeight? }` |
| `POST` | `/wholesale-sell/:id/pack-ship` | `{ actualWeight?, note? }` — `CONFIRMED → PACKED → SHIPPED` in one call |
| `POST` | `/wholesale-sell/confirm-all` | bulk confirm. `?manual=true` attributes it to the operator |

---

## 8. Settlement Period

Derived server-side from `recordedAt` by `resolveSettlementPeriod()` using the Fri 00:00 → Thu
23:59 boundary, and frozen. Callers never supply it, and it is never reassigned.

---

## 9. Tables

`whole_sell_transactions` — one row per item. `price_per_gb` is the 96.5% quote,
`price_per_gb_999` the derived one. `actual_weight_gb` / `actual_weight_gm` / `actual_amount` hold
**the buyer's contested weight** only, set on a `DISPUTED` move. Null means nobody is arguing.

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
| `WeightMismatchError` | 422 | packed weight ≠ agreed weight; nothing decremented, re-pack and retry |
| `ProductTypePurityNotFoundError` | 422 | purity is not configured for that product type |
| `InvalidQuantityError` | 422 | agreed weight breaks the pairing's quantity rule |
| `InsufficientStockError` | 422 | the pool cannot cover the pack; nothing is written |

---

## 11. Open Issues

1. **No user FK** — `recordedBy` / `createdBy` are plain `varchar`, blocked on the employee/user
   identity decision shared with every other domain.
2. **No settlement summary endpoint yet** — Phase 4 position work.
3. **No partial handover.** One transaction is one shipment.
4. **`WRITTEN_OFF` has no accounting hook.** It records the fact for reporting; whether a bad-debt
   entry should also post somewhere is a Phase 4 question.
5. **`RETURNED` restores stock at the original cost**, because `reverseDecrement()` replays the
   recorded movement. If the pool's WAC moved while the gold was out, the restored cost is the old
   one — correct for the gold that came back, but it does shift the pool average.
