# API — Claude Context

## Stack

- **Framework:** Hono (Node.js)
- **ORM:** Drizzle ORM + `postgres` driver
- **Effect system:** `effect` (v3) — all async/error handling goes through Effect
- **Validation:** Zod + `@hono/zod-validator`
- **Auth:** JWT via Hono JWT helper + bcryptjs
- **Language:** TypeScript (ESM, `tsx` for dev)

## Directory Structure

```
src/
├── index.ts                  — entry point: Hono app, route mounts, server startup
├── core/                     — business domains (hexagonal architecture)
│   ├── auth/
│   ├── user/
│   ├── master/               — brands, purities, suppliers, branches, products, sizes, product-purity rules
│   ├── inventory/            — balance tracking, live-WAC outbound, movement ledger
│   ├── wholesale-buy/
│   ├── wholesale-sell/
│   ├── retail-buy/
│   ├── retail-sell/
│   ├── receive/              — goldbar intake from branches, grace-period cancel, bot auto-confirm
│   ├── smelting/             — (planned) non-goldbar → goldbar conversion, increment at CONFIRMED
│   └── convert-out/          — (planned) goldbar decrement with free-text result, grace-period cancel
└── infrastructure/
    ├── runtime.ts            — AppLayer composition, ManagedRuntime, runEffect()
    ├── weight.ts             — resolveWeights() shared Effect
    ├── quantity.ts           — resolveQuantity() (validated) / resolveMeasuredQuantity() (as-weighed)
    ├── settlement.ts         — resolveSettlementPeriod(date) using the Fri–Thu boundary
    ├── db/
    │   ├── client.ts         — Drizzle connection pool, RepositoryError
    │   └── schema/index.ts   — re-exports all domain schemas
    ├── http/errors.ts        — handleExit, global error-to-HTTP mapping
    └── utils/
        ├── env.ts            — AppConfig Context.Tag, Zod env validation
        ├── jwt.ts            — JWTService
        └── hasher.ts         — HashService (bcrypt)
```

## Domain File Layout

Every domain is identical:

```
core/<domain>/
  port/<domain>.port.ts           — errors (Data.TaggedError), Context.Tag, command shapes, allowedTransitions map
  application/<domain>.usecase.ts — plain Effect.gen() functions, Layer composition, inventory side-effects
  adapter/<domain>.repository.ts  — Drizzle ORM implementation of repository interface
  adapter/<domain>.routes.ts      — Hono router, Zod validators, toHttpError() mapping
  <domain>.md                     — domain spec (business rules, state flow, tables)
```

No classes in usecases. All usecases are plain `Effect.gen()` functions.

## Effect Patterns

**Running an Effect in a route:**
```typescript
const exit = await appRuntime.runPromiseExit(myUsecase(input))
return runEffect(exit, c, toHttpError)
```

**Building a usecase layer:**
```typescript
const layer = Layer.effect(MyRepository, makeMyRepository)
return myEffect.pipe(Effect.provide(layer))
```

**Error types:**
```typescript
class MyDomainError extends Data.TaggedError("MyDomainError")<{ message: string }> {}
```

**`toHttpError()` in every routes file:**
```typescript
function toHttpError(error: unknown): [string, number] {
  if (error instanceof TransactionNotFoundError) return [error.message, 404]
  if (error instanceof InvalidTransitionError) return [error.message, 422]
  if (error instanceof InsufficientStockError) return [error.message, 422]
  return [JSON.stringify(error), 500]
}
```

## Transaction Domains

All domains share the same status-log pattern: two tables (`*_transactions` + `*_statuses`), `currentStatus` as write-through cache, `allowedTransitions` map in port file, `InvalidTransitionError` → 422 on invalid moves.

`settlementPeriod` is **auto-derived from `recordedAt`** on the server using Fri–Thu boundary — callers never send it.

