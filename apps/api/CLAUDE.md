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

## Authentication & Authorization

JWT bearer tokens, one hour, signed HS256. The token carries `{ sub, username, role, exp }` — the
role travels in the claim so authorisation costs no database round trip. The trade is that a role
change only takes effect at the holder's next login, which a one-hour lifetime makes acceptable.

**There is no self-registration.** `POST /auth/register` was public: on a system where an account
can write off stock, anyone who could reach the API could grant themselves the run of the vault.
Accounts are issued via `POST /auth/users`, which requires an authenticated `ADMIN` and returns the
created user *without* a token.

| Role | Can |
|---|---|
| `OPERATOR` (default) | run the trading day — create and advance wholesale/retail transactions, read inventory and movements, read master data |
| `ADMIN` | everything an operator can, plus the manual inventory adjustments, the bulk confirm sweeps, and user administration |

The split is *who is accountable for a number nobody else asked for*. `POST /inventory/gain|loss`
and `/inventory/product-switch` move gold on the books with no counterparty behind them — their
tables carry `auditedBy` precisely because someone answers for them — so they are ADMIN. So are
`POST /wholesale-buy|sell/confirm-all`, which end the edit window for *every* open transaction at
once, not just the caller's. Everything a counterparty drives stays open to any operator: that is
the job.

`requireRole(...roles)` in `infrastructure/http/middleware/auth.middleware.ts` is mounted after
`authMiddleware` and reads the claims it verified. A token minted before the `role` claim existed
has no role and is refused rather than waved through — an unreadable claim must never widen access.

Two roles because two is what operations actually distinguish today. A granular permission matrix
is the right shape once the business says which jobs exist; inventing that split now would be
guessing at an org chart. A third role is a column value, not a redesign.

`/users` is entirely ADMIN-only and every response goes through `toPublicUser()`. It was previously
unauthenticated, and `GET /users` returned whole rows — password hashes included — to anonymous
callers, while `DELETE /users/:id` would remove any account on request.

## Transaction Domains

All domains share the same status-log pattern: two tables (`*_transactions` + `*_statuses`), `currentStatus` as write-through cache, `allowedTransitions` map in port file, `InvalidTransitionError` → 422 on invalid moves.

`settlementPeriod` is **auto-derived from `transactionDate`** on the server using the Fri–Thu boundary — callers never send the period itself. See "Two dates on every record" below.

| Domain | Status Flow | Inventory Hook |
|--------|-------------|----------------|
| wholesale-buy | `CREATED → CONFIRMED → PAID → RECEIVED → STOCKED`, plus the failure branches below | `increment` on entering `STOCKED` |
| wholesale-sell | `CREATED → CONFIRMED → PACKED → SHIPPED → PAID`, plus the failure branches below | `decrement` on entering `PACKED`, reversed on `RETURNED` |
| retail-buy | created at `CONFIRMED`; `CONFIRMED → CANCELLED` | **none** |
| retail-sell | created at `CONFIRMED`; `CONFIRMED → CANCELLED` | **none** |
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
  sweep lands and is **informational only**; nothing tests against it. The hour is wall-clock in
  `Asia/Bangkok` — `infrastructure/auto-confirm.ts` is the single implementation both wholesale
  ports call, each passing its own env var.
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

### retail-buy / retail-sell — the thin pair

Manual write-ups of counter trades, built to answer one question: *was the price we dealt at a good
one?* Full detail in `core/retail-buy/retail-buy.md`; the sell side is its mirror and documents only
what differs.

They are near-identical rather than merely symmetric — same row shape, same two-status machine, same
rules — so the web app renders both from one set of pages and one config, and `@gold-platform/types`
carries one create shape for both.

- **Neither moves inventory.** Stock is adjusted by hand through `/inventory/gain|loss`. The shop
  cannot trace which physical gold came from which customer, so coupling a pool to a counter trade
  would assert a link that does not exist. Retail-sell's old `CONFIRMED → SHIPPED` decrement was
  **removed**: shipping is deferred, which had left live code moving gold down an unreachable path.
  Both usecase suites assert no inventory usecase is called.
