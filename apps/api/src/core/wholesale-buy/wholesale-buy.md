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
| `CREATED` | Order recorded. Legacy system status **1**. Editable until `confirmDueAt`. | no |
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

## 2. Confirmation and the Edit Window

`CONFIRMED` is a real status, not a derived query condition — the legacy system's status 2 maps
onto it, and the log records who confirmed and when.

At creation the server stamps `confirmDueAt = recordedAt + WHOLESALE_BUY_EDIT_WINDOW_HOURS`
(default **6**, clamped to the 1–12 hour band the business runs on).

- **While `CREATED` and before `confirmDueAt`:** `PATCH /wholesale-buy/:id` accepts edits.
  Weight, purity, product type and prices all recompute `weightGb`/`weightGm`/`totalAmount`.
- **After it:** edits fail with `422 no longer editable`.
- **`POST /wholesale-buy/auto-confirm`** moves every overdue `CREATED` transaction to `CONFIRMED`
  as `BOT-CONFIRM`. Idempotent — once a transaction leaves `CREATED` it stops matching. Point a
  cron at it at whatever interval suits; the deadline, not the schedule, is what decides.

A manual confirm still works at any time while `CREATED`.

---

## 3. Pricing — Both Purities on Every Transaction

Gold is quoted per **gold baht (บาททอง)**. 99.9% is quoted off the 96.5% price by the purity ratio:

```
pricePerGb999 = pricePerGb965 × (99.9 / 96.5)
```

The operator calculates and enters that value; the server stores what they typed. Both quotes are
recorded on every transaction regardless of the item's purity — the item's own purity then selects
which one drives the amount:

| Purity | `unitOfMeasure` | Price used | Amount |
|---|---|---|---|
| 96.5% | `gb` | `pricePerGb965` | `weightGb × pricePerGb965` |
| 99.9% | `g` | `pricePerGb999` | `weightGb × pricePerGb999` |

`derivePricePerGb999()` in `@gold-platform/types` pre-fills the field on the web form. It is a
convenience only — it never overwrites an entered value.

---

## 4. Delivered Weight and Variance

At `CHECKED` the operator may supply `actualWeight` — what physically arrived, in the same unit as
the ordered weight. When present:

- `actualWeightGb` / `actualWeightGm` / `actualAmount` are written to the transaction.
- **Inventory increments the actual weight**, at cost `actualWeightGb × the purity-matched price`.
- The ordered figures are left untouched, so the variance stays visible in the list and detail views.

`actualWeight` resolves through `resolveMeasuredQuantity()`, not `resolveQuantity()` — a delivery
arriving 11.95 GB against a 12 GB order is a legitimate short delivery, not invalid input, so the
orderable-quantity rules (`minQuantity`, `allowedValues`) must not apply to it.

Omit `actualWeight` and the ordered weight is what enters inventory.

---

## 5. Inventory Hook

| When | Effect |
|---|---|
| Entering `CHECKED` (from `RECEIVED` or `DISPUTED`) | `increment()` — one balance upsert + one movement row, `referenceType: 'WHOLESALE_BUY'`, `referenceId` = transaction id |
| Every other status | nothing |

Always `origin: 'foreign'` — only smelting produces domestic stock. For 99.9% the server forces
`brandId = 'NA'` (those pools are keyed by origin, not brand), so the caller omits the brand.

**Corrections after `CHECKED`** do not reopen the transaction. It is terminal by design. Post a
manual adjustment through `POST /inventory/loss` (or `/gain`) with `referenceType: WHOLESALE_BUY`
and a note pointing at the transaction — the correction then shows up in the movement ledger
alongside the original, which a silent edit never would.

---

## 6. Endpoints

All require a JWT. `recordedBy` / `updatedBy` come from the token, never the body.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/wholesale-buy` | create; `settlementPeriod` is derived server-side |
| `GET` | `/wholesale-buy` | filters: `currentStatus`, `settlementPeriod`, `supplierId`. Newest first |
| `GET` | `/wholesale-buy/:id` | `{ transaction, statuses }`, status log oldest→newest |
| `PATCH` | `/wholesale-buy/:id` | edit; `CREATED` and inside the window only |
| `POST` | `/wholesale-buy/:id/status` | `{ toStatus, note?, actualWeight? }` |
| `POST` | `/wholesale-buy/:id/receive-check` | `{ actualWeight?, note? }` — `PAID → RECEIVED → CHECKED` in one call |
| `POST` | `/wholesale-buy/auto-confirm` | the cron job's entry point |

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
`price_per_gb_999` the 99.9% one. `actual_weight_gb` / `actual_weight_gm` / `actual_amount` are
null until the shipment is checked, and stay null when it matched the order.

`whole_buy_statuses` — append-only log, never updated or deleted. `current_status` on the
transaction is a write-through cache of the latest entry and is recomputable from this table.

---

## 9. Domain Errors

| Error | HTTP | When |
|---|---|---|
| `TransactionNotFoundError` | 404 | id does not exist |
| `InvalidTransitionError` | 422 | `toStatus` is not a legal next state |
| `NoteRequiredError` | 422 | failure-branch transition with no note |
| `EditWindowExpiredError` | 422 | edit attempted after `confirmDueAt` or outside `CREATED` |
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