| Domain | Status Flow | Inventory Hook |
|--------|-------------|----------------|
| wholesale-buy | `CREATED → CONFIRMED → PAID → RECEIVED → STOCKED`, plus the failure branches below | `increment` on entering `STOCKED` |
| wholesale-sell | `CREATED → CONFIRMED → PACKED → SHIPPED → PAID`, plus the failure branches below | `decrement` on entering `PACKED`, reversed on `RETURNED` |
| retail-buy | `DRAFT → CONFIRMED` \| `DRAFT/CONFIRMED → CANCELLED` | none |
| retail-sell | `DRAFT → CONFIRMED → SHIPPED` \| `DRAFT/CONFIRMED → CANCELLED` | `decrement` at `CONFIRMED → SHIPPED` |
| receive | `RECEIVED → CONFIRMED` \| `RECEIVED → CANCELLED` (grace period only) | `increment` at `RECEIVED → CONFIRMED` |
| smelting | `DRAFT → CONFIRMED` \| `DRAFT → CANCELLED` (grace period only) | `increment` at `DRAFT → CONFIRMED` |
| convert-out | `DRAFT → CONFIRMED` \| `DRAFT → CANCELLED` (grace period only) | `decrement` at `DRAFT → CONFIRMED` |

Grace-period domains (receive, smelting, convert-out): cancel only allowed within **2 hours** of the initial status entry. A bot job auto-confirms after the grace period using `createdBy: 'BOT-CONFIRM'`.

### wholesale-buy in full — the reference implementation

It is the only domain built out with failure branches. See `core/wholesale-buy/wholesale-buy.md`.

```
CREATED ─┬─> CONFIRMED ─┬─> PAID ─┬─> RECEIVED ─┬─> STOCKED   (increment fires here)
         │              │         │             └─> DISPUTED ─┬─> STOCKED | RETURNED
         │              │         ├─> RETURNED ─┬─> REFUNDED | RECEIVED | WRITTEN_OFF
         │              │         └─> DELIVERY_FAILED ─┬─> RECEIVED | WRITTEN_OFF
         │              ├─> PAYMENT_FAILED ─┬─> PAID | CANCELLED | REJECTED
         │              ├─> CANCELLED
         │              └─> REJECTED
         ├─> CANCELLED
         └─> REJECTED
```

- **`CANCELLED` vs `REJECTED`** — we backed out vs the supplier declined. Separate states because
  supplier reliability is reportable; both are terminal.
- **Cancelling *is* allowed while `CONFIRMED`** (this reverses an earlier rule). BU needs an exit
  from a confirmed order for a human error, and routing that through `REJECTED` poisons the one
  metric `REJECTED` exists to feed. Nothing has moved yet, so nothing unwinds. wholesale-sell
  matches.
- **`DELIVERY_FAILED` → `WRITTEN_OFF`** covers "we paid and nothing ever arrived"; the exact
  mirror of the sell side's `SHIPPED → PAYMENT_FAILED → WRITTEN_OFF`.
- **Note required** on every failure-branch transition (`NoteRequiredError` → 422). The status log
  is the audit trail and "why" cannot be reconstructed from anywhere else.
- **`RETURNED` also requires a `returnReason`** (`WEIGHT | BRAND | PURITY | DAMAGED | OTHER`,
  `ReturnReasonRequiredError` → 422). Prose in a note cannot be aggregated, and supplier
  reliability has to be countable.
- **No cancelling after payment** — `PAID`/`RECEIVED`/`DISPUTED`/`RETURNED` exit via `REFUNDED` or
  `WRITTEN_OFF`, not `CANCELLED`.
- **Inventory moves once, on entering `STOCKED`** — put away, not merely arrived, and always
  `origin: 'foreign'` at **every** purity (only smelting makes domestic stock).
- **Accept as documented.** Acceptance takes *no* weight: it means the delivery matched its
  document, so the ordered weight is what enters stock. The check is physical and happens at the
  door, before custody transfers — a delivery whose weight or purity disagrees is refused
  via `PAID → RETURNED` and never signed for. Purity is not a discrepancy to negotiate but the
  wrong product, and there is no amend path: refuse, terminate, create a new transaction.
- **Acceptance *does* take the brand split.** There is no `brand_id` on either wholesale
  transaction table. See "Brand at inventory time" below.
- **`RETURNED` is not terminal.** Our money left at `PAID`, so a shipment going back leaves the
  supplier holding it. It resolves to `REFUNDED` (money back), `RECEIVED` (they re-delivered the
  correct item) or `WRITTEN_OFF` (they never made us whole).
- **`RECEIVED` has no direct route to `RETURNED`.** Once custody transfers, sending gold back goes
  through `DISPUTED`, which is where the reason and the contested weight are recorded — and the
  only move on a buy that stores a weight at all.