- **Created at `CONFIRMED`, with one status row.** There was never a draft — the trade happened
  before the form was opened — and logging one would record an event nobody performed. `DRAFT` (both)
  and `SHIPPED` (sell) survive in the enums, unreachable, so a POS feed and shipping return without a
  migration.
- **Voiding requires a note**; there is no edit path. A confirmed write-up is cancelled and re-entered
  rather than corrected, keeping the change in the log instead of overwriting a reported figure.
- **`resolveMeasuredQuantity`, never `resolveQuantity`.** The `product_type_purities` min/step rules
  describe what can be *ordered from a supplier*; a customer's gold weighs what it weighs, so 3.7 GB
  is valid input. The pairing itself is still validated.
- **One price at both purities.** Retail deals in gold baht either way, so there is no 96.5/99.9
  derivation as on the wholesale side.
- **`operationFee` sits beside `totalAmount`, never inside it.** `totalAmount` stays
  `weightGb × pricePerGb` so it is comparable against the wholesale domains, which carry no fees, and
  so the price-per-gold-baht average reads spread rather than fee. Blending them is unrecoverable
  after the fact, which is why the column exists before anything reads it. Consumers needing all-in
  cash sum the two.
- **No brand.** `brandId` is nullable and unread: brand keys an inventory pool and there is none.
- **`source`** marks how a row arrived (`MANUAL` today), so a later POS feed stays distinguishable.
  Migration 0017 dropped the six sync-only columns — `buyNumb`/`saleNumb`, `custCode`, `emplCode`,
  `brandText`, `sizeText`, `goldPriceSnapshot` — the tables being empty at the time.
- **Scope is `BAR` and `PLATE` only.** Anything else lives in another system.

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

## Two dates on every record

Recording an event and the event happening are different facts. On day one the shop is writing up operations that already took place, and even under full adoption an entry can land the morning after — so everything the operator creates carries both:

| Field | Meaning | Source |
|---|---|---|
| `transactionDate` (`movementDate` on the ledger) | the business day the deal or adjustment happened — a `date` column, `YYYY-MM-DD` | operator picks it, optional on the wire, defaults to today |
| `recordedAt` / `auditedAt` / `movedAt` | when the row reached the database | server clock, never accepted from a caller |

- Carried by **wholesale-buy**, **wholesale-sell**, **retail-buy**, **retail-sell**, **stock gain** and **stock loss**. It matters most on the retail pair, which is written up after the fact — a whole week of counter trades can be entered on one afternoon, and each has to land in the period it happened in. `inventory_movements.movementDate` is the trading day the metal moved: the picked date for a manual adjustment, the day of the transition for a buy reaching `STOCKED` or a sell reaching `PACKED` — the order's own date may be older, but the metal moved when it moved.
- **A day, not an instant.** All the picked date decides is which Fri–Thu period the record lands in, and that boundary falls on a day. A time would add no information and one more timezone to get wrong.
- **The two are different column types, and the split is load-bearing.** Picked days are `date` (Drizzle maps them to `YYYY-MM-DD` strings both ways, so no timezone touches them); insert timestamps are `timestamp({ withTimezone: true })` — `timestamptz`. Migration `0018_timestamptz` converted all 19 instant columns. The reason is that each has two writers — the app via `toISOString()`, and `defaultNow()` via Postgres `now()` — and on a naive column those agree only while the session is UTC, silently diverging by the session offset otherwise, with nothing on the row to say which convention wrote it. **Never give a `date` column a timezone**, and never add a naive `timestamp`; the header comment in `db/schema/index.ts` is the full rationale.
- **"Today" is Bangkok's today.** `todayBusinessDate()` / `businessDateOf(date)` in `@gold-platform/types` format on `Asia/Bangkok`, not on the server's or browser's clock. Never compare `recordedAt.slice(0, 10)` against a picked date — that answers the question in UTC, a different calendar for seven hours a day.
- **`businessDateSchema`** (also in types) validates a picked date: `YYYY-MM-DD`, not in the future, no floor on backdating. **`businessDaySchema`** is the shape-only form used for report windows, which may reach forward.
- **On adjustments the date documents, it does not replay.** A backdated gain or loss moves the balance now, at today's live WAC. It dates the record and the movement so reports read correctly; it does not retroactively re-average costs already applied to movements that have been reported on.
- Both wholesale list endpoints sort by `(transactionDate DESC, recordedAt DESC)` — a backdated entry belongs where its date puts it, not at the top of the list.
- `GET /inventory/movements` windows on `movementDate` with plain `from`/`to` days, both ends inclusive. It used to take ISO datetimes compared against `movedAt`, where a caller who forgot an end-of-day time on `to` silently lost the last day's movements.

