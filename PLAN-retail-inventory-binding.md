# Plan — Retail buy / sell move inventory

**Status:** implemented 2026-09-21 — questions answered (see §Decisions); migration `0005` generated, **not yet applied to any database**
**Branch:** `enchance/retail-trading-inventory-binding`
**Follows:** `753f8ac` `[web] /trading opens month-to-date`

---

## Why

Both retail domains were built as a price write-up layer with **no inventory coupling** (CONTEXT.md
rule 7). Stock bought over the counter reaches the balance only when someone posts a manual
`POST /inventory/gain` with `referenceType: RETAIL_BUY`, typically one pooled entry per goods
receipt rather than one per trade; a counter sale likewise reaches it only as a manual loss.

That leaves the balance a step behind the trades, and the pooled gain carries no link to the trades
it stands for. The ask is to bind the two:

- **retail-buy** books its own increment, per transaction, at the transaction's own cost, split
  across brand pools the same way wholesale-buy is (e.g. 20 GB → 10 GB ฮั่วเซ่งเฮง + 10 GB อื่นๆ).
- **retail-sell** gains one further status, the moment gold leaves inventory, which decrements and
  is the end of the line for now — exactly the wholesale-sell `PACKED` shape, with later states
  (shipping, payment) to follow in another change.

## What already exists, and is reused verbatim

| Piece | Where | Reuse |
|---|---|---|
| Split → pools, residual to `NA` by subtraction, exceeds-weight refused | `infrastructure/brand-split.ts` `divideWeight()` | as is |
| Cost apportioned by weight, last line absorbs rounding | `apportionCost()` | as is |
| All-or-nothing multi-pool increment / decrement, cost from live WAC on the way out | `inventory.usecase` `incrementSplit` / `decrementSplit` | as is |
| Reversal replaying the ledger back into the pools it left | `reverseDecrement()` | **not used** — Q4 decided against a return path for now |
| Split read back off the ledger for the detail page | `findBrandSplitByReference()` | as is |
| Split entry UI with clamped inputs and a read-only residual | `components/BrandSplitFields.tsx` | generalised — see below |
| `RETAIL_BUY` / `RETAIL_SELL` ledger labels | `TRANSACTION_TYPES` | as is; stay selectable for manual corrections |

The one piece that does not carry over is **which brands may be named**. Wholesale reads
`suppler_brands` for the counterparty; a walk-in customer has no supplier row. Retail resolves
against the brand master instead (Q5), through `divideWeight` with `brandLock: false`.

## Design

### Retail buy

```
CONFIRMED ──> STOCKED          increment fires here
CONFIRMED ──> CANCELLED        note required, no stock touched
STOCKED   ──> (terminal)
```

| Transition | Input | Inventory effect |
|---|---|---|
| entering `STOCKED` | `brandSplit` (named brands only) | `incrementSplit`, `referenceType: RETAIL_BUY`, `referenceId` = transaction id, `origin: foreign` |

- **Cost entering the pools is `totalAmount`** — `weightGb × pricePerGb`, gold value only —
  apportioned across the split by `apportionCost`. `operationFee` stays out, as it does everywhere.
- **Weight entering is the transaction weight**, both units as stored. The split cannot change it.
- 99.9%: no split accepted, whole weight to `NA` (pools keyed by origin, as wholesale).
- The `brandId` column on the table stays nullable and unread; the split lives in the ledger, as
  it does for wholesale.
- The increment runs **before** the status row is written, so a failure leaves the transaction
  `CONFIRMED`.

### Retail sell

```
CONFIRMED ──> PACKED           decrement fires here
CONFIRMED ──> CANCELLED        note required, no stock touched
PACKED    ──> (end for now)    hand-over, payment and a return path come later
```

| Transition | Input | Inventory effect |
|---|---|---|
| entering `PACKED` | `brandSplit` | `decrementSplit`, `referenceType: RETAIL_SELL`, cost from each pool's live WAC; one short pool fails the whole move (`InsufficientStockError` → 422, stays `CONFIRMED`) |