- **`settledAmount`** is captured on the move into `PAID` when the payment differed from
  `totalAmount`. A field, not a status: an accepted variance closes the deal exactly like an exact
  payment, so it does not earn a state. Mirrored on wholesale-sell.
- **Post-`STOCKED` corrections** go through `POST /inventory/loss|gain` with
  `referenceType: WHOLESALE_BUY`. Terminal transactions are never reopened.
- **Confirmation is a bulk sweep, not a per-order deadline.** `POST /wholesale-buy/confirm-all`
  moves *every* `CREATED` transaction to `CONFIRMED`; the nightly cron calls it (logged as
  `BOT-CONFIRM`), and `?manual=true` is the operator's mid-day run (logged under their username).
  `PATCH /wholesale-buy/:id` is accepted while `CREATED` and refused after — confirmation is the
  lock. `confirmDueAt` (`WHOLESALE_BUY_AUTO_CONFIRM_HOUR`, default midnight) records when the next
  sweep lands and is **informational only**; nothing tests against it.
- **`POST /wholesale-buy/:id/receive-stock`** does `PAID → RECEIVED → STOCKED` in one call because
  that is one operator action and BU wants it to stay one. It takes no weight. Both status rows are
  still written, so splitting the steps later needs no migration. This is deliberately *not*
  mirrored on the sell side — see below.
- **One price in, two stored.** The operator enters `pricePerGb965` only; the server derives
  `pricePerGb999 = 965 × 99.9/96.5` via the shared `derivePricePerGb999()`. The create schema does
  not accept the 99.9% quote — two typed prices could disagree, a derived one cannot. The item's
  purity picks which drives `totalAmount`.

The transition map is `WHOLE_BUY_TRANSITIONS` in `@gold-platform/types`, shared with the web app so
the UI offers exactly the moves the API accepts; the port re-types it against the DB enum, so any
divergence is a compile error.

### wholesale-sell — the same machine, inverted

Built as a deliberate mirror of wholesale-buy. See `core/wholesale-sell/wholesale-sell.md`.

```
CREATED ─┬─> CONFIRMED ──> PACKED ──> SHIPPED ─┬─> PAID
         │                  │           │      ├─> DISPUTED ─┬─> PAID | RETURNED
         │                  │           │      ├─> PAYMENT_FAILED ─┬─> PAID | WRITTEN_OFF
         │                  │           └──────┴─> RETURNED
         │                  └─> RETURNED
         │           (CONFIRMED also ─> CANCELLED | REJECTED)
         ├─> CANCELLED
         └─> REJECTED

decrement on entering PACKED · reversed on entering RETURNED
```

Everything structural is shared with buy — two tables, append-only status log, note required on
every failure branch, bulk `confirm-all` sweep as the edit lock, one entered price with the 99.9%
quote derived, two goods states behind one endpoint. **The real difference is that a sell's two
irreversible events happen in the opposite order**: we hand over gold first and get paid after.

- **Inventory decrements on entering `PACKED`** — when gold leaves the vault to be boxed, not when
  it ships and not when the money lands. This is what keeps the two domains prudent in the *same*
  direction: buy increments on the **second** goods state (`STOCKED`), sell decrements on the
  **first** (`PACKED`), so neither ever reports stock it does not physically hold. An earlier
  draft decremented at delivery and overstated stock for the whole transit window.
- **Packing and shipping are two separate actions**, both plain `/status` moves. They used to be
  fused behind `/pack-ship`, copied from buy's `receive-stock` by symmetry rather than from
  anything BU said. Receiving and stocking really are one moment; a packed box waits for a courier.
  Splitting them makes `PACKED` an observable resting state — so `CONFIRMED` is the "waiting to be
  packed" worklist and `PACKED` the "waiting to ship" one — distinguishes on-premises from
  off-premises custody, and makes `PACKED → RETURNED` a path something can actually take. The
  decrement did not move; it still fires on entering `PACKED`. **The buy/sell symmetry governs
  which edge of the transit window moves stock, not how many endpoints each domain exposes.**
- **A `PACKING` state was considered and rejected**: one exit and no decision at it is a progress
  indicator, not a state, and it would force the decrement either before the box is verified or
  after the gold left the vault.