## Settlement Period

`settlementPeriod` is a reporting bucket — a week label (e.g. `"2026-W24"`) auto-computed from `transactionDate` using a fixed Fri–Thu boundary. Callers never supply it. Deriving it from the insert time instead would make backdating cosmetic: an order backdated to last Thursday has to land in last week's period.

`infrastructure/settlement.ts` exports `resolveSettlementPeriodOn(businessDate)` — the form the domains call, since what they hold is a day — over `resolveSettlementPeriod(date)`. It shifts the date back 4 days before computing the ISO week, which maps each Fri–Thu span onto exactly one Mon–Sun ISO week so no two periods collide. **Both wholesale domains and both retail domains use it. `receive` still takes `settlementPeriod` from the caller and should be migrated onto it along with `transactionDate`.**

Correcting `transactionDate` re-derives the period, and `PATCH` accepts it only while the transaction is `CREATED` — the same lock that governs every other editable field. After confirmation the assignment is immutable.

**There are no settlement summary endpoints.** This section previously listed
`GET /{domain}/settlement/:period/summary` for all four transaction domains as though they existed;
none of them do, in any routes file. The plan of record still holds — split per domain rather than
merged, so domains stay isolated, with the client calling them in parallel — but it belongs to the
unbuilt Phase 4 position view.

What exists today for reading a period back is the four list endpoints' `from`/`to` window and the
xlsx export each list page builds from it, which states the weighted average price per gold baht.
Four files, read side by side, is the current answer to "did we buy and sell well".

## Product Type × Purity Constraint

Not all purities are valid for every product type (e.g. gold-plate can only be 96.5). Admin configures valid combinations at go-live via `product_type_purities` join table.

`resolveQuantity(productTypeId, purityId, weight)` in `infrastructure/quantity.ts` — the shared Effect every `createTransaction` usecase calls. It looks the pairing up, validates the weight against that pairing's `minQuantity` / `allowedValues` / `stepQuantity`, converts from the pairing's input unit (kg or gb), and delegates to `resolveWeights()`.

**`stepQuantity`** is the increment a weight must land on when the valid series has no end — 96.5% gold bar is `minQuantity: 5, stepQuantity: 5`, so 5/10/15/20/… are valid and 7 is not, because bars come in 5/10/20/50 GB and no combination of stock makes 7. It is master data beside the other two rules rather than a `percent === 96.5` branch in the validator. `isValidQuantity(rule, weight)` is the whole rule as a pure function (tested in `quantity.test.ts` with no database, the same split as `divideWeight`); `quantityErrorMessage(error)` is the one wording all three routers use. Fails `ProductTypePurityNotFoundError` or `InvalidQuantityError` → 422.

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
| `reverseDecrement(req)` | wholesale-sell at `RETURNED` | find movements by reference → restore every pool and book the opposite movements, **one transaction** (`applyReversal`) |
| `productSwitch(req)` | `POST /inventory/product-switch` (ADMIN) | decrement `fromBrandId` pool at its live WAC (`fromCostDelta`) → increment `toBrandId` pool with the same value (`toCostDelta = fromCostDelta`, cost conserved). Either direction — `NA → HUA_GOLD` as readily as the reverse; the two brands must differ (422 from the schema). Same purity + productType only. Atomic. |
| `stockGain(req)` | `POST /inventory/gain` (ADMIN) | operator enters `pricePerGb`; `totalCost = pricePerGb × weightGb`. Adjustment record + balance `+delta` + movement, **one transaction** (`applyStockGain`) |
| `stockLoss(req)` | `POST /inventory/loss` (ADMIN) | decrement at live WAC + adjustment record + movement, **one transaction** (`applyStockLoss`). Fails `InsufficientStockError` with nothing written if short |

