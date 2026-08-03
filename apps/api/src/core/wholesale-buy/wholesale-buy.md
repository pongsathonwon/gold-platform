# wholesale-buy — Domain Spec

Company buys gold **from a supplier**. Counts in Net Company Orders for the period.

**One item per transaction.** There is no line-item table — a multi-item order is recorded as
multiple transactions. This is deliberate: it keeps the status machine per-item, so a partial
delivery or a single disputed bar never puts a whole order into an ambiguous state.

---

## 1. State Machine

```
CREATED ─┬─> CONFIRMED ─┬─> PAID ──> RECEIVED ─┬─> CHECKED        (inventory increments here)
         │              │                      ├─> DISPUTED ─┬─> CHECKED
         │              │                      │             └─> RETURNED
         │              │                      └─> RETURNED
         │              └─> PAYMENT_FAILED ─┬─> PAID
         │                                  ├─> CANCELLED
         │                                  └─> REJECTED
         ├─> CANCELLED
         └─> REJECTED
```

| Status | Meaning | Terminal |
|---|---|---|
| `CREATED` | Order recorded. Legacy system status **1**. Editable for as long as it stays here. | no |
| `CONFIRMED` | Committed to the supplier. Legacy system status **2**. | no |
| `PAID` | Payment sent and accepted. | no |
| `RECEIVED` | Goods physically arrived. Nothing has entered inventory yet. | no |
| `CHECKED` | Goods verified. **The only status that moves inventory.** | yes |
| `PAYMENT_FAILED` | Transfer bounced or the amount was wrong. Retryable back to `PAID`. | no |
| `DISPUTED` | Arrived but failed verification; held pending resolution. | no |
| `CANCELLED` | We backed out, before the supplier committed. | yes |
| `REJECTED` | The supplier declined. Tracked separately from `CANCELLED` — the counterparty killed it, which is what supplier-reliability reporting needs. | yes |
| `RETURNED` | Shipment sent back. Nothing ever enters inventory. | yes |

Rules the server enforces on every transition:

1. **The move must be in `allowedTransitions`**, else `422 invalid transition`.
2. **Failure branches require a note** (`PAYMENT_FAILED`, `DISPUTED`, `CANCELLED`, `REJECTED`,
   `RETURNED`), else `422 a note is required`. The status log is the audit trail and "why" is the
   only thing it cannot reconstruct.
3. **Cancellation is impossible once paid.** `PAID`, `RECEIVED` and `DISPUTED` have no route to
   `CANCELLED` — money has moved, so the exit is `RETURNED`, which is a physical-goods event.

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

## 4. Acceptance is All-or-Nothing

At `CHECKED` the operator may supply `actualWeight` — what physically arrived, in the same unit as
the ordered weight. **It must equal the ordered weight exactly.**

| `actualWeight` | Result |
|---|---|
| omitted, or equal to the order | → `CHECKED`. The **ordered** weight enters inventory. |
| anything else | → `DISPUTED`. **Nothing enters inventory.** The measured weight is recorded on the transaction and the discrepancy is appended to the status note. |

A short or long delivery is a discrepancy for a human to settle with the supplier, not something to
book at a pro-rated cost. The caller asks for `CHECKED`; the goods decide otherwise, and the
response body returns the status actually reached.

Resolving a dispute means re-checking with the correct weight. On acceptance the recorded
discrepancy is **cleared back to null** — acceptance implies the delivery matched, so a `CHECKED`
transaction must never display a delivered weight different from its order. The `DISPUTED` entry in
the status log is where that history lives.

The equality test compares in the pairing's **input unit** (kg or gold baht), not in GB. GB for a
99.9% order is derived through a per-transaction `conversionFactor` snapshot, so a master-rate
change between order and delivery would otherwise make two identical kg figures compare unequal.

`actualWeight` resolves through `resolveMeasuredQuantity()`, not `resolveQuantity()` — a delivery
arriving 11.95 GB against a 12 GB order is a real short delivery, not invalid input, so the
orderable-quantity rules (`minQuantity`, `allowedValues`) must not apply to it.

---

## 5. Inventory Hook

| When | Effect |
|---|---|
| Entering `CHECKED` (from `RECEIVED` or `DISPUTED`) | `increment()` of the **ordered** weight — one balance upsert + one movement row, `referenceType: 'WHOLESALE_BUY'`, `referenceId` = transaction id |
| Every other status, including `DISPUTED` | nothing |

**Always `origin: 'foreign'`, at every purity.** Only smelting produces domestic stock, and only
`convert_out` may consume it — a wholesale purchase is an import by definition, so 99.9% orders
land in the foreign pool exactly like 96.5% ones. The constant is hardcoded in the usecase and is
not caller-supplied.

For 99.9% the server also forces `brandId = 'NA'` (those pools are keyed by origin, not brand), so
the caller omits the brand entirely.

**Corrections after `CHECKED`** do not reopen the transaction. It is terminal by design. Post a
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
| `POST` | `/wholesale-buy/:id/status` | `{ toStatus, note?, actualWeight? }` → `{ status }`, the status actually reached |
| `POST` | `/wholesale-buy/:id/receive-check` | `{ actualWeight?, note? }` — `PAID → RECEIVED → CHECKED` in one call, same return |
| `POST` | `/wholesale-buy/confirm-all` | bulk confirm. `?manual=true` attributes it to the operator; without it, `BOT-CONFIRM` |

### Why `receive-check` exists

Receiving and checking are one operator action today — a handful of people work the floor and
splitting it would create conflict, not control. The endpoint still writes **both** status entries,
so when the two steps do get separated later, nothing already recorded needs migrating.

---

## 7. Settlement Period

Derived server-side from `recordedAt` by `resolveSettlementPeriod()` (`infrastructure/settlement.ts`)
using the Fri 00:00 → Thu 23:59 boundary, and frozen. Callers never supply it, and it is never
reassigned.

---

## 8. Tables

`whole_buy_transactions` — one row per item. `price_per_gb` is the 96.5% quote (the column keeps
its original name; the `pricePerGb965` field name just makes the meaning explicit),
`price_per_gb_999` the derived 99.9% one. `actual_weight_gb` / `actual_weight_gm` / `actual_amount`
hold an **outstanding discrepancy** only: set when a check is diverted to `DISPUTED`, cleared again
if the shipment is later accepted. Null therefore always means "matches the order".

`whole_buy_statuses` — append-only log, never updated or deleted. `current_status` on the
transaction is a write-through cache of the latest entry and is recomputable from this table.

---

## 9. Domain Errors

| Error | HTTP | When |
|---|---|---|
| `TransactionNotFoundError` | 404 | id does not exist |
| `InvalidTransitionError` | 422 | `toStatus` is not a legal next state |
| `NoteRequiredError` | 422 | failure-branch transition with no note |
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