- **`RETURNED` reverses the decrement** via `reverseDecrement()` (the first domain to wire it),
  booking opposite movements under `WHOLESALE_SELL_RETURN` rather than editing the original.
  Reachable from `PACKED`, `SHIPPED` and `DISPUTED` — every post-decrement state the gold can come
  home from. **Not** from `PAYMENT_FAILED`: there the buyer kept the gold *and* stiffed us.
- **Packing records no weight.** We boxed our own gold from our own vault, so there is no second
  independent measurement to capture; the agreed weight is what leaves. This replaced a
  `WeightMismatchError` equality check that could only ever reject a typo. A short pool is still a
  hard error (`InsufficientStockError` → 422, transaction stays `CONFIRMED`, nothing decremented).
- **`DISPUTED` records the buyer's contested weight** on `actualWeight*` and moves no stock. Across
  both domains the rule is now one line: *the only weight ever recorded besides the agreed one is a
  contested one.*
- **Cancelling is allowed until gold leaves the vault**, matching buy: `CREATED` and `CONFIRMED`
  both route to `CANCELLED`; from `PACKED` on, the exit is `RETURNED`.
- **`RETURNED` requires a `returnReason`** and **`PAID` accepts a `settledAmount`**, both exactly
  as on the buy side.
- **`WRITTEN_OFF`** is the terminal for a delivery that never gets paid for. It is the only
  bad-terminal status that still counts toward list weight totals — the gold really did leave, and
  nothing brought it back.

`WHOLE_SELL_TRANSITIONS` in `@gold-platform/types` is the shared map, re-typed against the DB enum
in the port exactly as buy does it. `WHOLESALE_SELL_AUTO_CONFIRM_HOUR` is its own env var.

### Brand at inventory time — `infrastructure/brand-split.ts`

**Neither wholesale table has a `brand_id` column.** Brand is not a property of an order, it is a
property of the metal, and it is only known when the metal is in front of you — a supplier that is
not `brandLock` routinely ships a mix of stamps. So brand is supplied on the transition that moves
stock (buy: `STOCKED` via `/status` or `/receive-stock`; sell: `PACKED`) as a `brandSplit`, and
lands as one inventory movement per pool.

| Supplier | What the caller sends |
|---|---|
| `brandLock = true` | nothing — its one `suppler_brands` row takes 100%; a split is a 422 |
| `brandLock = false` | a weight per registered brand; `NA` takes the residual |
| 99.9%, any supplier | nothing — pools are keyed by origin; a split is a 422 |

- **The split always sums to the transaction weight, by construction.** Callers name only the
  branded portions; the residual is `weightGb − Σ named`, taken by **subtraction** so the lines
  restore the stored `weightGm` to the last decimal whatever the conversion factor rounds to.
  There is no total field to disagree with and no residual field to mistype, so an unequal
  increment/decrement is unrepresentable. Naming *more* than the transaction is the one failure
  left, and it is refused (`BrandSplitExceedsWeightError` → 422) rather than clamped.
- **`divideWeight()` is the whole rule as a pure function**, with the three DB lookups lifted out
  into the thin `resolveBrandSplit()` wrapper around it. That is what lets
  `brand-split.test.ts` assert the reconstruct-the-transaction invariant with no database and no
  mocking. Both domains' usecase suites mock `resolveBrandSplit` as a pass-through.
- **Which brands a supplier may ship is `suppler_brands` data, not code.** Registering a second
  stamp is a seed row. BU tracks only ฮั่วเซ่งเฮง and `NA` today because identifying every stamp on
  the floor is not work they can do — but nothing in the code knows that.
- **`incrementSplit` / `decrementSplit` move every pool in one DB transaction**
  (`incrementMany` / `decrementMany` in the inventory repository). One short pool fails the whole
  move with nothing written anywhere. `increment` / `decrement` are now the single-brand case
  expressed through the same path, so *every* movement in the system is all-or-nothing.
- **The ledger is the record — there is no allocation table.** The movements booked under a
  transaction's reference *are* its split, so the figures a detail page shows are the rows the
  balances were built from and cannot drift from them. `getTransaction` reads them back via
  `findBrandSplitByReference()`. It is also why `reverseDecrement()` unwinds a mixed sell
  correctly with no new code: it replays each movement into the pool it came from.