### WAC Flow (live)

Outbound cost is derived from the current balance at decrement time — **no daily-snapshot dependency**:
- The shared `decrementWithin(tx, ...)` helper selects the pool row `FOR UPDATE`, checks sufficiency, then computes `rate = totalCost / totalWeightGb` and `costDelta = weightGb × rate` inside the same transaction, and returns `costDelta`. A pool drained to zero weight has its `totalCost` set to `0` rather than left holding rounding residue.
- Safe from divide-by-zero: `available ≥ weightGb > 0` at that point, so a decrement never runs on a zero-weight pool.
- Because every `increment` updates `totalCost`/`totalWeightGb`, a pool refilled after hitting zero always decrements at the up-to-date average — this is what fixed the 99.9% zero-inventory cost bug.
- The daily-snapshot machinery (`inventory_daily_snapshots` table, `computeSnapshots`, `GET/POST /inventory/snapshots*`, the "Compute Today's Rate" button) was **removed** — nothing consumed it after the switch to live WAC. Past balances are reconstructable from the `inventory_movements` ledger if a point-in-time valuation is ever needed.

### Movement ledger indexing

`inventory_movements` carries one index, `(movement_date, moved_at, id)` — the window and the sort
of `listMovements` in that order, so the range scan and the ordering come from it with no sort step
left. Until migration 0016 the table had none at all beyond its primary key.

The query that needed it is `sumMovementsBefore`, the opening balance: it aggregates *everything*
strictly before the window's first day, so its cost tracks the age of the ledger rather than the
size of the request. An operator opening the movements page on yesterday–today reads more rows
every month the shop trades. Both halves of `GET /inventory/movements` are covered by the one index.

There is deliberately **no `LIMIT` and no pagination** — the endpoint returns the whole window, and
the web app renders and exports all of it. If volume ever outgrows that, the answer is a daily
read-model rather than a page size, since the report is an aggregate over a window and not a list
anyone scrolls.

`referenceType` on `inventory_movements` is a **free-text varchar** (not an enum). The gain/loss forms now set it from the shared `TRANSACTION_TYPES` list in `@gold-platform/types` (`WHOLESALE_BUY`, `WHOLESALE_SELL`, `RETAIL_BUY`, `RETAIL_SELL`, `RECEIVED`, `SMELTING`, `CONVERT_OUT`, `PRODUCT_SWITCH`, `STOCK_COUNT`, `DAMAGE`, `LOST`, `MANUAL_CORRECTION`) so all movement types can be recorded through core inventory until each gets its own module. Cross-domain callers still register their own string.

## Schema Files

| File | Tables |
|------|--------|
| `master.schema.ts` | `gold_product_type`, `gold_brands`, `purities`, `bar_sizes`, `suppliers`, `supplier_product_types`, `suppler_brands` (now read — drives the brand split), `unit_conversion`, `branches` (now seeded — 47 rows, and required by both retail tables), `product_type_purities` |
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
| retail-buy | `currentStatus`, `settlementPeriod`, `branchCode`, `from`/`to` |
| retail-sell | `currentStatus`, `settlementPeriod`, `branchCode`, `from`/`to` |
| wholesale-buy | `currentStatus`, `settlementPeriod`, `supplierId`, `from`/`to` |
| wholesale-sell | `currentStatus`, `settlementPeriod`, `supplierId`, `from`/`to` |
| receive | `currentStatus`, `settlementPeriod`, `branchCode` |

`from`/`to` on the wholesale lists window over `transactionDate` — business days, both ends
inclusive, same shape as `GET /inventory/movements`. It exists because **the period is not the
unit an operator browses in.** The Fri–Thu bucket is a management convention for comparing buy
against sell in the net-position view; a worklist is a span of days. Both filters stay available
and neither replaces the other — the web app sends only the date window, and `settlementPeriod`
is what the (unbuilt) management view will use.

## Open Items