`SHIPPED` stays in the enum, unreachable, for the later shipping state.

### Shared

- `advanceRetail{Buy,Sell}StatusSchema` gains `brandSplit: brandSplitSchema.optional()`.
- `RETAIL_{BUY,SELL}_STATUSES` / `_TRANSITIONS` updated; the API re-types them as today.
- `brand-split.ts` gains `resolveRetailBrandSplit({ purityId, weights, requested })`: fetches the
  active brands (Q5), then `divideWeight` with `brandLock: false`. `BrandNotSuppliedError`'s
  message is generalised so it does not mention a supplier.
- `getTransaction` on both domains returns `brandSplit` alongside `statuses`, as wholesale does.
- Routes map `brandSplitHttpError` and `InsufficientStockError` like the wholesale routers.

## Changes by layer

| Layer | Change |
|---|---|
| `packages/types` | statuses, transitions, note-required, advance schemas; comment block rewritten — "no inventory coupling" is no longer true |
| DB | migration adding the new enum value(s): `retail_buy_status` + `STOCKED` (Q1), `retail_sell_status` + `PACKED` (Q3) |
| `brand-split.ts` | `resolveRetailBrandSplit`, message tweak, unit tests |
| `retail-buy` usecase / port / routes | stock hook on the new transition, split resolution, `brandSplit` on detail |
| `retail-sell` usecase / port / routes | decrement hook, `brandSplit` on detail |
| Tests | both retail suites currently assert **no** inventory call on any path; rewritten to assert the calls, the all-or-nothing failure leaving status unchanged, and that 99.9% refuses a split |
| Web `BrandSplitFields` | takes its brand list from a prop / source selector (`supplier` vs `all-active`) so the wholesale dialogs are untouched |
| Web `pages/retail/*`, `utils/retailStatus.ts`, hooks | the status dialog shows the split fields on the stock-moving status; detail page shows the recorded split on a `ยี่ห้อ` row; new chips/labels; `useAdvance` carries `brandSplit`; invalidates `inventory` queries |
| Docs | `retail-buy.md`, `retail-sell.md`, `CONTEXT.md` rule 7, `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md` §9g, `TASKS.md` |

## Assumptions (state here, not asked)

- `movementDate` is the day of the transition, as for every non-manual domain. A backdated
  write-up dates the trade; it does not replay the balance.
- `RETAIL_BUY` / `RETAIL_SELL` stay available in the manual gain / loss dropdowns for corrections
  after the fact, matching the wholesale precedent.
- Product types unchanged: `BAR` and `PLATE`, both purities.
- No edit path is added; a wrong write-up is still voided and re-entered.

## Decisions

Answered by the operator on 2026-09-21.

| # | Question | Decision |
|---|---|---|
| Q1 | Buy: increment on a separate status, or at create? | **A separate status advance step** — `CONFIRMED → STOCKED` |
| Q2 | Buy: after stocking, terminal or voidable? | **Terminal, as wholesale-buy.** Corrections via manual stock loss |
| Q3 | Sell: new `PACKED`, or reuse `SHIPPED`? | **New `PACKED`**, as wholesale-sell. `SHIPPED` kept for later |
| Q4 | Sell: void from `PACKED` with a reversal? | **No — a dead end for now.** Corrections via manual stock gain |
| Q5 | Which brands can a retail split name? | **A mix of ฮั่วเซ่งเฮง and อื่นๆ on both sides** — every active brand except `NA`, residual to `NA` |

## Verification

- `pnpm type-check`, both api and web unit suites.
- Live: buy 20 GB 96.5% → stock 10 + 10 → balance rises on both pools with cost = totalAmount,
  two ledger rows under the transaction id; sell 5 GB → pack from ฮั่วเซ่งเฮง → one row, cost at live
  WAC; short pool → 422 and the sale still `CONFIRMED`; 99.9% refuses a split; void before the
  stock move touches nothing.