- Cost is apportioned across an increment's pools by weight, last line absorbing the rounding, so
  they reconcile to `totalAmount` exactly. Decrements ignore it — each pool's own live WAC decides.

## Settlement Period

`settlementPeriod` is a reporting bucket — a week label (e.g. `"2026-W24"`) auto-computed from `recordedAt` using a fixed Fri–Thu boundary. Callers never supply it.

`resolveSettlementPeriod(date)` lives in `infrastructure/settlement.ts`. It shifts the date back 4 days before computing the ISO week, which maps each Fri–Thu span onto exactly one Mon–Sun ISO week so no two periods collide. **wholesale-buy uses it; the other transaction domains still take `settlementPeriod` from the caller and should be migrated onto it.**

Each domain exposes a summary endpoint for net position reporting:
- `GET /retail-buy/settlement/:period/summary`
- `GET /retail-sell/settlement/:period/summary`
- `GET /wholesale-buy/settlement/:period/summary`
- `GET /wholesale-sell/settlement/:period/summary`

Endpoints are split per domain (not merged) to keep domains isolated. Client calls in parallel to build a combined dashboard view.

## Product Type × Purity Constraint

Not all purities are valid for every product type (e.g. gold-plate can only be 96.5). Admin configures valid combinations at go-live via `product_type_purities` join table.

`resolveQuantity(productTypeId, purityId, weight)` in `infrastructure/quantity.ts` — the shared Effect every `createTransaction` usecase calls. It looks the pairing up, validates the weight against that pairing's `minQuantity` / `allowedValues`, converts from the pairing's input unit (kg or gb), and delegates to `resolveWeights()`. Fails `ProductTypePurityNotFoundError` or `InvalidQuantityError` → 422.

`resolveMeasuredQuantity(...)` is the same thing **without** the quantity validation, for weights that were *measured* rather than ordered — a delivery arriving 11.95 GB against a 12 GB order is a short delivery, not invalid input. Use it for any as-weighed figure; never for an ordered one.

## Weight & Purity Resolution

`purity.unitOfMeasure` determines conversion direction. Callers always send a single `weight` field — the server resolves both `weightGb` and `weightGm`:

| unitOfMeasure | Purity | Caller sends | Server computes |
|---------------|--------|--------------|-----------------|
| `g` | 99.9 | grams | `weightGb = weight / conversionFactor` |
| `gb` | 96.5 | baht | `weightGm = weight * conversionFactor` |

`conversionFactor` is auto-resolved from `unit_conversions ORDER BY effectiveDate DESC`. All `createTransaction` usecases call `resolveWeights(purityId, weight)` from `infrastructure/weight.ts`. Full rationale in `core/weight-and-purity.md`.

## Inventory Domain

Internal service — not called over HTTP from other domains. Cross-domain calls are direct Effect function composition.

### Model: Aggregate Balance (no lots)

Stock is tracked as a single aggregate row per pool `(purityId, brandId, origin, productTypeId)` in `inventoryBalance`. There are no per-lot records. Cost basis is **live WAC (Weighted Average Cost)** — the outbound rate is `balance.totalCost / balance.totalWeightGb` read from the current balance inside the decrement's locked transaction, so it stays correct even for pools (e.g. 99.9% `NA`) that hit zero and refill within the same day.

### Origin

| Origin | Produced by | Can be decremented by |
|--------|-------------|----------------------|
| `domestic` | `smelting` only — always domestic | `convert_out` only |
| `foreign` | all other inbound | any outbound domain |

All domain callers hardcode their origin. Only `convert_out` accepts `origin` as caller input.

**99.9% goldbar:** `brandId = 'NA'` (sentinel, `active=false`), origin is the meaningful pool key.  
**96.5% products:** `brandId` = actual brand, `origin = 'foreign'` always. On the wholesale domains
that brand comes from the brand split recorded at the stock-moving transition, not from the order.

### Functions