1. **User FK** — `recordedBy / createdBy / movedBy / auditedBy` are plain `varchar`; blocked on employee/customer domain decision (see below)
2. ~~**`custCode` / `emplCode` FK**~~ — moot for now: migration 0017 **dropped** both columns from the retail tables rather than leaving them unfilled. A walk-in customer is not an entity here, and the trade's only nameable party is the branch. They return with the customer/employee domains, not before.
3. **Employee vs user identity** — recommendation: separate `employees` table from `users` (login only), plus a `customers` table. Defer until stakeholders decide the legacy sync strategy. **Customer gold deposits need this**: gold left for safekeeping is custody, not a trade — title does not transfer — so it needs its own domain and must never be recorded as a retail-buy.
4. ~~**`users` table PK**~~ — resolved, migration `0004_user_uuid_key`. It was the last `serial` in the schema; it is now `uuid` with `gen_random_uuid()`, matching every other table.

    Nothing referenced it — `recordedBy`, `movedBy`, `auditedBy` and `createdBy` all store a *username string* — so there were no foreign keys to rewrite and every row simply took a new id. **That is why it was worth doing before anything pointed at it**, which was the original note's point.

    Two things this touched that are worth knowing:

    - **drizzle-kit's generated migration would have failed on deploy.** It emits `ALTER COLUMN "id" SET DATA TYPE uuid`, which Postgres rejects (`column "id" cannot be cast automatically to type uuid`), and it leaves the serial's `nextval` default and its sequence behind. `0004` is hand-written: drop the integer default *first*, change the type `USING gen_random_uuid()`, set the new default, drop the sequence. Verified on a scratch database before being applied anywhere.
    - **A token minted before this carries a number in `sub`.** Its signature stays valid, so nothing else would reject it, and the failure is quiet: `deactivateUserById` compares the target against that claim to refuse self-deactivation, and a number never equals a uuid string — so the guard would stop guarding. `authMiddleware` now refuses any token whose `sub` is not a string (`STALE_TOKEN`, 401), on the same reasoning as the missing-`role` case. Tokens last an hour, so it is one re-login at deploy.