| Function | Caller | Effect |
|----------|--------|--------|
| `incrementSplit(req)` | wholesale-buy at `STOCKED` | upsert balance `+delta` + movement **per branded pool**, all in one DB transaction |
| `decrementSplit(req)` | wholesale-sell at `PACKED` | per pool: lock, check, cost at that pool's live WAC, movement `-delta` — one DB transaction, so one short pool fails the lot with nothing written |
| `increment(req)` | receive at `CONFIRMED`, smelting at `CONFIRMED` | the single-brand case, delegating to `incrementSplit` |
| `decrement(req)` | retail-sell at `SHIPPED`, convert-out at `CONFIRMED` | the single-brand case, delegating to `decrementSplit`. Fails `InsufficientStockError` if the balance is short. |
| `findBrandSplitByReference(type, id)` | wholesale-buy/sell `getTransaction` | reads a transaction's recorded brand split back off the movement ledger — there is no allocation table |
| `reverseDecrement(req)` | (not yet wired) | find movements by reference → reverse balance delta → insert reverse movements |
| `productSwitch(req)` | `POST /inventory/product-switch` | decrement non-fungible brand pool at its live WAC (`fromCostDelta`) → increment `'NA'` pool with the same value (`toCostDelta = fromCostDelta`, cost conserved). Same purity + productType only. Atomic. |
| `stockGain(req)` | `POST /inventory/gain` | operator enters `pricePerGb`; `totalCost = pricePerGb × weightGb` → insert adjustment record → upsert balance `+delta` → insert movement |
| `stockLoss(req)` | `POST /inventory/loss` | decrement balance `-delta` at live WAC first (fails `InsufficientStockError` if short) → insert adjustment record → insert movement |

### WAC Flow (live)

Outbound cost is derived from the current balance at decrement time — **no daily-snapshot dependency**:
- `decrementBalance` selects the pool row `FOR UPDATE`, checks sufficiency, then computes `rate = totalCost / totalWeightGb` and `costDelta = weightGb × rate` inside the same transaction, and returns `costDelta`.
- Safe from divide-by-zero: `available ≥ weightGb > 0` at that point, so a decrement never runs on a zero-weight pool.
- Because every `increment` updates `totalCost`/`totalWeightGb`, a pool refilled after hitting zero always decrements at the up-to-date average — this is what fixed the 99.9% zero-inventory cost bug.
- The daily-snapshot machinery (`inventory_daily_snapshots` table, `computeSnapshots`, `GET/POST /inventory/snapshots*`, the "Compute Today's Rate" button) was **removed** — nothing consumed it after the switch to live WAC. Past balances are reconstructable from the `inventory_movements` ledger if a point-in-time valuation is ever needed.

`referenceType` on `inventory_movements` is a **free-text varchar** (not an enum). The gain/loss forms now set it from the shared `TRANSACTION_TYPES` list in `@gold-platform/types` (`WHOLESALE_BUY`, `WHOLESALE_SELL`, `RETAIL_BUY`, `RETAIL_SELL`, `RECEIVED`, `SMELTING`, `CONVERT_OUT`, `PRODUCT_SWITCH`, `STOCK_COUNT`, `DAMAGE`, `LOST`, `MANUAL_CORRECTION`) so all movement types can be recorded through core inventory until each gets its own module. Cross-domain callers still register their own string.

## Schema Files

| File | Tables |
|------|--------|
| `master.schema.ts` | `gold_product_type`, `gold_brands`, `purities`, `bar_sizes`, `suppliers`, `supplier_product_types`, `suppler_brands` (now read — drives the brand split), `unit_conversion`, `branches`, `product_type_purities` (planned) |
| `inventory.schema.ts` | `inventory_balance`, `inventory_movements`, `stock_gain_adjustments`, `stock_loss_adjustments`, `product_switch_adjustments` |
| `wholesale-buy.schema.ts` | `whole_buy_transactions`, `whole_buy_statuses` |
| `wholesale-sell.schema.ts` | `whole_sell_transactions`, `whole_sell_statuses` |
| `retail-buy.schema.ts` | `retail_buy_transactions`, `retail_buy_statuses` |
| `retail-sell.schema.ts` | `retail_sell_transactions`, `retail_sell_statuses` |
| `received.schema.ts` | `received_transactions`, `received_statuses` |
| `smelting.schema.ts` | (planned) `smelting_transactions`, `smelting_statuses` |
| `convert-out.schema.ts` | (planned) `convert_out_transactions`, `convert_out_statuses` |

## List Filters

| Domain | Filters |
|--------|---------|
| retail-buy | `currentStatus`, `settlementPeriod`, `branchCode` |
| retail-sell | `currentStatus`, `settlementPeriod`, `branchCode` |
| wholesale-buy | `currentStatus`, `settlementPeriod`, `supplierId` |
| wholesale-sell | `currentStatus`, `settlementPeriod`, `supplierId` |
| receive | `currentStatus`, `settlementPeriod`, `branchCode` |

## Open Items

1. **User FK** — `recordedBy / createdBy / movedBy / auditedBy` are plain `varchar`; blocked on employee/customer domain decision (see below)
2. **`custCode` / `emplCode` FK** — retail domains use legacy codes; blocked on same decision
3. **Employee vs user identity** — recommendation: separate `employees` table (carries `emplCode`) from `users` (login only); `customers` table for `custCode`. Defer until stakeholders decide legacy sync strategy
4. **`users` table PK** — currently `serial` (integer); should migrate to `uuid` to match all other tables before adding any FKs
5. **DB migrations** — no migration files yet; run `drizzle-kit generate` then `drizzle-kit migrate` before any deployment. Seed: insert `'NA'` brand (`id='NA', brand='N/A', nonFungible=false, active=false`) after first migration.
6. **Goldbar-to-goldbar conversion** — resolved: `smelting` increments domestic 99.9% pool; `convert_out` decrements domestic or foreign pool. No separate conversion domain needed.
7. **Jewelry inventory** — deferred. Non-fungible tracking in Sprint 1 uses `productSwitch` to reclassify into the fungible pool when legacy POS discrepancy occurs. True item-level non-fungible tracking is a future phase.
8. **`reverseDecrement()`** — not yet wired to any domain transition. Works without lot lookup — movements now carry pool keys directly, so reversal finds and restores the correct balance row.
9. ~~**Daily snapshot as hard gate**~~ — resolved: outbound cost now uses live WAC from the balance at decrement time (`decrementBalance`). The daily-snapshot table and endpoints were removed entirely; no day-open compute is required before outbound transactions.

## Tests

`npm run test` (vitest). **No database, no server** — usecase-level only.

Every dependency a usecase reaches for is a `Context.Tag` or a single factory module, so three
`vi.mock` seams swap the edges and the domain logic runs unchanged: the repository adapter becomes
an in-memory fake from `src/test/fakes.ts`, `inventory.usecase` becomes spies, and
`infrastructure/quantity` returns fixed weights. `advanceStatus` itself executes exactly as it does
in production.

What that covers: transition rejection, note enforcement, `returnReason` enforcement, which effect
each move owns, that accepting and packing take no weight, that acceptance clears a contested one,
that `receive-stock` writes **both** status rows, and that the inventory hook runs **before** the
status row so a failed movement never leaves a log entry claiming it happened.

What it does not: any SQL, the live-WAC decrement under row lock, the HTTP layer (Zod, JWT,
`toHttpError`), and inventory's own internals. **`src/test/README.md` is the full list** — read it
before treating a green run as end-to-end safety.

The one trap: the repository holder must be `vi.hoisted` *and* read via `Effect.sync`, not
`Effect.succeed`. The domain's `Layer.effect(...)` is built once at module load, so an eager
factory captures `undefined` for the whole file and every test dies rather than failing cleanly.

Test files live beside the code they cover (`*.usecase.test.ts`) and are excluded from
`tsconfig.build.json`, so they type-check under `npm run type-check` but never reach `dist/`.

## Dev Commands

```bash
npm run dev          # tsx watch --env-file=.env src/index.ts
npm run build        # tsc -p tsconfig.build.json
npm run test         # vitest run — usecase tests, no DB
npm run db:generate  # drizzle-kit generate
npm run db:migrate   # drizzle-kit migrate
```

From the repo root, `pnpm test` runs both workspaces through turbo.

## Environment Variables

```
DATABASE_URL=postgres://postgres:password@localhost:5432/gold_platform
PORT=3000
JWT_SECRET=<32-char random secret>

# optional — the hour (0–23) the nightly confirm sweep runs, per domain. Only used to display
# when a transaction stops being editable; set them to match the real cron. Default 0.
WHOLESALE_BUY_AUTO_CONFIRM_HOUR=0
WHOLESALE_SELL_AUTO_CONFIRM_HOUR=0
```