5. ~~**DB migrations** — no migration files yet~~ — resolved, and since **squashed to a single baseline**, `drizzle/0000_init.sql`. The 19 files that preceded it (0000–0018) had accumulated a broken snapshot history — `meta/` was missing 0007–0009 and 0016–0018 — which left `drizzle-kit generate` diffing against the stale 0015 snapshot and stalling on an interactive column-conflict prompt. Squashing before the first deployment fixed that at the root; `generate` now reports cleanly.

   The baseline was verified to reproduce the old chain exactly — two databases built both ways and compared on 230 columns, 71 constraints, 28 indexes and the label ordering of 11 enum types. Only physical column order and internal `enumsortorder` floats differ, neither of which reaches the application. The reasoning from the squashed files is preserved in `docs/schema-history.md`; the files are in git before the squash commit.

   **Regenerating: always `pnpm exec drizzle-kit generate`, never ad-hoc `--schema`/`--out` flags.** Those bypass `drizzle.config.ts` and silently drop `casing: 'snake_case'`, yielding a baseline with camelCase columns that applies cleanly and then breaks every query.

   In production migrations run via `node dist/scripts/migrate.js` (`drizzle-orm`'s own migrator), because `drizzle-kit` is a devDependency and is not in the runtime image. Verify any new migration by applying it to a scratch database and diffing `information_schema` against one built the previous way — an existing database is reconciled by resetting `drizzle.__drizzle_migrations` (its `hash` is the SHA256 of the migration file), never by re-running DDL that is already applied.
6. **Goldbar-to-goldbar conversion** — resolved: `smelting` increments domestic 99.9% pool; `convert_out` decrements domestic or foreign pool. No separate conversion domain needed.
7. **Jewelry inventory** — deferred. Non-fungible tracking in Sprint 1 uses `productSwitch` to move weight between brand pools (either direction) when a legacy POS discrepancy occurs. True item-level non-fungible tracking is a future phase.
8. ~~**`reverseDecrement()`** — not yet wired~~ — it is wired: wholesale-sell calls it on `RETURNED`.
9. ~~**Daily snapshot as hard gate**~~ — resolved: outbound cost now uses live WAC from the balance at decrement time (`decrementWithin`). The daily-snapshot table and endpoints were removed entirely; no day-open compute is required before outbound transactions.
10. **POS sync** — deferred; the sell-gold-bar document it depends on is unfinished. `source` on both retail tables is the seam (`MANUAL` today). A feed will also want a nullable document-number column to group multi-line receipts, since one row is one line today; that is an additive column, not a reshape.
11. ~~**Money precision**~~ — resolved in one pass across all domains, migration `0003_decimal_precision`. Every `decimal` column was bare `numeric` — no precision, no scale — read in `mode: 'number'`, so a derived figure went in as an unrounded double and stayed: `weightGb × pricePerGb` for 15.2 baht at 40,350.10 stored as `613321.5199999999`.

    The fix has two halves and **needs both**:

    - **Columns declare a scale**, through the helpers in `db/schema/columns.ts` — `money()` is `numeric(18,2)`, `weight()` is `numeric(16,6)`, `factor()` is `numeric(6,4)`. Helpers rather than a repeated config object so the convention cannot be half-applied; adding a money column should not require remembering a number. `purities.percent` stays `numeric(5,2)` — it is a percentage, not an amount.
    - **Derived values are rounded where they are computed**, via `roundMoney` / `roundWeight` from `@gold-platform/types`. Scale alone is not enough: `cost_delta` is written to the movement *and* subtracted from the balance, so an unrounded double would be quantized on the insert and subtracted in full from the balance — measured drift of `0.0033` per movement, on the ledger the balances are supposed to reconstruct from.

    **`roundTo` rounds the decimal text, not the binary value**, because drizzle writes these columns with `String(value)` and Postgres rounds *that*, half away from zero. Two obvious implementations were written and both failed a differential test against Postgres over 38,002 values — `Math.round(v*100)/100` (the multiply reintroduces the error) and re-parsing `"1.005e2"` (lands on a different double near a boundary: 136 disagreements). The shipped version agrees on all 38,002. `brand-split.ts`'s private `round6` and the copy inlined in `brandSplitRemainder` are now that one helper.

    `mode: 'number'` stays deliberately. A double represents every value on the 2-decimal grid uniquely below ~9·10¹³ and the 6-decimal grid below ~9·10⁹, so a quantized value round-trips losslessly; string mode would change the inferred type of every row and therefore every hook, sum and table cell in the web app. **This is not arbitrary-precision arithmetic** — error inside a chain of arithmetic is bounded, not eliminated, which is why rounding happens at each stored step rather than once at the end.
12. **Retail is `BAR` + `PLATE` only** — matching the seeded `product_type_purities` pairings. Anything else lives in another system, so no jewellery product type was added.

## Branches

`branches` is the counterparty side of both retail tables and had **never held a row**, so no retail
transaction could be inserted at all whatever the request body said. It is now seeded with the
shop's 47 branches from their own export.

- **`branchCode` is the legacy numeric id, not the G-number.** Branch `1` is G006 and branch `6` is
  G001 — the two sequences diverged long ago. The numeric id is the primary key and is what lands on
  every transaction; the G-number is display only.
- **`deletedAt` (nullable) is the tombstone; `active` is the reversible "not trading right now".**
  They mean different things and both are kept. `deletedAt` is also the only workable answer once
  transactions reference a branch, because a hard delete becomes impossible at that point. This makes
  `branches` the first soft-deleted table here — every other table uses `active` alone.
- **`GET /master-data/branches` deliberately does not filter.** A closed branch still has to resolve
  its name on every transaction it ever recorded, so filtering server-side would leave historical
  rows showing a bare code. Choosing what to *offer* is a form's decision: `liveBranches()` on the web
  side filters the create-form dropdown, while list filters and detail pages read the full set.
- There is **no opening-date column**. The export carries one, but it is empty for the thirteen
  oldest branches and nothing reads it.

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

# Comma-separated browser origins allowed to call the API. Required — no default, and the
# server refuses to start without it.
CORS_ORIGIN=http://localhost:5173

# optional — the hour (0–23) the nightly confirm sweep runs, per domain. A wall-clock hour in
# Asia/Bangkok, not on the server. Only used to display when a transaction stops being editable;
# set them to match the real cron. Default 0.
WHOLESALE_BUY_AUTO_CONFIRM_HOUR=0
WHOLESALE_SELL_AUTO_CONFIRM_HOUR=0
```
